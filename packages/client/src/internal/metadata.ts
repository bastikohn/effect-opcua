import {
  AccessLevelFlag,
  AttributeIds,
  BrowseDirection,
  DataType,
  DataTypeIds,
  NodeClass,
  NodeId,
  NodeIdType,
  ReferenceTypeIds,
  StatusCodes,
  coerceNodeId,
  type BrowseDescriptionOptions,
  type ClientSession,
  type DataValue,
  type ReadValueIdOptions,
} from "node-opcua";
import { Effect } from "effect";

import type { NodeIdString } from "./common/node-id.js";
import { Codec } from "./values/codec.js";
import {
  configurationError,
  isConfigurationError,
  methodNotExecutableError,
  serviceError,
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaMethodNotExecutableError,
  OpcuaServiceError,
} from "../OpcuaError.js";
import {
  methodArgumentMetadataFromRaw,
  readBooleanAttribute,
  resolveMethodMapping,
  type AnyMethodDef,
  type MethodArg,
  type MethodMetadata,
} from "../OpcuaMethod.js";
import { isGood } from "./values/normalize.js";
import {
  normalizeLocalizedText,
  normalizeQualifiedName,
  normalizeStatusCode,
} from "./values/normalize.js";
import type { OpcuaStructureRuntime } from "./structures/runtime.js";
import {
  accessDeniedError,
  codecMetadata,
  variableAccessCapabilities,
  variableMetadataFromRaw,
  type AnyVariableDef,
  type VariableMetadata,
} from "../OpcuaVariable.js";

export type MetadataService = {
  readonly namespaceArray: () => Effect.Effect<
    readonly string[],
    OpcuaServiceError | OpcuaConfigurationError
  >;
  readonly node: (
    nodeId: NodeIdString,
  ) => Effect.Effect<
    OpcuaNodeMetadata,
    OpcuaServiceError | OpcuaConfigurationError
  >;
  readonly nodes: (
    nodeIds: readonly NodeIdString[],
  ) => Effect.Effect<
    readonly OpcuaNodeMetadataResult[],
    OpcuaServiceError | OpcuaConfigurationError
  >;
  readonly variable: (
    def: AnyVariableDef,
  ) => Effect.Effect<
    VariableMetadata,
    OpcuaServiceError | OpcuaConfigurationError | OpcuaAccessDeniedError
  >;
  readonly method: (
    def: AnyMethodDef,
  ) => Effect.Effect<
    MethodMetadata,
    OpcuaServiceError | OpcuaConfigurationError | OpcuaMethodNotExecutableError
  >;
  readonly builtInDataType: (
    dataTypeNodeId: NodeId,
  ) => Effect.Effect<DataType, OpcuaServiceError | OpcuaConfigurationError>;
  readonly invalidate: Effect.Effect<void>;
};

export type OpcuaAccessBits = {
  readonly readable: boolean;
  readonly writable: boolean;
};

export type OpcuaNodeMetadata = {
  readonly nodeId: string;

  readonly nodeClass?: string;
  readonly browseName?: string;
  readonly browseNameNamespaceIndex?: number;

  readonly displayName?: string;
  readonly description?: string;

  readonly dataType?: string;
  readonly valueRank?: number;
  readonly arrayDimensions?: readonly number[];

  readonly accessLevel?: OpcuaAccessBits;
  readonly userAccessLevel?: OpcuaAccessBits;

  readonly namespaceIndex?: number;
  readonly namespaceUri?: string;
};

export type OpcuaMetadataAttribute =
  | "NodeClass"
  | "BrowseName"
  | "DisplayName"
  | "Description"
  | "DataType"
  | "ValueRank"
  | "ArrayDimensions"
  | "AccessLevel"
  | "UserAccessLevel";

export type OpcuaMetadataReadFailure =
  | {
      readonly _tag: "NonGoodStatus";
      readonly attribute: OpcuaMetadataAttribute;
      readonly status: ReturnType<typeof normalizeStatusCode>;
    }
  | {
      readonly _tag: "InvalidValue";
      readonly attribute: OpcuaMetadataAttribute;
      readonly message: string;
    };

export type OpcuaNodeMetadataResult =
  | {
      readonly _tag: "Success";
      readonly nodeId: string;
      readonly metadata: OpcuaNodeMetadata;
    }
  | {
      readonly _tag: "Failure";
      readonly nodeId: string;
      readonly reason: OpcuaMetadataReadFailure;
    };

