import {
  AttributeIds,
  BrowseDirection,
  DataType,
  DataTypeIds,
  NodeId,
  NodeIdType,
  ReferenceTypeIds,
  coerceNodeId,
  type BrowseDescriptionOptions,
  type ClientSession,
} from "node-opcua";
import { Effect } from "effect";

import type { NodeIdString } from "./capabilities.js";
import { Codec } from "./codecs.js";
import {
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaMethodNotExecutableError,
  OpcuaServiceError,
} from "./errors.js";
import {
  methodArgumentMetadataFromRaw,
  readBooleanAttribute,
  resolveMethodMapping,
  type AnyMethodDef,
  type MethodMetadata,
} from "./methods.js";
import { isGood } from "./normalize.js";
import type { OpcuaStructureRuntime } from "./structure-runtime.js";
import {
  accessDeniedError,
  codecMetadata,
  variableAccessCapabilities,
  variableMetadataFromRaw,
  type AnyVariableDef,
  type VariableMetadata,
} from "./values.js";

export type MetadataService = {
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
  const variableCache = new Map<string, VariableMetadata>();
  const methodCache = new Map<string, MethodBaseMetadata>();
  const builtInDataTypeCache = new Map<string, DataType>();

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
          new OpcuaMethodNotExecutableError({
            objectId: def.objectId,
            methodId: def.methodId,
            executable: base.executable,
            userExecutable: base.userExecutable,
          }),
        );
      }
      if (
        Object.values(def.input ?? {}).some((arg) =>
          Codec.requiresStructureRuntime(arg.codec),
        ) ||
        Object.values(def.output ?? {}).some((arg) =>
          Codec.requiresStructureRuntime(arg.codec),
        )
      ) {
        yield* structureRuntime.ensureInitialized();
      }
      const inputMapping = yield* resolveMethodMapping(
        "handle.method.input",
        def.methodId,
        base.inputArguments,
        def.input,
      );
      const outputMapping = yield* resolveMethodMapping(
        "handle.method.output",
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
    variableCache.clear();
    methodCache.clear();
    builtInDataTypeCache.clear();
  });

  return { variable, method, builtInDataType, invalidate };
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
        new OpcuaServiceError({
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
        new OpcuaConfigurationError({
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
        new OpcuaConfigurationError({
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
        new OpcuaConfigurationError({
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
        new OpcuaServiceError({
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
        new OpcuaServiceError({
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
    if (executable instanceof OpcuaConfigurationError) {
      return yield* Effect.fail(executable);
    }
    if (userExecutable instanceof OpcuaConfigurationError) {
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
      error instanceof OpcuaConfigurationError
        ? new OpcuaConfigurationError({
            operation: "metadata.method.argument",
            nodeId: methodNodeId,
            cause: error.cause,
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
          new OpcuaConfigurationError({
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
          new OpcuaConfigurationError({
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
      new OpcuaServiceError({
        operation: "metadata.browseDataTypeSuperType",
        nodeId: dataTypeNodeId.toString(),
        cause,
      }),
  });

const coerceNodeIdOrFail = (operation: string, nodeId: unknown) =>
  Effect.try({
    try: () => coerceNodeId(nodeId),
    catch: (cause) =>
      new OpcuaConfigurationError({ operation, nodeId: String(nodeId), cause }),
  });
