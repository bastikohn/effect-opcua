import { coerceNodeId, type ClientSession, type NodeId } from "node-opcua";
import { Effect } from "effect";

import { configurationError, type OpcuaError } from "../OpcuaError.js";
import {
  normalizeServiceOptions,
  runKeyedBatchOperation,
  validateOptionsShape,
  validateUniqueTargets,
  type KeyedEntry,
} from "./keyed-batch.js";
import { isPlainRecord } from "./predicates.js";
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
  OpcuaSessionBatchingOptions,
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
  readonly batching?: OpcuaSessionBatchingOptions;
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
  readonly def: ReadableVariableDef;
  readonly nodeId: NodeIdString;
  readonly rawNodeId: NodeId;
};

type NormalizedWriteItem = {
  readonly def: WritableVariableDef;
  readonly value: unknown;
  readonly nodeId: NodeIdString;
  readonly rawNodeId: NodeId;
};

type NormalizedCallItem = {
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
  runKeyedBatchOperation(items, options, state.batching?.read, {
    operation: "readMany",
    normalizeOptions: normalizeReadManyOptions,
    normalizeItem: normalizeReadManyItem,
    validateItems: validateUniqueNodeIds("readMany.items"),
    preflight: (entries, normalizedOptions) =>
      Effect.gen(function* () {
        if (normalizedOptions.validation === "strict") {
          yield* Effect.forEach(
            entries,
            (entry) => state.metadata.variable(entry.normalized.def),
            { discard: true },
          );
        }
        return entries;
      }),
    execute: (entries, normalizedOptions) => {
      const prepared: ReadonlyArray<PreparedReadVariable> = entries.map(
        (entry) => ({
          def: entry.normalized.def,
          rawNodeId: entry.normalized.rawNodeId,
        }),
      );
      return readPreparedVariables(
        state.unsafeRaw,
        prepared,
        state.structureRuntime,
        {
          maxItemsPerRequest: normalizedOptions.maxNodesPerRead,
          maxConcurrentRequests: normalizedOptions.maxConcurrentRequests,
        },
      );
    },
    toPublicResult: (_entry, raw) => Effect.succeed(raw),
  }) as Effect.Effect<ReadManyResult<Items>, OpcuaError>;

export const writeManyWithState = <const Items extends AnyWriteManyRecord>(
  state: SessionOperationsState,
  items: Items & WriteManyInput<Items>,
  options?: WriteManyOptions,
): Effect.Effect<WriteManyResult<Items>, OpcuaError> =>
  runKeyedBatchOperation(items, options, state.batching?.write, {
    operation: "writeMany",
    normalizeOptions: normalizeWriteManyOptions,
    normalizeItem: normalizeWriteManyItem,
    validateItems: validateUniqueNodeIds("writeMany.items"),
    preflight: (entries) =>
      Effect.forEach(entries, (entry) =>
        Effect.map(
          state.metadata.variable(entry.normalized.def),
          (metadata): KeyedEntry<string, PreparedWriteVariable> => ({
            key: entry.key,
            index: entry.index,
            normalized: {
              def: entry.normalized.def,
              metadata,
              value: entry.normalized.value,
              rawNodeId: entry.normalized.rawNodeId,
            },
          }),
        ),
      ),
    execute: (entries, normalizedOptions) =>
      writePreparedVariables(
        state.unsafeRaw,
        entries.map((entry) => entry.normalized),
        state.structureRuntime,
        {
          maxItemsPerRequest: normalizedOptions.maxNodesPerWrite,
          maxConcurrentRequests: normalizedOptions.maxConcurrentRequests,
        },
      ),
    toPublicResult: (_entry, raw) => Effect.succeed(raw),
  }) as Effect.Effect<WriteManyResult<Items>, OpcuaError>;

export const callManyWithState = <const Items extends AnyCallManyRecord>(
  state: SessionOperationsState,
  items: Items & CallManyInput<Items>,
  options?: CallManyOptions,
): Effect.Effect<CallManyResult<Items>, OpcuaError> =>
  runKeyedBatchOperation(items, options, state.batching?.call, {
    operation: "callMany",
    normalizeOptions: normalizeCallManyOptions,
    normalizeItem: normalizeCallManyItem,
    preflight: (entries) =>
      Effect.forEach(entries, (entry) =>
        Effect.gen(function* () {
          const methodMetadata = yield* state.metadata.method(
            entry.normalized.def,
          );
          const method = yield* resolveMethod(
            entry.normalized.def,
            methodMetadata,
          );
          return {
            key: entry.key,
            index: entry.index,
            normalized: {
              method,
              input: entry.normalized.input,
              options: entry.normalized.options,
            } as MethodCallEntry<AnyResolvedMethod>,
          };
        }),
      ),
    execute: (entries, normalizedOptions) =>
      callMethods(
        state.unsafeRaw,
        entries.map((entry) => entry.normalized),
        state.structureRuntime,
        {
          maxItemsPerRequest: normalizedOptions.maxMethodsPerCall,
          maxConcurrentRequests: normalizedOptions.maxConcurrentRequests,
        },
      ),
    toPublicResult: (_entry, raw) => Effect.succeed(raw),
  }) as Effect.Effect<CallManyResult<Items>, OpcuaError>;

const normalizeReadManyItem = (
  key: string,
  value: ReadableVariableDef,
): Effect.Effect<NormalizedReadItem, OpcuaError> =>
  Effect.suspend(() => {
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
    if (rawNodeId instanceof Error) return Effect.fail(rawNodeId as OpcuaError);
    return Effect.succeed({
      def: value,
      nodeId: rawNodeId.toString(),
      rawNodeId,
    });
  });

const normalizeWriteManyItem = (
  key: string,
  tuple: readonly [WritableVariableDef, unknown],
): Effect.Effect<NormalizedWriteItem, OpcuaError> =>
  Effect.suspend(() => {
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
    if (rawNodeId instanceof Error) return Effect.fail(rawNodeId as OpcuaError);
    return Effect.succeed({
      def,
      value,
      nodeId: rawNodeId.toString(),
      rawNodeId,
    });
  });

const normalizeCallManyItem = (
  key: string,
  tuple:
    | readonly [AnyMethodDef, unknown]
    | readonly [AnyMethodDef, unknown, MethodCallOptions],
): Effect.Effect<NormalizedCallItem, OpcuaError> =>
  Effect.suspend(() => {
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
    return Effect.succeed({
      def,
      input,
      options: itemOptions as MethodCallOptions | undefined,
    });
  });

const validateUniqueNodeIds =
  (operation: string) =>
  (
    entries: ReadonlyArray<
      KeyedEntry<string, { readonly nodeId: NodeIdString }>
    >,
  ) =>
    validateUniqueTargets(entries, {
      operation,
      target: (entry) => entry.normalized.nodeId,
      duplicateCause: (_target, previousKey) =>
        `duplicate NodeId also used by ${previousKey}`,
      errorContext: (_entry, nodeId) => ({ nodeId }),
    });

const normalizeReadManyOptions = (
  options: ReadManyOptions | undefined,
  defaults: OpcuaSessionBatchingOptions["read"] | undefined,
): Effect.Effect<
  {
    readonly validation: "strict" | "none";
    readonly maxNodesPerRead: number;
    readonly maxConcurrentRequests: number;
  },
  OpcuaError
> =>
  Effect.gen(function* () {
    yield* validateOptionsShape("readMany.options", options, [
      "validation",
      "service",
    ]);
    if (
      options?.validation !== undefined &&
      options.validation !== "strict" &&
      options.validation !== "none"
    ) {
      return yield* Effect.fail(
        configurationError({
          operation: "readMany.options.validation",
          cause: 'validation must be "strict" or "none"',
        }),
      );
    }

    const service = yield* normalizeServiceOptions<
      "maxNodesPerRead" | "maxConcurrentRequests"
    >({
      service: options?.service,
      defaults,
      serviceOperation: "readMany.options.service",
      defaultsOperation: "OpcuaSession.batching.read",
      allowedKeys: ["maxNodesPerRead", "maxConcurrentRequests"],
      fallback: {
        maxNodesPerRead: 250,
        maxConcurrentRequests: 1,
      },
    });
    return {
      validation: options?.validation ?? "strict",
      ...service,
    };
  });

const normalizeWriteManyOptions = (
  options: WriteManyOptions | undefined,
  defaults: OpcuaSessionBatchingOptions["write"] | undefined,
): Effect.Effect<
  {
    readonly maxNodesPerWrite: number;
    readonly maxConcurrentRequests: number;
  },
  OpcuaError
> =>
  Effect.gen(function* () {
    yield* validateOptionsShape("writeMany.options", options, ["service"]);
    return yield* normalizeServiceOptions<
      "maxNodesPerWrite" | "maxConcurrentRequests"
    >({
      service: options?.service,
      defaults,
      serviceOperation: "writeMany.options.service",
      defaultsOperation: "OpcuaSession.batching.write",
      allowedKeys: ["maxNodesPerWrite", "maxConcurrentRequests"],
      fallback: {
        maxNodesPerWrite: 250,
        maxConcurrentRequests: 1,
      },
    });
  });

const normalizeCallManyOptions = (
  options: CallManyOptions | undefined,
  defaults: OpcuaSessionBatchingOptions["call"] | undefined,
): Effect.Effect<
  {
    readonly maxMethodsPerCall: number;
    readonly maxConcurrentRequests: number;
  },
  OpcuaError
> =>
  Effect.gen(function* () {
    yield* validateOptionsShape("callMany.options", options, ["service"]);
    return yield* normalizeServiceOptions<
      "maxMethodsPerCall" | "maxConcurrentRequests"
    >({
      service: options?.service,
      defaults,
      serviceOperation: "callMany.options.service",
      defaultsOperation: "OpcuaSession.batching.call",
      allowedKeys: ["maxMethodsPerCall", "maxConcurrentRequests"],
      fallback: {
        maxMethodsPerCall: 50,
        maxConcurrentRequests: 1,
      },
    });
  });

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
