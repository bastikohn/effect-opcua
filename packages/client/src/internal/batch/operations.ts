import { coerceNodeId, type ClientSession, type NodeId } from "node-opcua";
import { Effect } from "effect";

import * as OpcuaError from "../../OpcuaError.js";
import * as OpcuaMethod from "../../OpcuaMethod.js";
import * as OpcuaVariable from "../../OpcuaVariable.js";
import * as MethodArguments from "../method/arguments.js";
import * as MethodOperations from "../method/operations.js";
import * as VariableOperations from "../variable/operations.js";
import {
  normalizeServiceOptions,
  runKeyedBatchOperation,
  validateOptionsShape,
  validateUniqueTargets,
  type KeyedEntry,
} from "./keyed.js";
import { isPlainRecord } from "../common/predicates.js";
import type { makeMetadataService } from "../metadata.js";
import type { makeStructureRuntime } from "../structures/runtime.js";
import type { NodeIdString } from "../common/node-id.js";

export type ServiceLimits = {
  readonly maxNodesPerRequest: number;
  readonly maxConcurrentRequests: number;
};

type ServiceOptions = {
  readonly service?: Partial<ServiceLimits>;
  readonly serviceLimitsOverrides?: Partial<ServiceLimits>;
};

export type ReadManyOptions = ServiceOptions & {
  readonly validation?: "strict" | "none";
};

export type WriteManyOptions = ServiceOptions;
export type CallManyOptions = ServiceOptions;
export type MethodCallOptions = {
  readonly includeRaw?: boolean;
};

export type SessionOperationsState = {
  readonly unsafeRaw: ClientSession;
  readonly metadata: ReturnType<typeof makeMetadataService>;
  readonly structureRuntime: ReturnType<typeof makeStructureRuntime>;
  readonly batching?: SessionBatchingOptions;
};
export type SessionBatchingOptions = {
  readonly readLimits?: Partial<ServiceLimits>;
  readonly writeLimits?: Partial<ServiceLimits>;
  readonly callLimits?: Partial<ServiceLimits>;
};

type AnyWriteManyRecord = Record<
  string,
  readonly [OpcuaVariable.WritableVariableDef, unknown]
>;

type AnyCallManyRecord = Record<
  string,
  | readonly [OpcuaMethod.AnyMethodDef, unknown]
  | readonly [OpcuaMethod.AnyMethodDef, unknown, MethodCallOptions]
>;

type NormalizedReadItem = {
  readonly def: OpcuaVariable.ReadableVariableDef;
  readonly nodeId: NodeIdString;
  readonly rawNodeId: NodeId;
};

type NormalizedWriteItem = {
  readonly def: OpcuaVariable.WritableVariableDef;
  readonly value: unknown;
  readonly nodeId: NodeIdString;
  readonly rawNodeId: NodeId;
};

type NormalizedCallItem = {
  readonly def: OpcuaMethod.AnyMethodDef;
  readonly input: unknown;
  readonly options?: MethodCallOptions;
};

export const readManyWithState = <
  const Items extends Record<string, OpcuaVariable.ReadableVariableDef>,
>(
  state: SessionOperationsState,
  items: Items,
  options?: ReadManyOptions,
): Effect.Effect<OpcuaVariable.ReadManyResult<Items>, OpcuaError.OpcuaError> =>
  runKeyedBatchOperation(items, options, state.batching?.readLimits, {
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
      const prepared: ReadonlyArray<VariableOperations.PreparedReadVariable> =
        entries.map((entry) => ({
          def: entry.normalized.def,
          rawNodeId: entry.normalized.rawNodeId,
        }));
      return VariableOperations.readPreparedVariables(
        state.unsafeRaw,
        prepared,
        state.structureRuntime,
        {
          maxItemsPerRequest: normalizedOptions.maxNodesPerRequest,
          maxConcurrentRequests: normalizedOptions.maxConcurrentRequests,
        },
      );
    },
    toPublicResult: (_entry, raw) => Effect.succeed(raw),
  }) as Effect.Effect<
    OpcuaVariable.ReadManyResult<Items>,
    OpcuaError.OpcuaError
  >;

