import {
  AccessLevelFlag,
  AttributeIds,
  DataType,
  NodeId,
  coerceNodeId,
  type ClientSession,
  type DataValue,
  type ReadValueIdOptions,
  type StatusCode,
  type Variant,
  type WriteValueOptions,
} from "node-opcua";
import { Effect, Result } from "effect";

import { runChunked, type BatchOptions } from "./internal/batch.js";
import type {
  NodeIdString,
  VariableCapability,
} from "./internal/capabilities.js";
import {
  Codec,
  dynamic,
  type AnySchema,
  type CodecType,
  type OpcuaCodec,
} from "./internal/codecs.js";
import {
  accessDeniedError as makeAccessDeniedError,
  serviceError,
  OpcuaEncodeError,
  OpcuaServiceError,
} from "./OpcuaError.js";
import {
  isGood,
  normalizeNodeId,
  normalizeStatusCode,
  normalizeTimestamp,
  normalizeVariantInfo,
  type OpcuaDynamicValue,
  type OpcuaNodeIdInfo,
  type OpcuaStatusInfo,
  type OpcuaVariantInfo,
} from "./internal/normalize.js";
import type { OpcuaStructureRuntime } from "./internal/structure-runtime.js";

export type { AnySchema, CodecType, OpcuaCodec };
export type {
  NodeIdString,
  ExpandedNodeIdString,
} from "./internal/capabilities.js";
export type { OpcuaDynamicValue } from "./internal/normalize.js";

export type VariableAccess = "read" | "write" | "readWrite";

export type VariableDef<
  Id extends string = string,
  A = OpcuaDynamicValue,
  Access extends VariableAccess = "read",
> = {
  readonly _tag: "VariableDef";
  readonly nodeId: Id;
  readonly codec: OpcuaCodec<A>;
  readonly access: Access;
  readonly includeRaw?: boolean;
};

export type AnyVariableDef = VariableDef<string, unknown, VariableAccess>;
export type ReadableVariableDef =
  | VariableDef<string, unknown, "read">
  | VariableDef<string, unknown, "readWrite">;
export type WritableVariableDef =
  | VariableDef<string, unknown, "write">
  | VariableDef<string, unknown, "readWrite">;

export type ValueOfVariableDef<Def> =
  Def extends VariableDef<string, infer A, VariableAccess> ? A : never;

export type AccessOfVariableDef<Def> =
  Def extends VariableDef<string, unknown, infer Access> ? Access : never;

export type NodeIdOfVariableDef<Def> =
  Def extends VariableDef<infer Id, unknown, VariableAccess> ? Id : never;

export type ReadResult<A, Id extends string = string> =
  | {
      readonly _tag: "Value";
      readonly nodeId: Id;
      readonly value: A;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly unsafeRaw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly unsafeRaw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    }
  | {
      readonly _tag: "DecodeError";
      readonly nodeId: Id;
      readonly error: unknown;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly unsafeRaw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    };

export type AnyReadResult =
  | ReadResult<unknown, string>
  | ReadResult<OpcuaDynamicValue, string>;

export type WriteResult<Id extends string = string> =
  | {
      readonly _tag: "Written";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
    };

export type VariableMetadata = {
  readonly nodeId: NodeIdString;
  readonly declaredDataType: OpcuaNodeIdInfo;
  readonly builtInDataType: string;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly accessLevel: number;
  readonly userAccessLevel?: number;
  readonly access: {
    readonly readable: boolean;
    readonly writable: boolean;
    readonly userReadable: boolean;
    readonly userWritable: boolean;
  };
  readonly unsafeRaw: {
    readonly declaredDataType: NodeId;
    readonly builtInDataType: DataType;
  };
};

export type PreparedWriteVariable<
  Def extends WritableVariableDef = WritableVariableDef,
> = {
  readonly def: Def;
  readonly metadata: VariableMetadata;
  readonly value: ValueOfVariableDef<Def>;
  readonly rawNodeId: NodeId;
};

export const makeVariableDef = <
  const Id extends string,
  C extends OpcuaCodec<unknown> = OpcuaCodec<OpcuaDynamicValue>,
  const Access extends VariableAccess = "read",
>(options: {
  readonly nodeId: Id;
  readonly codec?: C;
  readonly access?: Access;
  readonly includeRaw?: boolean;
}): VariableDef<Id, CodecType<C>, Access> => ({
  _tag: "VariableDef",
  nodeId: options.nodeId,
  codec: (options.codec ?? dynamic()) as unknown as OpcuaCodec<CodecType<C>>,
  access: (options.access ?? "read") as Access,
  includeRaw: options.includeRaw,
});

export const make = makeVariableDef;

export const readDataValue = (session: ClientSession, nodeId: NodeIdString) =>
  Effect.tryPromise({
    try: () =>
      session.read(
        {
          nodeId: coerceNodeId(nodeId),
          attributeId: AttributeIds.Value,
        },
        0,
      ),
    catch: (cause) => serviceError({ operation: "read", nodeId, cause }),
  });

