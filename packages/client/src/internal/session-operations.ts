import { coerceNodeId, type ClientSession, type NodeId } from "node-opcua";
import { Effect } from "effect";

import { keyedResults } from "./collections.js";
import { configurationError, type OpcuaError } from "../OpcuaError.js";
import { isPlainRecord, positiveInteger } from "./predicates.js";
import type { makeMetadataService } from "./metadata.js";
import type { makeStructureRuntime } from "./structure-runtime.js";
import type { NodeIdString } from "./capabilities.js";
import {
  callMethods,
  methodCallOptionsError,
  resolveMethod,
  type AnyMethodDef,
  type AnyResolvedMethod,
  type MethodCallEntry,
  type MethodCallOptions,
} from "../OpcuaMethod.js";
import {
  readPreparedVariables,
  writePreparedVariables,
  type AnyVariableDef,
  type PreparedReadVariable,
  type PreparedWriteVariable,
  type ReadableVariableDef,
  type VariableAccess,
  type WritableVariableDef,
} from "../OpcuaVariable.js";
import type {
  CallManyInput,
  CallManyOptions,
  CallManyResult,
  ReadManyOptions,
  ReadManyResult,
  WriteManyInput,
  WriteManyOptions,
  WriteManyResult,
} from "../OpcuaSession.js";

export type SessionOperationsState = {
  readonly unsafeRaw: ClientSession;
  readonly metadata: ReturnType<typeof makeMetadataService>;
  readonly structureRuntime: ReturnType<typeof makeStructureRuntime>;
};

type AnyWriteManyRecord = Record<
  string,
  readonly [WritableVariableDef, unknown]
>;

type AnyCallManyRecord = Record<
  string,
  | readonly [AnyMethodDef, unknown]
  | readonly [AnyMethodDef, unknown, MethodCallOptions]
>;

type NormalizedReadItem = {
  readonly key: string;
  readonly def: ReadableVariableDef;
  readonly nodeId: NodeIdString;
  readonly rawNodeId: NodeId;
};

type NormalizedWriteItem = {
  readonly key: string;
  readonly def: WritableVariableDef;
  readonly value: unknown;
  readonly nodeId: NodeIdString;
  readonly rawNodeId: NodeId;
};

type NormalizedCallItem = {
  readonly key: string;
  readonly def: AnyMethodDef;
  readonly input: unknown;
  readonly options?: MethodCallOptions;
};

export const readManyWithState = <
  const Items extends Record<string, ReadableVariableDef>,
>(
  state: SessionOperationsState,
  items: Items,
  options?: ReadManyOptions,
): Effect.Effect<ReadManyResult<Items>, OpcuaError> =>
  Effect.gen(function* () {
    const normalizedOptions = yield* normalizeReadManyOptions(options);
    const normalized = yield* normalizeReadManyItems(items);
    if (normalized.length === 0) return {} as ReadManyResult<Items>;

    if (normalizedOptions.validation === "strict") {
      yield* Effect.forEach(
        normalized,
        (item) => state.metadata.variable(item.def),
        { discard: true },
      );
    }

    const prepared: ReadonlyArray<PreparedReadVariable> = normalized.map(
      (item) => ({
        def: item.def,
        rawNodeId: item.rawNodeId,
      }),
    );
    const results = yield* readPreparedVariables(
      state.unsafeRaw,
      prepared,
      state.structureRuntime,
      {
        maxItemsPerRequest: normalizedOptions.maxNodesPerRead,
        maxConcurrentRequests: normalizedOptions.maxConcurrentRequests,
      },
    );
    return keyedResults(normalized, results) as ReadManyResult<Items>;
  });