export const writeManyWithState = <const Items extends AnyWriteManyRecord>(
  state: SessionOperationsState,
  items: Items & OpcuaVariable.WriteManyInput<Items>,
  options?: WriteManyOptions,
): Effect.Effect<OpcuaVariable.WriteManyResult<Items>, OpcuaError.OpcuaError> =>
  runKeyedBatchOperation(items, options, state.batching?.writeLimits, {
    operation: "writeMany",
    normalizeOptions: normalizeWriteManyOptions,
    normalizeItem: normalizeWriteManyItem,
    validateItems: validateUniqueNodeIds("writeMany.items"),
    preflight: (entries) =>
      Effect.forEach(entries, (entry) =>
        Effect.map(
          state.metadata.variable(entry.normalized.def),
          (
            metadata,
          ): KeyedEntry<string, VariableOperations.PreparedWriteVariable> => ({
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
      VariableOperations.writePreparedVariables(
        state.unsafeRaw,
        entries.map((entry) => entry.normalized),
        state.structureRuntime,
        {
          maxItemsPerRequest: normalizedOptions.maxNodesPerRequest,
          maxConcurrentRequests: normalizedOptions.maxConcurrentRequests,
        },
      ),
    toPublicResult: (_entry, raw) => Effect.succeed(raw),
  }) as Effect.Effect<
    OpcuaVariable.WriteManyResult<Items>,
    OpcuaError.OpcuaError
  >;

export const callManyWithState = <const Items extends AnyCallManyRecord>(
  state: SessionOperationsState,
  items: Items & OpcuaMethod.CallManyInput<Items>,
  options?: CallManyOptions,
): Effect.Effect<OpcuaMethod.CallManyResult<Items>, OpcuaError.OpcuaError> =>
  runKeyedBatchOperation(items, options, state.batching?.callLimits, {
    operation: "callMany",
    normalizeOptions: normalizeCallManyOptions,
    normalizeItem: normalizeCallManyItem,
    preflight: (entries) =>
      Effect.forEach(entries, (entry) =>
        Effect.gen(function* () {
          const methodMetadata = yield* state.metadata.method(
            entry.normalized.def,
          );
          const method = yield* MethodOperations.resolveMethod(
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
            } as OpcuaMethod.MethodCallEntry<OpcuaMethod.AnyResolvedMethod>,
          };
        }),
      ),
    execute: (entries, normalizedOptions) =>
      MethodOperations.callMethods(
        state.unsafeRaw,
        entries.map((entry) => entry.normalized),
        state.structureRuntime,
        {
          maxItemsPerRequest: normalizedOptions.maxNodesPerRequest,
          maxConcurrentRequests: normalizedOptions.maxConcurrentRequests,
        },
      ),
    toPublicResult: (_entry, raw) => Effect.succeed(raw),
  }) as Effect.Effect<OpcuaMethod.CallManyResult<Items>, OpcuaError.OpcuaError>;

const normalizeReadManyItem = (
  key: string,
  value: OpcuaVariable.ReadableVariableDef,
): Effect.Effect<NormalizedReadItem, OpcuaError.OpcuaError> =>
  Effect.suspend(() => {
    if (!isReadableVariableDef(value)) {
      return Effect.fail(
        OpcuaError.configurationError({
          operation: "readMany.items",
          key,
          cause: "items must be readable variable definitions",
        }),
      );
    }
    const rawNodeId = coerceNodeIdForKey("readMany.items", key, value.nodeId);
    if (rawNodeId instanceof Error)
      return Effect.fail(rawNodeId as OpcuaError.OpcuaError);
    return Effect.succeed({
      def: value,
      nodeId: rawNodeId.toString(),
      rawNodeId,
    });
  });

const normalizeWriteManyItem = (
  key: string,
  tuple: readonly [OpcuaVariable.WritableVariableDef, unknown],
): Effect.Effect<NormalizedWriteItem, OpcuaError.OpcuaError> =>
  Effect.suspend(() => {
    if (!Array.isArray(tuple) || tuple.length !== 2) {
      return Effect.fail(
        OpcuaError.configurationError({
          operation: "writeMany.items",
          key,
          cause: "write entries must be [definition, value] tuples",
        }),
      );
    }
    const [def, value] = tuple;
    if (!isWritableVariableDef(def)) {
      return Effect.fail(
        OpcuaError.configurationError({
          operation: "writeMany.items",
          key,
          cause: "write entries must use writable variable definitions",
        }),
      );
    }
    const rawNodeId = coerceNodeIdForKey("writeMany.items", key, def.nodeId);
    if (rawNodeId instanceof Error)
      return Effect.fail(rawNodeId as OpcuaError.OpcuaError);
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
    | readonly [OpcuaMethod.AnyMethodDef, unknown]
    | readonly [OpcuaMethod.AnyMethodDef, unknown, MethodCallOptions],
): Effect.Effect<NormalizedCallItem, OpcuaError.OpcuaError> =>
  Effect.suspend(() => {
    if (!Array.isArray(tuple) || (tuple.length !== 2 && tuple.length !== 3)) {
      return Effect.fail(
        OpcuaError.configurationError({
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
        OpcuaError.configurationError({
          operation: "callMany.items",
          key,
          cause: "call entries must use method definitions",
        }),
      );
    }
    const optionsError = MethodArguments.methodCallOptionsError(
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

const validateBatchOptionsShape = (
  operation: string,
  options: ServiceOptions | undefined,
  keys: ReadonlyArray<string> = [],
) =>
  validateOptionsShape(operation, options, [
    ...keys,
    "service",
    "serviceLimitsOverrides",
  ]);

const serviceOptions = (options: ServiceOptions | undefined) =>
  options?.service ?? options?.serviceLimitsOverrides;

const normalizeReadManyOptions = (
  options: ReadManyOptions | undefined,
  defaults: SessionBatchingOptions["readLimits"] | undefined,
): Effect.Effect<
  ServiceLimits & { readonly validation: "strict" | "none" },
  OpcuaError.OpcuaError
> =>
  Effect.gen(function* () {
    yield* validateBatchOptionsShape("readMany.options", options, [
      "validation",
    ]);
    if (
      options?.validation !== undefined &&
      options.validation !== "strict" &&
      options.validation !== "none"
    ) {
      return yield* Effect.fail(
        OpcuaError.configurationError({
          operation: "readMany.options.validation",
          cause: 'validation must be "strict" or "none"',
        }),
      );
    }

    const service = yield* normalizeServiceOptions<
      "maxNodesPerRequest" | "maxConcurrentRequests"
    >({
      serviceLimits: serviceOptions(options),
      defaults,
      serviceOperation: "readMany.options.service",
      defaultsOperation: "OpcuaSession.batching.read",
      allowedKeys: ["maxNodesPerRequest", "maxConcurrentRequests"],
      fallback: {
        maxNodesPerRequest: 250,
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
  defaults: SessionBatchingOptions["writeLimits"] | undefined,
): Effect.Effect<ServiceLimits, OpcuaError.OpcuaError> =>
  Effect.gen(function* () {
    yield* validateBatchOptionsShape("writeMany.options", options);
    return yield* normalizeServiceOptions<
      "maxNodesPerRequest" | "maxConcurrentRequests"
    >({
      serviceLimits: serviceOptions(options),
      defaults,
      serviceOperation: "writeMany.options.service",
      defaultsOperation: "OpcuaSession.batching.write",
      allowedKeys: ["maxNodesPerRequest", "maxConcurrentRequests"],
      fallback: {
        maxNodesPerRequest: 250,
        maxConcurrentRequests: 1,
      },
    });
  });

const normalizeCallManyOptions = (
  options: CallManyOptions | undefined,
  defaults: SessionBatchingOptions["callLimits"] | undefined,
): Effect.Effect<ServiceLimits, OpcuaError.OpcuaError> =>
  Effect.gen(function* () {
    yield* validateBatchOptionsShape("callMany.options", options);
    return yield* normalizeServiceOptions<
      "maxNodesPerRequest" | "maxConcurrentRequests"
    >({
      serviceLimits: serviceOptions(options),
      defaults,
      serviceOperation: "callMany.options.service",
      defaultsOperation: "OpcuaSession.batching.call",
      allowedKeys: ["maxNodesPerRequest", "maxConcurrentRequests"],
      fallback: {
        maxNodesPerRequest: 50,
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
    return OpcuaError.configurationError({ operation, key, nodeId, cause });
  }
};

const isReadableVariableDef = (
  value: unknown,
): value is OpcuaVariable.ReadableVariableDef =>
  isVariableDef(value) &&
  (value.access === "read" || value.access === "readWrite");

const isWritableVariableDef = (
  value: unknown,
): value is OpcuaVariable.WritableVariableDef =>
  isVariableDef(value) &&
  (value.access === "write" || value.access === "readWrite");

const isVariableDef = (value: unknown): value is OpcuaVariable.AnyVariableDef =>
  isPlainRecord(value) &&
  value._tag === "VariableDef" &&
  typeof value.nodeId === "string" &&
  isVariableAccess(value.access) &&
  isPlainRecord(value.codec);

const isMethodDef = (value: unknown): value is OpcuaMethod.AnyMethodDef =>
  isPlainRecord(value) &&
  value._tag === "MethodDef" &&
  typeof value.objectId === "string" &&
  typeof value.methodId === "string";

const isVariableAccess = (
  value: unknown,
): value is OpcuaVariable.VariableAccess =>
  value === "read" || value === "write" || value === "readWrite";