type MethodBaseMetadata = {
  readonly objectId: NodeIdString;
  readonly methodId: NodeIdString;
  readonly executable: boolean;
  readonly userExecutable?: boolean;
  readonly inputArguments: MethodMetadata["inputArguments"];
  readonly outputArguments: MethodMetadata["outputArguments"];
};

export const makeMetadataService = (
  session: ClientSession,
  structureRuntime: OpcuaStructureRuntime,
): MetadataService => {
  let namespaceArrayCache: readonly string[] | undefined;
  const variableCache = new Map<string, VariableMetadata>();
  const methodCache = new Map<string, MethodBaseMetadata>();
  const builtInDataTypeCache = new Map<string, DataType>();

  const namespaceArray = () =>
    Effect.suspend(() => {
      if (namespaceArrayCache !== undefined) {
        return Effect.succeed(namespaceArrayCache);
      }
      return readNamespaceArray(session).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            namespaceArrayCache = value;
          }),
        ),
      );
    });

  const nodes: MetadataService["nodes"] = (nodeIds) =>
    readManyNodeMetadata(session, namespaceArray, nodeIds);

  const node: MetadataService["node"] = (nodeId) =>
    Effect.gen(function* () {
      const [result] = yield* nodes([nodeId]);
      if (!result || result._tag === "Failure") {
        return yield* Effect.fail(
          configurationError({
            operation: "metadata.node",
            nodeId,
            cause:
              result?._tag === "Failure"
                ? result.reason
                : "No metadata result was returned",
          }),
        );
      }
      return result.metadata;
    });

  const builtInDataType: MetadataService["builtInDataType"] = (
    dataTypeNodeId,
  ) =>
    Effect.suspend(() => {
      const key = dataTypeNodeId.toString();
      const cached = builtInDataTypeCache.get(key);
      if (cached !== undefined) return Effect.succeed(cached);
      return resolveBuiltInDataType(session, dataTypeNodeId).pipe(
        Effect.tap((value) =>
          Effect.sync(() => {
            builtInDataTypeCache.set(key, value);
          }),
        ),
      );
    });

  const rawVariableMetadata = (nodeId: NodeIdString) =>
    Effect.suspend(() => {
      const cached = variableCache.get(nodeId);
      if (cached) return Effect.succeed(cached);
      return discoverVariableMetadata(session, nodeId, builtInDataType).pipe(
        Effect.tap((metadata) =>
          Effect.sync(() => {
            variableCache.set(nodeId, metadata);
          }),
        ),
      );
    });

  const variable: MetadataService["variable"] = (def) =>
    Effect.gen(function* () {
      const metadata = yield* rawVariableMetadata(def.nodeId);
      for (const capability of variableAccessCapabilities(def.access)) {
        const error = accessDeniedError(
          def.nodeId,
          capability,
          metadata.accessLevel,
          metadata.userAccessLevel,
        );
        if (error) return yield* Effect.fail(error);
      }
      if (Codec.requiresStructureRuntime(def.codec)) {
        yield* structureRuntime.ensureInitialized();
      }
      yield* Codec.validateMetadata(def.codec, codecMetadata(metadata));
      return metadata;
    });

  const rawMethodMetadata = (def: AnyMethodDef) =>
    Effect.suspend(() => {
      const key = `${def.objectId}\u0000${def.methodId}`;
      const cached = methodCache.get(key);
      if (cached) return Effect.succeed(cached);
      return discoverMethodBaseMetadata(session, def, builtInDataType).pipe(
        Effect.tap((metadata) =>
          Effect.sync(() => {
            methodCache.set(key, metadata);
          }),
        ),
      );
    });

  const method: MetadataService["method"] = (def) =>
    Effect.gen(function* () {
      const base = yield* rawMethodMetadata(def);
      if (!base.executable || base.userExecutable === false) {
        return yield* Effect.fail(
          methodNotExecutableError({
            objectId: def.objectId,
            methodId: def.methodId,
            executable: base.executable,
            userExecutable: base.userExecutable,
          }),
        );
      }
      if (
        (
          Object.values(def.input ?? {}) as ReadonlyArray<MethodArg<unknown>>
        ).some((arg) => Codec.requiresStructureRuntime(arg.codec)) ||
        (
          Object.values(def.output ?? {}) as ReadonlyArray<MethodArg<unknown>>
        ).some((arg) => Codec.requiresStructureRuntime(arg.codec))
      ) {
        yield* structureRuntime.ensureInitialized();
      }
      const inputMapping = yield* resolveMethodMapping(
        "method.input",
        def.methodId,
        base.inputArguments,
        def.input,
      );
      const outputMapping = yield* resolveMethodMapping(
        "method.output",
        def.methodId,
        base.outputArguments,
        def.output,
      );
      return {
        ...base,
        inputMapping,
        outputMapping,
      };
    });

  const invalidate = Effect.sync(() => {
    namespaceArrayCache = undefined;
    variableCache.clear();
    methodCache.clear();
    builtInDataTypeCache.clear();
  });

  return {
    namespaceArray,
    node,
    nodes,
    variable,
    method,
    builtInDataType,
    invalidate,
  };
};