export const writeManyWithState = <const Items extends AnyWriteManyRecord>(
  state: SessionOperationsState,
  items: Items & WriteManyInput<Items>,
  options?: WriteManyOptions,
): Effect.Effect<WriteManyResult<Items>, OpcuaError> =>
  Effect.gen(function* () {
    const normalizedOptions = yield* normalizeWriteManyOptions(options);
    const normalized = yield* normalizeWriteManyItems(items);
    if (normalized.length === 0) return {} as WriteManyResult<Items>;

    const entries: ReadonlyArray<PreparedWriteVariable> = yield* Effect.forEach(
      normalized,
      (item) =>
        Effect.map(state.metadata.variable(item.def), (metadata) => ({
          def: item.def,
          metadata,
          value: item.value,
          rawNodeId: item.rawNodeId,
        })),
    );
    const results = yield* writePreparedVariables(
      state.unsafeRaw,
      entries,
      state.structureRuntime,
      {
        maxItemsPerRequest: normalizedOptions.maxNodesPerWrite,
        maxConcurrentRequests: normalizedOptions.maxConcurrentRequests,
      },
    );
    return keyedResults(normalized, results) as WriteManyResult<Items>;
  });

export const callManyWithState = <const Items extends AnyCallManyRecord>(
  state: SessionOperationsState,
  items: Items & CallManyInput<Items>,
  options?: CallManyOptions,
): Effect.Effect<CallManyResult<Items>, OpcuaError> =>
  Effect.gen(function* () {
    const normalizedOptions = yield* normalizeCallManyOptions(options);
    const normalized = yield* normalizeCallManyItems(items);
    if (normalized.length === 0) return {} as CallManyResult<Items>;

    const methods = yield* Effect.forEach(normalized, (item) =>
      Effect.gen(function* () {
        const methodMetadata = yield* state.metadata.method(item.def);
        return yield* resolveMethod(item.def, methodMetadata);
      }),
    );
    const entries = normalized.map((item, index) => ({
      method: methods[index]!,
      input: item.input,
      options: item.options,
    })) as ReadonlyArray<MethodCallEntry<AnyResolvedMethod>>;
    const results = yield* callMethods(
      state.unsafeRaw,
      entries,
      state.structureRuntime,
      {
        maxItemsPerRequest: normalizedOptions.maxMethodsPerCall,
        maxConcurrentRequests: normalizedOptions.maxConcurrentRequests,
      },
    );
    return keyedResults(normalized, results) as CallManyResult<Items>;
  });

const normalizeReadManyItems = (
  items: unknown,
): Effect.Effect<ReadonlyArray<NormalizedReadItem>, OpcuaError> =>
  Effect.suspend(() => {
    const dictionaryError = keyedDictionaryError("readMany", items);
    if (dictionaryError) return Effect.fail(dictionaryError);

    const normalized: Array<NormalizedReadItem> = [];
    const seen = new Map<string, string>();
    for (const [key, value] of Object.entries(
      items as Record<string, unknown>,
    )) {
      if (!isReadableVariableDef(value)) {
        return Effect.fail(
          configurationError({
            operation: "readMany.items",
            key,
            cause: "items must be readable variable definitions",
          }),
        );
      }
      const rawNodeId = coerceNodeIdForKey("readMany.items", key, value.nodeId);
      if (rawNodeId instanceof Error)
        return Effect.fail(rawNodeId as OpcuaError);
      const nodeId = rawNodeId.toString();
      const duplicate = seen.get(nodeId);
      if (duplicate) {
        return Effect.fail(
          configurationError({
            operation: "readMany.items",
            key,
            nodeId,
            cause: `duplicate NodeId also used by ${duplicate}`,
          }),
        );
      }
      seen.set(nodeId, key);
      normalized.push({ key, def: value, nodeId, rawNodeId });
    }
    return Effect.succeed(normalized);
  });

