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
  type WriteValueOptions,
} from "node-opcua";
import { Effect } from "effect";

import { runChunked, type BatchOptions } from "../batch.js";
import type { NodeIdString, VariableCapability } from "../common/node-id.js";
import { Codec, type OpcuaCodec } from "../values/codec.js";
import {
  accessDeniedError as makeAccessDeniedError,
  serviceError,
  type OpcuaEncodeError,
  type OpcuaServiceError,
} from "../../OpcuaError.js";
import {
  isGood,
  normalizeNodeId,
  normalizeStatusCode,
  normalizeTimestamp,
  normalizeVariantInfo,
} from "../values/normalize.js";
import { resultFromStatusAndDecode } from "../values/result.js";
import type { OpcuaStructureRuntime } from "../structures/runtime.js";
import type {
  ReadResult,
  ReadableVariableDef,
  ValueOfVariableDef,
  VariableAccess,
  VariableDef,
  VariableMetadata,
  WritableVariableDef,
  WriteResult,
} from "../../OpcuaVariable.js";

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
  Effect.suspend(() => {
    const base = sampleBase(def.nodeId, dataValue, def.includeRaw ?? false);
    return resultFromStatusAndDecode<A, typeof base, ReadResult<A, Id>>({
      statusCode: dataValue.statusCode,
      status: base,
      decode: Codec.decode(
        def.codec,
        dataValue.value,
        dataValue,
        structureRuntime,
      ),
      nonGoodStatus: (base) =>
        ({ _tag: "NonGoodStatus", ...base }) as ReadResult<A, Id>,
      decodeError: (error, base) =>
        ({ _tag: "DecodeError", ...base, error }) as ReadResult<A, Id>,
      value: (value) =>
        ({
          _tag: "Value",
          ...base,
          value: value as unknown as A,
        }) as ReadResult<A, Id>,
    });
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

export type PreparedWriteVariable<
  Def extends WritableVariableDef = WritableVariableDef,
> = {
  readonly def: Def;
  readonly metadata: VariableMetadata;
  readonly value: ValueOfVariableDef<Def>;
  readonly rawNodeId: NodeId;
};

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