const readNamespaceArray = (session: ClientSession) =>
  Effect.gen(function* () {
    const dataValue = yield* Effect.tryPromise({
      try: () =>
        session.read(
          { nodeId: coerceNodeId("i=2255"), attributeId: AttributeIds.Value },
          0,
        ),
      catch: (cause) =>
        serviceError({
          operation: "metadata.namespaceArray",
          nodeId: "i=2255",
          cause,
        }),
    });
    if (!isGood(dataValue.statusCode)) {
      return yield* Effect.fail(
        configurationError({
          operation: "metadata.namespaceArray",
          nodeId: "i=2255",
          cause: normalizeStatusCode(dataValue.statusCode),
        }),
      );
    }
    const value = dataValue.value?.value;
    if (
      !Array.isArray(value) ||
      !value.every((item) => typeof item === "string")
    ) {
      return yield* Effect.fail(
        configurationError({
          operation: "metadata.namespaceArray",
          nodeId: "i=2255",
          cause: "NamespaceArray value is not a string array",
        }),
      );
    }
    return [...value];
  });

const metadataAttributes = [
  ["NodeClass", AttributeIds.NodeClass],
  ["BrowseName", AttributeIds.BrowseName],
  ["DisplayName", AttributeIds.DisplayName],
  ["Description", AttributeIds.Description],
  ["DataType", AttributeIds.DataType],
  ["ValueRank", AttributeIds.ValueRank],
  ["ArrayDimensions", AttributeIds.ArrayDimensions],
  ["AccessLevel", AttributeIds.AccessLevel],
  ["UserAccessLevel", AttributeIds.UserAccessLevel],
] as const satisfies ReadonlyArray<
  readonly [OpcuaMetadataAttribute, AttributeIds]
>;

const maxMetadataNodesPerRead = 50;

const requiredMetadataAttributes = new Set<OpcuaMetadataAttribute>([
  "NodeClass",
  "BrowseName",
]);

const readManyNodeMetadata = (
  session: ClientSession,
  namespaceArray: MetadataService["namespaceArray"],
  nodeIds: readonly NodeIdString[],
) =>
  Effect.gen(function* () {
    if (nodeIds.length === 0) return [];
    const namespaceUris = yield* namespaceArray();
    const results: OpcuaNodeMetadataResult[] = [];
    for (const batch of chunks(nodeIds, maxMetadataNodesPerRead)) {
      const batchResults = yield* readNodeMetadataBatch(
        session,
        namespaceUris,
        batch,
      );
      results.push(...batchResults);
    }
    return results;
  });

const readNodeMetadataBatch = (
  session: ClientSession,
  namespaceUris: readonly string[],
  nodeIds: readonly NodeIdString[],
) =>
  Effect.gen(function* () {
    const readPlan = nodeIds.map((nodeId) => {
      const parsed = coerceNodeId(nodeId);
      const nodesToRead = metadataAttributes.map(
        ([attribute, attributeId]) =>
          ({
            nodeId: parsed,
            attributeId,
            attribute,
          }) as ReadValueIdOptions & {
            readonly attribute: OpcuaMetadataAttribute;
          },
      );
      return { nodeId, parsed, nodesToRead };
    });
    const flatNodes = readPlan.flatMap((entry) => entry.nodesToRead);
    const values = yield* Effect.tryPromise({
      try: () => session.read(flatNodes, 0),
      catch: (cause) =>
        serviceError({
          operation: "metadata.nodes",
          cause,
        }),
    });
    if (values.length !== flatNodes.length) {
      return yield* Effect.fail(
        serviceError({
          operation: "metadata.nodes",
          cause: `Expected ${flatNodes.length} DataValues, got ${values.length}`,
        }),
      );
    }

    let offset = 0;
    return readPlan.map((entry): OpcuaNodeMetadataResult => {
      const valuesByAttribute = new Map<OpcuaMetadataAttribute, DataValue>();
      for (const [attribute] of metadataAttributes) {
        valuesByAttribute.set(attribute, values[offset++]!);
      }
      const failure = metadataFailure(valuesByAttribute);
      if (failure) {
        return {
          _tag: "Failure",
          nodeId: entry.nodeId,
          reason: failure,
        };
      }
      return {
        _tag: "Success",
        nodeId: entry.nodeId,
        metadata: nodeMetadataFromValues(
          entry.nodeId,
          entry.parsed.namespace,
          namespaceUris[entry.parsed.namespace],
          valuesByAttribute,
        ),
      };
    });
  });