const normalizeWriteManyItems = (
  items: unknown,
): Effect.Effect<ReadonlyArray<NormalizedWriteItem>, OpcuaError> =>
  Effect.suspend(() => {
    const dictionaryError = keyedDictionaryError("writeMany", items);
    if (dictionaryError) return Effect.fail(dictionaryError);

    const normalized: Array<NormalizedWriteItem> = [];
    const seen = new Map<string, string>();
    for (const [key, tuple] of Object.entries(
      items as Record<string, unknown>,
    )) {
      if (!Array.isArray(tuple) || tuple.length !== 2) {
        return Effect.fail(
          configurationError({
            operation: "writeMany.items",
            key,
            cause: "write entries must be [definition, value] tuples",
          }),
        );
      }
      const [def, value] = tuple;
      if (!isWritableVariableDef(def)) {
        return Effect.fail(
          configurationError({
            operation: "writeMany.items",
            key,
            cause: "write entries must use writable variable definitions",
          }),
        );
      }
      const rawNodeId = coerceNodeIdForKey("writeMany.items", key, def.nodeId);
      if (rawNodeId instanceof Error)
        return Effect.fail(rawNodeId as OpcuaError);
      const nodeId = rawNodeId.toString();
      const duplicate = seen.get(nodeId);
      if (duplicate) {
        return Effect.fail(
          configurationError({
            operation: "writeMany.items",
            key,
            nodeId,
            cause: `duplicate NodeId also used by ${duplicate}`,
          }),
        );
      }
      seen.set(nodeId, key);
      normalized.push({ key, def, value, nodeId, rawNodeId });
    }
    return Effect.succeed(normalized);
  });

const normalizeCallManyItems = (
  items: unknown,
): Effect.Effect<ReadonlyArray<NormalizedCallItem>, OpcuaError> =>
  Effect.suspend(() => {
    const dictionaryError = keyedDictionaryError("callMany", items);
    if (dictionaryError) return Effect.fail(dictionaryError);

    const normalized: Array<NormalizedCallItem> = [];
    for (const [key, tuple] of Object.entries(
      items as Record<string, unknown>,
    )) {
      if (!Array.isArray(tuple) || (tuple.length !== 2 && tuple.length !== 3)) {
        return Effect.fail(
          configurationError({
            operation: "callMany.items",
            key,
            cause:
              "call entries must be [definition, input] or [definition, input, options] tuples",
          }),
        );
      }
      const [def, input, itemOptions] = tuple;
      if (!isMethodDef(def)) {
        return Effect.fail(
          configurationError({
            operation: "callMany.items",
            key,
            cause: "call entries must use method definitions",
          }),
        );
      }
      const optionsError = methodCallOptionsError(
        "callMany.items.options",
        def.objectId,
        def.methodId,
        itemOptions as MethodCallOptions | undefined,
      );
      if (optionsError) return Effect.fail(optionsError);
      normalized.push({
        key,
        def,
        input,
        options: itemOptions as MethodCallOptions | undefined,
      });
    }
    return Effect.succeed(normalized);
  });

const normalizeReadManyOptions = (
  options: ReadManyOptions | undefined,
): Effect.Effect<
  {
    readonly validation: "strict" | "none";
    readonly maxNodesPerRead: number;
    readonly maxConcurrentRequests: number;
  },
  OpcuaError
> =>
  Effect.suspend(() => {
    const error = optionsShapeError("readMany.options", options, [
      "validation",
      "service",
    ]);
    if (error) return Effect.fail(error);
    if (
      options?.validation !== undefined &&
      options.validation !== "strict" &&
      options.validation !== "none"
    ) {
      return Effect.fail(
        configurationError({
          operation: "readMany.options.validation",
          cause: 'validation must be "strict" or "none"',
        }),
      );
    }
    const service = options?.service;
    const serviceError = serviceOptionsError(
      "readMany.options.service",
      service,
      ["maxNodesPerRead", "maxConcurrentRequests"],
    );
    if (serviceError) return Effect.fail(serviceError);
    return Effect.succeed({
      validation: options?.validation ?? "strict",
      maxNodesPerRead: service?.maxNodesPerRead ?? 250,
      maxConcurrentRequests: service?.maxConcurrentRequests ?? 1,
    });
  });