export const readVariable = <const Id extends string, A>(
  session: ClientSession,
  def:
    | VariableDef<Id, A, "read" | "readWrite">
    | VariableDef<Id, A, VariableAccess>,
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    if (Codec.requiresStructureRuntime(def.codec)) {
      yield* structureRuntime.ensureInitialized();
    }
    const dataValue = yield* readDataValue(session, def.nodeId).pipe(
      Effect.withSpan("opcua.raw.read", {
        attributes: { "opcua.node_id": def.nodeId },
        kind: "client",
      }),
    );
    return yield* sampleFromDataValue(def, dataValue, structureRuntime);
  });

export type PreparedReadVariable<
  Def extends ReadableVariableDef = ReadableVariableDef,
> = {
  readonly def: Def;
  readonly rawNodeId: NodeId;
};

export const readPreparedVariables = (
  session: ClientSession,
  items: ReadonlyArray<PreparedReadVariable>,
  structureRuntime: OpcuaStructureRuntime,
  options?: BatchOptions,
) =>
  Effect.gen(function* () {
    if (items.some((item) => Codec.requiresStructureRuntime(item.def.codec))) {
      yield* structureRuntime.ensureInitialized();
    }
    const dataValues = yield* runChunked(items, options, (chunk) =>
      Effect.gen(function* () {
        const readValueIds: ReadonlyArray<ReadValueIdOptions> = chunk.map(
          (item) => ({
            nodeId: item.rawNodeId,
            attributeId: AttributeIds.Value,
          }),
        );
        const dataValues = yield* Effect.tryPromise({
          try: () => session.read([...readValueIds], 0),
          catch: (cause) =>
            serviceError({
              operation: "read",
              cause,
            }),
        }).pipe(
          Effect.withSpan("opcua.raw.read.batch", {
            attributes: { "opcua.node_count": chunk.length },
            kind: "client",
          }),
        );
        if (dataValues.length !== chunk.length) {
          return yield* Effect.fail(
            serviceError({
              operation: "read",
              cause: `Expected ${chunk.length} DataValues, got ${dataValues.length}`,
            }),
          );
        }
        return dataValues;
      }),
    );
    return yield* Effect.forEach(items, (item, index) =>
      sampleFromDataValue(item.def, dataValues[index]!, structureRuntime),
    );
  });

export const sampleFromDataValue = <const Id extends string, A>(
  def: VariableDef<Id, A, VariableAccess>,
  dataValue: DataValue,
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    const base = sampleBase(def.nodeId, dataValue, def.includeRaw ?? false);
    if (!isGood(dataValue.statusCode)) {
      return { _tag: "NonGoodStatus", ...base } as ReadResult<A, Id>;
    }
    const decoded = yield* Effect.result(
      Codec.decode(def.codec, dataValue.value, dataValue, structureRuntime),
    );
    if (Result.isFailure(decoded)) {
      return {
        _tag: "DecodeError",
        ...base,
        error: decoded.failure,
      } as ReadResult<A, Id>;
    }
    return {
      _tag: "Value",
      ...base,
      value: decoded.success as unknown as A,
    } as ReadResult<A, Id>;
  });

export const writeVariable = <const Id extends string, A>(
  session: ClientSession,
  def: VariableDef<Id, A, VariableAccess>,
  metadata: VariableMetadata,
  value: A,
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    if (Codec.requiresStructureRuntime(def.codec)) {
      yield* structureRuntime.ensureInitialized();
    }
    const variant = yield* Codec.encode(
      def.codec as OpcuaCodec<unknown>,
      value as unknown,
      codecMetadata(metadata),
      structureRuntime,
    );
    const statusCode = yield* Effect.tryPromise({
      try: () =>
        session.write({
          nodeId: coerceNodeId(def.nodeId),
          attributeId: AttributeIds.Value,
          value: { value: variant },
        }),
      catch: (cause) =>
        serviceError({
          operation: "write",
          nodeId: def.nodeId,
          cause,
        }),
    }).pipe(
      Effect.withSpan("opcua.raw.write", {
        attributes: { "opcua.node_id": def.nodeId },
        kind: "client",
      }),
    );
    return writeResult(def.nodeId, statusCode);
  });