const chunks = <A>(items: readonly A[], size: number): readonly A[][] => {
  const result: A[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push([...items.slice(index, index + size)]);
  }
  return result;
};

const metadataFailure = (
  values: ReadonlyMap<OpcuaMetadataAttribute, DataValue>,
): OpcuaMetadataReadFailure | undefined => {
  for (const attribute of requiredMetadataAttributes) {
    const value = values.get(attribute);
    if (!value || !isGood(value.statusCode)) {
      return {
        _tag: "NonGoodStatus",
        attribute,
        status: normalizeStatusCode(
          value?.statusCode ?? StatusCodes.BadInternalError,
        ),
      };
    }
  }
  if (typeof values.get("NodeClass")?.value?.value !== "number") {
    return {
      _tag: "InvalidValue",
      attribute: "NodeClass",
      message: "NodeClass value is not numeric",
    };
  }
  if (!values.get("BrowseName")?.value?.value) {
    return {
      _tag: "InvalidValue",
      attribute: "BrowseName",
      message: "BrowseName value is missing",
    };
  }
  return undefined;
};

const nodeMetadataFromValues = (
  nodeId: string,
  namespaceIndex: number,
  namespaceUri: string | undefined,
  values: ReadonlyMap<OpcuaMetadataAttribute, DataValue>,
): OpcuaNodeMetadata => {
  const browseNameValue = values.get("BrowseName")?.value?.value;
  const displayNameValue = values.get("DisplayName");
  const descriptionValue = values.get("Description");
  const nodeClassNumber = values.get("NodeClass")?.value?.value as number;
  const browseName = normalizeQualifiedName(
    browseNameValue as Parameters<typeof normalizeQualifiedName>[0],
  );
  return {
    nodeId,
    nodeClass: NodeClass[nodeClassNumber] ?? String(nodeClassNumber),
    browseName: browseName.name,
    browseNameNamespaceIndex: browseName.namespaceIndex,
    displayName: localizedText(displayNameValue),
    description: localizedText(descriptionValue),
    dataType: nodeIdValue(values.get("DataType")),
    valueRank: numberValue(values.get("ValueRank")),
    arrayDimensions: numberArrayValue(values.get("ArrayDimensions")),
    accessLevel: accessBits(values.get("AccessLevel")),
    userAccessLevel: accessBits(values.get("UserAccessLevel")),
    namespaceIndex,
    namespaceUri,
  };
};

const localizedText = (dataValue: DataValue | undefined) => {
  if (!dataValue || !isGood(dataValue.statusCode) || !dataValue.value?.value) {
    return undefined;
  }
  return normalizeLocalizedText(
    dataValue.value.value as Parameters<typeof normalizeLocalizedText>[0],
  ).text;
};

const nodeIdValue = (dataValue: DataValue | undefined) => {
  if (!dataValue || !isGood(dataValue.statusCode)) return undefined;
  const value = dataValue.value?.value;
  return value instanceof NodeId ? value.toString() : undefined;
};

const numberValue = (dataValue: DataValue | undefined) => {
  if (!dataValue || !isGood(dataValue.statusCode)) return undefined;
  const value = dataValue.value?.value;
  return typeof value === "number" ? value : undefined;
};

const numberArrayValue = (dataValue: DataValue | undefined) => {
  if (!dataValue || !isGood(dataValue.statusCode)) return undefined;
  const value = dataValue.value?.value;
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "number")
  ) {
    return undefined;
  }
  return [...value];
};

const accessBits = (
  dataValue: DataValue | undefined,
): OpcuaAccessBits | undefined => {
  const value = numberValue(dataValue);
  if (value === undefined) return undefined;
  return {
    readable: (value & AccessLevelFlag.CurrentRead) !== 0,
    writable: (value & AccessLevelFlag.CurrentWrite) !== 0,
  };
};