const normalizeWriteManyOptions = (
  options: WriteManyOptions | undefined,
): Effect.Effect<
  {
    readonly maxNodesPerWrite: number;
    readonly maxConcurrentRequests: number;
  },
  OpcuaError
> =>
  Effect.suspend(() => {
    const error = optionsShapeError("writeMany.options", options, ["service"]);
    if (error) return Effect.fail(error);
    const service = options?.service;
    const serviceError = serviceOptionsError(
      "writeMany.options.service",
      service,
      ["maxNodesPerWrite", "maxConcurrentRequests"],
    );
    if (serviceError) return Effect.fail(serviceError);
    return Effect.succeed({
      maxNodesPerWrite: service?.maxNodesPerWrite ?? 250,
      maxConcurrentRequests: service?.maxConcurrentRequests ?? 1,
    });
  });

const normalizeCallManyOptions = (
  options: CallManyOptions | undefined,
): Effect.Effect<
  {
    readonly maxMethodsPerCall: number;
    readonly maxConcurrentRequests: number;
  },
  OpcuaError
> =>
  Effect.suspend(() => {
    const error = optionsShapeError("callMany.options", options, ["service"]);
    if (error) return Effect.fail(error);
    const service = options?.service;
    const serviceError = serviceOptionsError(
      "callMany.options.service",
      service,
      ["maxMethodsPerCall", "maxConcurrentRequests"],
    );
    if (serviceError) return Effect.fail(serviceError);
    return Effect.succeed({
      maxMethodsPerCall: service?.maxMethodsPerCall ?? 50,
      maxConcurrentRequests: service?.maxConcurrentRequests ?? 1,
    });
  });

const optionsShapeError = (
  operation: string,
  value: unknown,
  allowedKeys: ReadonlyArray<string>,
) => {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    return configurationError({
      operation,
      cause: "options must be an object",
    });
  }
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  return unknown.length > 0
    ? configurationError({
        operation,
        cause: `unsupported option: ${unknown.join(", ")}`,
      })
    : undefined;
};

const serviceOptionsError = (
  operation: string,
  value: unknown,
  allowedKeys: ReadonlyArray<string>,
) => {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    return configurationError({
      operation,
      cause: "service options must be an object",
    });
  }
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      return configurationError({
        operation,
        cause: `unsupported service option: ${key}`,
      });
    }
  }
  for (const key of allowedKeys) {
    const optionValue = value[key];
    if (optionValue !== undefined && !positiveInteger(optionValue)) {
      return configurationError({
        operation,
        cause: `${key} must be a positive integer`,
      });
    }
  }
  return undefined;
};

const keyedDictionaryError = (operation: string, value: unknown) => {
  if (isPlainRecord(value)) return undefined;
  return configurationError({
    operation,
    cause: "items must be a plain keyed record",
  });
};

const coerceNodeIdForKey = (
  operation: string,
  key: string,
  nodeId: NodeIdString,
) => {
  try {
    return coerceNodeId(nodeId);
  } catch (cause) {
    return configurationError({ operation, key, nodeId, cause });
  }
};

const isReadableVariableDef = (value: unknown): value is ReadableVariableDef =>
  isVariableDef(value) &&
  (value.access === "read" || value.access === "readWrite");

const isWritableVariableDef = (value: unknown): value is WritableVariableDef =>
  isVariableDef(value) &&
  (value.access === "write" || value.access === "readWrite");

const isVariableDef = (value: unknown): value is AnyVariableDef =>
  isPlainRecord(value) &&
  value._tag === "VariableDef" &&
  typeof value.nodeId === "string" &&
  isVariableAccess(value.access) &&
  isPlainRecord(value.codec);

const isMethodDef = (value: unknown): value is AnyMethodDef =>
  isPlainRecord(value) &&
  value._tag === "MethodDef" &&
  typeof value.objectId === "string" &&
  typeof value.methodId === "string";

const isVariableAccess = (value: unknown): value is VariableAccess =>
  value === "read" || value === "write" || value === "readWrite";