export const writePreparedVariables = (
  session: ClientSession,
  entries: ReadonlyArray<PreparedWriteVariable>,
  structureRuntime: OpcuaStructureRuntime,
  options?: BatchOptions,
) =>
  Effect.gen(function* () {
    if (
      entries.some((entry) => Codec.requiresStructureRuntime(entry.def.codec))
    ) {
      yield* structureRuntime.ensureInitialized();
    }
    const writeValues = yield* Effect.forEach(entries, (entry) =>
      encodeWriteValue(entry, structureRuntime),
    );
    const statusCodes = yield* runChunked(writeValues, options, (chunk) =>
      Effect.gen(function* () {
        const statusCodes = yield* Effect.tryPromise({
          try: () => session.write([...chunk]),
          catch: (cause) =>
            serviceError({
              operation: "write",
              cause,
            }),
        });
        if (statusCodes.length !== chunk.length) {
          return yield* Effect.fail(
            serviceError({
              operation: "write",
              cause: `Expected ${chunk.length} StatusCodes, got ${statusCodes.length}`,
            }),
          );
        }
        return statusCodes;
      }),
    );
    return entries.map((entry, index) =>
      writeResult(entry.def.nodeId, statusCodes[index]!),
    );
  });

export const writeResult = <Id extends string>(
  nodeId: Id,
  statusCode: StatusCode,
): WriteResult<Id> =>
  isGood(statusCode)
    ? { _tag: "Written", nodeId, status: normalizeStatusCode(statusCode) }
    : {
        _tag: "NonGoodStatus",
        nodeId,
        status: normalizeStatusCode(statusCode),
      };

const encodeWriteValue = (
  entry: PreparedWriteVariable,
  structureRuntime: OpcuaStructureRuntime,
): Effect.Effect<WriteValueOptions, OpcuaEncodeError | OpcuaServiceError> =>
  Effect.gen(function* () {
    const variant = yield* Codec.encode(
      entry.def.codec as OpcuaCodec<unknown>,
      entry.value as unknown,
      codecMetadata(entry.metadata),
      structureRuntime,
    );
    return {
      nodeId: entry.rawNodeId,
      attributeId: AttributeIds.Value,
      value: { value: variant },
    };
  });

export const accessDeniedError = (
  nodeId: NodeIdString,
  requestedCapability: VariableCapability,
  accessLevel: number,
  userAccessLevel?: number,
) => {
  const hasNodeAccess = hasAccess(accessLevel, requestedCapability);
  const hasUserAccess =
    userAccessLevel === undefined ||
    hasAccess(userAccessLevel, requestedCapability);
  if (!hasNodeAccess || !hasUserAccess) {
    return makeAccessDeniedError({
      nodeId,
      requestedCapability,
      accessLevel,
      userAccessLevel,
    });
  }
  return undefined;
};

export const variableAccessCapabilities = (
  access: VariableAccess,
): ReadonlyArray<VariableCapability> => {
  switch (access) {
    case "read":
      return ["read"];
    case "write":
      return ["write"];
    case "readWrite":
      return ["read", "write"];
  }
};

export const hasAccess = (
  accessLevel: number,
  capability: VariableCapability,
) => {
  const flag =
    capability === "read"
      ? AccessLevelFlag.CurrentRead
      : AccessLevelFlag.CurrentWrite;
  return (accessLevel & flag) !== 0;
};

export const variableMetadataFromRaw = (input: {
  readonly nodeId: NodeIdString;
  readonly dataTypeNodeId: NodeId;
  readonly builtInDataType: DataType;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly accessLevel: number;
  readonly userAccessLevel?: number;
}): VariableMetadata => ({
  nodeId: input.nodeId,
  declaredDataType: normalizeNodeId(input.dataTypeNodeId),
  builtInDataType:
    DataType[input.builtInDataType] ?? String(input.builtInDataType),
  valueRank: input.valueRank,
  arrayDimensions: input.arrayDimensions,
  accessLevel: input.accessLevel,
  userAccessLevel: input.userAccessLevel,
  access: {
    readable: hasAccess(input.accessLevel, "read"),
    writable: hasAccess(input.accessLevel, "write"),
    userReadable:
      input.userAccessLevel === undefined ||
      hasAccess(input.userAccessLevel, "read"),
    userWritable:
      input.userAccessLevel === undefined ||
      hasAccess(input.userAccessLevel, "write"),
  },
  unsafeRaw: {
    declaredDataType: input.dataTypeNodeId,
    builtInDataType: input.builtInDataType,
  },
});

export const codecMetadata = (metadata: VariableMetadata) => ({
  nodeId: metadata.nodeId,
  valueRank: metadata.valueRank,
  arrayDimensions: metadata.arrayDimensions,
  raw: {
    declaredDataType: metadata.unsafeRaw.declaredDataType,
    builtInDataType: metadata.unsafeRaw.builtInDataType,
  },
});

const sampleBase = <Id extends string>(
  nodeId: Id,
  dataValue: DataValue,
  includeRaw: boolean,
) => ({
  nodeId,
  status: normalizeStatusCode(dataValue.statusCode),
  sourceTimestamp: normalizeTimestamp(dataValue.sourceTimestamp),
  serverTimestamp: normalizeTimestamp(dataValue.serverTimestamp),
  variant: dataValue.value ? normalizeVariantInfo(dataValue.value) : undefined,
  unsafeRaw: includeRaw
    ? {
        dataValue,
        variant: dataValue.value,
      }
    : undefined,
});