const discoverVariableMetadata = (
  session: ClientSession,
  nodeId: NodeIdString,
  builtInDataType: MetadataService["builtInDataType"],
) =>
  Effect.gen(function* () {
    const nodes = [
      AttributeIds.DataType,
      AttributeIds.ValueRank,
      AttributeIds.ArrayDimensions,
      AttributeIds.AccessLevel,
      AttributeIds.UserAccessLevel,
    ].map((attributeId) => ({ nodeId: coerceNodeId(nodeId), attributeId }));
    const [
      dataTypeValue,
      valueRankValue,
      arrayDimensionsValue,
      accessLevelValue,
      userAccessLevelValue,
    ] = yield* Effect.tryPromise({
      try: () => session.read(nodes, 0),
      catch: (cause) =>
        serviceError({
          operation: "metadata.variable",
          nodeId,
          cause,
        }),
    });
    if (
      !dataTypeValue ||
      !isGood(dataTypeValue.statusCode) ||
      !(dataTypeValue.value?.value instanceof NodeId)
    ) {
      return yield* Effect.fail(
        configurationError({
          operation: "metadata.variable",
          nodeId,
          cause: "DataType is unreadable",
        }),
      );
    }
    if (
      !valueRankValue ||
      !isGood(valueRankValue.statusCode) ||
      typeof valueRankValue.value?.value !== "number"
    ) {
      return yield* Effect.fail(
        configurationError({
          operation: "metadata.variable",
          nodeId,
          cause: "ValueRank is unreadable",
        }),
      );
    }
    if (
      !accessLevelValue ||
      !isGood(accessLevelValue.statusCode) ||
      typeof accessLevelValue.value?.value !== "number"
    ) {
      return yield* Effect.fail(
        configurationError({
          operation: "metadata.variable",
          nodeId,
          cause: "AccessLevel is unreadable",
        }),
      );
    }
    const dataTypeNodeId = dataTypeValue.value.value as NodeId;
    const builtIn = yield* builtInDataType(dataTypeNodeId);
    const userAccessLevel =
      userAccessLevelValue &&
      isGood(userAccessLevelValue.statusCode) &&
      typeof userAccessLevelValue.value?.value === "number"
        ? (userAccessLevelValue.value.value as number)
        : undefined;

    return variableMetadataFromRaw({
      nodeId,
      dataTypeNodeId,
      builtInDataType: builtIn,
      valueRank: valueRankValue.value.value as number,
      arrayDimensions:
        arrayDimensionsValue &&
        isGood(arrayDimensionsValue.statusCode) &&
        Array.isArray(arrayDimensionsValue.value?.value)
          ? arrayDimensionsValue.value.value
          : undefined,
      accessLevel: accessLevelValue.value.value as number,
      userAccessLevel,
    });
  });

const discoverMethodBaseMetadata = (
  session: ClientSession,
  def: AnyMethodDef,
  builtInDataType: MetadataService["builtInDataType"],
) =>
  Effect.gen(function* () {
    const methodId = yield* coerceNodeIdOrFail(
      "metadata.method.methodId",
      def.methodId,
    );
    const argumentDefinition = yield* Effect.tryPromise({
      try: () => session.getArgumentDefinition(methodId),
      catch: (cause) =>
        serviceError({
          operation: "metadata.method.getArgumentDefinition",
          nodeId: def.methodId,
          cause,
        }),
    });
    const [executable, userExecutable] = yield* readExecutableAttributes(
      session,
      def,
      methodId,
    );
    const inputArguments = yield* normalizeArguments(
      def.methodId,
      argumentDefinition.inputArguments ?? [],
      builtInDataType,
    );
    const outputArguments = yield* normalizeArguments(
      def.methodId,
      argumentDefinition.outputArguments ?? [],
      builtInDataType,
    );
    return {
      objectId: def.objectId,
      methodId: def.methodId,
      executable,
      userExecutable,
      inputArguments,
      outputArguments,
    };
  });

const readExecutableAttributes = (
  session: ClientSession,
  def: AnyMethodDef,
  methodId: NodeId,
) =>
  Effect.gen(function* () {
    const [executableValue, userExecutableValue] = yield* Effect.tryPromise({
      try: () =>
        session.read(
          [
            { nodeId: methodId, attributeId: AttributeIds.Executable },
            { nodeId: methodId, attributeId: AttributeIds.UserExecutable },
          ],
          0,
        ),
      catch: (cause) =>
        serviceError({
          operation: "metadata.method.executable",
          nodeId: def.methodId,
          cause,
        }),
    });
    const executable = readBooleanAttribute(
      executableValue,
      "metadata.method.executable",
      def.methodId,
      true,
    );
    const userExecutable = readBooleanAttribute(
      userExecutableValue,
      "metadata.method.userExecutable",
      def.methodId,
      false,
    );
    if (isConfigurationError(executable)) {
      return yield* Effect.fail(executable);
    }
    if (isConfigurationError(userExecutable)) {
      return yield* Effect.fail(userExecutable);
    }
    return [executable as boolean, userExecutable] as const;
  });

const normalizeArguments = (
  methodNodeId: NodeIdString,
  arguments_: ReadonlyArray<import("node-opcua").Argument>,
  builtInDataType: MetadataService["builtInDataType"],
) =>
  Effect.forEach(arguments_, (argument) =>
    Effect.gen(function* () {
      const dataTypeNodeId =
        argument.dataType instanceof NodeId
          ? argument.dataType
          : yield* coerceNodeIdOrFail(
              "metadata.method.argument.dataType",
              String(argument.dataType),
            );
      const builtIn = yield* builtInDataType(dataTypeNodeId);
      return methodArgumentMetadataFromRaw(argument, dataTypeNodeId, builtIn);
    }),
  ).pipe(
    Effect.mapError((error) =>
      isConfigurationError(error)
        ? configurationError({
            operation: "metadata.method.argument",
            nodeId: methodNodeId,
            cause: error.reason.cause,
          })
        : error,
    ),
  );

const resolveBuiltInDataType = (
  session: ClientSession,
  dataTypeNodeId: NodeId,
): Effect.Effect<DataType, OpcuaConfigurationError | OpcuaServiceError> =>
  Effect.gen(function* () {
    let current = dataTypeNodeId;
    const visited = new Set<string>();
    while (true) {
      const builtIn = builtInDataTypeFromNodeId(current);
      if (builtIn !== undefined) return builtIn;

      const key = current.toString();
      if (visited.has(key)) {
        return yield* Effect.fail(
          configurationError({
            operation: "metadata.builtInDataType",
            nodeId: dataTypeNodeId.toString(),
            cause: `DataType hierarchy contains a cycle at ${key}`,
          }),
        );
      }
      visited.add(key);

      const superType = yield* browseDataTypeSuperType(session, current);
      if (!superType) {
        return yield* Effect.fail(
          configurationError({
            operation: "metadata.builtInDataType",
            nodeId: dataTypeNodeId.toString(),
            cause: `Could not resolve built-in DataType for ${dataTypeNodeId.toString()}`,
          }),
        );
      }
      current = superType;
    }
  });

const builtInDataTypeFromNodeId = (nodeId: NodeId): DataType | undefined => {
  if (
    nodeId.identifierType === NodeIdType.NUMERIC &&
    nodeId.namespace === 0 &&
    nodeId.value === DataTypeIds.Enumeration
  ) {
    return DataType.Int32;
  }
  if (
    nodeId.identifierType === NodeIdType.NUMERIC &&
    nodeId.namespace === 0 &&
    typeof nodeId.value === "number" &&
    nodeId.value <= DataType.DiagnosticInfo &&
    DataType[nodeId.value] !== undefined
  ) {
    return nodeId.value as DataType;
  }
  return undefined;
};

const browseDataTypeSuperType = (
  session: ClientSession,
  dataTypeNodeId: NodeId,
) =>
  Effect.tryPromise({
    try: async () => {
      const browse: BrowseDescriptionOptions = {
        browseDirection: BrowseDirection.Inverse,
        includeSubtypes: false,
        nodeId: dataTypeNodeId,
        referenceTypeId: coerceNodeId(ReferenceTypeIds.HasSubtype),
        resultMask: 1,
      };
      const result = await session.browse(browse);
      if (!isGood(result.statusCode)) {
        throw new Error(result.statusCode.toString());
      }
      const nodeId = result.references?.[0]?.nodeId;
      return nodeId ? coerceNodeId(nodeId) : undefined;
    },
    catch: (cause) =>
      serviceError({
        operation: "metadata.browseDataTypeSuperType",
        nodeId: dataTypeNodeId.toString(),
        cause,
      }),
  });

const coerceNodeIdOrFail = (operation: string, nodeId: unknown) =>
  Effect.try({
    try: () => coerceNodeId(nodeId),
    catch: (cause) =>
      configurationError({ operation, nodeId: String(nodeId), cause }),
  });
