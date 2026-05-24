import {
  ClientSubscription,
  coerceNodeId,
  resolveNodeId,
  type ClientSession,
  type NodeId,
  type UserIdentityInfo,
} from "node-opcua";
import {
  Context,
  Duration,
  Effect,
  Layer,
  PubSub,
  Scope,
  Semaphore,
  Stream,
} from "effect";

import {
  DEFAULT_BROWSE_DIRECTION,
  DEFAULT_BROWSE_INCLUDE_SUBTYPES,
  DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
  DEFAULT_BROWSE_NODE_CLASS_MASK,
  DEFAULT_BROWSE_REFERENCE_TYPE_ID,
  DEFAULT_BROWSE_RESULT_MASK,
  DEFAULT_LIFETIME_COUNT,
  DEFAULT_MAX_KEEP_ALIVE_COUNT,
  DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH,
  DEFAULT_PRIORITY,
  DEFAULT_PUBLISHING_ENABLED,
  EVENT_BUFFER_SIZE,
} from "./internal/constants.js";
import { OpcuaClient } from "./OpcuaClient.js";
import {
  browseContinuationError,
  browseOptionsError,
  browseWithMaxReferences,
  normalizeBrowseResult,
  type OpcuaBrowseChildrenOptions,
  type OpcuaBrowseChildrenResult,
  type OpcuaBrowseContinuation,
  type OpcuaBrowseOptions,
  type OpcuaBrowseResult,
} from "./internal/browse.js";
import {
  configurationError,
  serviceError,
  sessionCloseError,
  sessionCreateError,
  subscriptionCreateError,
  type OpcuaError,
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaMethodNotExecutableError,
  OpcuaServiceError,
  OpcuaSessionCloseError,
  OpcuaSessionCreateError,
  OpcuaSubscriptionCreateError,
} from "./OpcuaError.js";
import {
  type OpcuaSessionEvent,
  type OpcuaSubscriptionEvent,
  wireSessionEvents,
  wireSubscriptionEvents,
} from "./internal/events.js";
import { makeMetadataService } from "./internal/metadata.js";
import {
  makeSubscription as makeSubscriptionImpl,
  type OpcuaSubscription,
} from "./OpcuaSubscription.js";
import { makeStructureRuntime } from "./internal/structure-runtime.js";
import type { NodeIdString } from "./internal/capabilities.js";
import type { BatchOptions } from "./internal/batch.js";
import {
  callMethods,
  makeMethodHandle,
  methodCallOptionsError,
  type AnyMethodHandle,
  type AnyMethodDef,
  type InputOfMethodDef,
  type MethodCallEntry,
  type MethodCallOptions,
  type MethodCallResult,
  type MethodDef,
  type MethodHandle,
  type OutputOfMethodDef,
} from "./OpcuaMethod.js";
import {
  makeVariableHandle,
  readPreparedVariables,
  type AnyVariableDef,
  type PreparedReadVariable,
  type ReadableVariableDef,
  type ReadResult,
  type VariableAccess,
  type VariableDef,
  type VariableHandle,
  type ValueOfVariableDef,
  type WritableVariableDef,
  type WritableVariableHandle,
  type WriteEntry,
  type WriteResult,
  writeVariables,
} from "./OpcuaVariable.js";

export type { OpcuaBrowseReference } from "./internal/browse.js";

export type HandleDef = AnyVariableDef | AnyMethodDef;

export type HandleOf<Def> =
  Def extends VariableDef<infer Id, infer A, infer Access>
    ? VariableHandle<Id, A, Access>
    : Def extends MethodDef<
          infer ObjectId,
          infer MethodId,
          infer Input,
          infer Output
        >
      ? MethodHandle<
          InputOfMethodDef<MethodDef<ObjectId, MethodId, Input, Output>>,
          OutputOfMethodDef<MethodDef<ObjectId, MethodId, Input, Output>>,
          ObjectId,
          MethodId
        >
      : never;

export type HandlesOf<Defs extends ReadonlyArray<unknown>> = {
  readonly [Index in keyof Defs]: HandleOf<Defs[Index]>;
};

export type ReadManyOptions = {
  readonly validation?: "strict" | "none";
  readonly service?: {
    readonly maxNodesPerRead?: number;
    readonly maxConcurrentRequests?: number;
  };
};

export type WriteManyOptions = {
  readonly service?: {
    readonly maxNodesPerWrite?: number;
    readonly maxConcurrentRequests?: number;
  };
};

export type CallManyOptions = {
  readonly service?: {
    readonly maxMethodsPerCall?: number;
    readonly maxConcurrentRequests?: number;
  };
};

export type ReadManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends VariableDef<
    infer Id,
    infer A,
    "read" | "readWrite"
  >
    ? ReadResult<A, Id>
    : never;
};

export type WriteManyItem<
  Def extends WritableVariableDef = WritableVariableDef,
> = readonly [def: Def, value: ValueOfVariableDef<Def>];

type AnyWriteManyRecord = Record<
  string,
  readonly [WritableVariableDef, unknown]
>;

export type WriteManyInput<Items extends AnyWriteManyRecord> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends WritableVariableDef,
    unknown,
  ]
    ? readonly [def: Def, value: ValueOfVariableDef<Def>]
    : never;
};

export type WriteManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends WritableVariableDef,
    unknown,
  ]
    ? Def extends VariableDef<infer Id, unknown, VariableAccess>
      ? WriteResult<Id>
      : never
    : never;
};

export type CallManyItem<Def extends AnyMethodDef = AnyMethodDef> =
  | readonly [def: Def, input: InputOfMethodDef<Def>]
  | readonly [
      def: Def,
      input: InputOfMethodDef<Def>,
      options: MethodCallOptions,
    ];

type AnyCallManyRecord = Record<
  string,
  | readonly [AnyMethodDef, unknown]
  | readonly [AnyMethodDef, unknown, MethodCallOptions]
>;

export type CallManyInput<Items extends AnyCallManyRecord> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends AnyMethodDef,
    unknown,
    MethodCallOptions,
  ]
    ? readonly [
        def: Def,
        input: InputOfMethodDef<Def>,
        options: MethodCallOptions,
      ]
    : Items[Key] extends readonly [infer Def extends AnyMethodDef, unknown]
      ? readonly [def: Def, input: InputOfMethodDef<Def>]
      : never;
};

export type CallManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends AnyMethodDef,
    unknown,
    ...ReadonlyArray<unknown>,
  ]
    ? MethodCallResult<
        OutputOfMethodDef<Def>,
        Def["objectId"],
        Def["methodId"]
      >
    : never;
};

type HandleError = OpcuaError;

export type OpcuaSession = {
  readonly makeHandle: {
    <const Id extends string, A, const Access extends VariableAccess>(
      def: VariableDef<Id, A, Access>,
    ): Effect.Effect<VariableHandle<Id, A, Access>, HandleError>;
    <const Spec extends AnyMethodDef>(
      def: Spec,
    ): Effect.Effect<
      MethodHandle<
        InputOfMethodDef<Spec>,
        OutputOfMethodDef<Spec>,
        Spec["objectId"],
        Spec["methodId"]
      >,
      HandleError
    >;
  };
  readonly readMany: <const Items extends Record<string, ReadableVariableDef>>(
    items: Items,
    options?: ReadManyOptions,
  ) => Effect.Effect<ReadManyResult<Items>, OpcuaError>;
  readonly writeMany: <const Items extends AnyWriteManyRecord>(
    items: Items & WriteManyInput<Items>,
    options?: WriteManyOptions,
  ) => Effect.Effect<WriteManyResult<Items>, OpcuaError>;
  readonly callMany: <const Items extends AnyCallManyRecord>(
    items: Items & CallManyInput<Items>,
    options?: CallManyOptions,
  ) => Effect.Effect<CallManyResult<Items>, OpcuaError>;
  readonly browse: (
    input: OpcuaBrowseOptions,
  ) => Effect.Effect<OpcuaBrowseResult, OpcuaError>;
  readonly browseNext: (
    continuation: OpcuaBrowseContinuation & { readonly includeRaw?: boolean },
  ) => Effect.Effect<OpcuaBrowseResult, OpcuaError>;
  readonly releaseBrowseContinuation: (
    continuation: OpcuaBrowseContinuation,
  ) => Effect.Effect<void, OpcuaError>;
  readonly browseChildren: (
    nodeId: NodeIdString,
    options?: OpcuaBrowseChildrenOptions,
  ) => Effect.Effect<OpcuaBrowseChildrenResult, OpcuaError>;
  readonly makeSubscription: (options: {
    readonly publishingInterval: Duration.Duration;
    readonly lifetimeCount?: number;
    readonly maxKeepAliveCount?: number;
    readonly maxNotificationsPerPublish?: number;
    readonly publishingEnabled?: boolean;
    readonly priority?: number;
  }) => Effect.Effect<
    OpcuaSubscription,
    OpcuaError,
    Scope.Scope
  >;
  readonly events: Stream.Stream<OpcuaSessionEvent>;
  readonly unsafeRaw: ClientSession;
};

type SessionState = {
  readonly unsafeRaw: ClientSession;
  readonly metadata: ReturnType<typeof makeMetadataService>;
  readonly structureRuntime: ReturnType<typeof makeStructureRuntime>;
  readonly generation: () => number;
};

export const OpcuaSession = Object.assign(
  Context.Service<OpcuaSession>("@effect-opcua/client/OpcuaSession"),
  {
    layer: (options?: { readonly userIdentity?: UserIdentityInfo }) =>
      Layer.effect(
        OpcuaSession,
        Effect.gen(function* () {
          const client = yield* OpcuaClient;
          const events =
            yield* PubSub.sliding<OpcuaSessionEvent>(EVENT_BUFFER_SIZE);
          const raw = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: () => client.unsafeRaw.createSession(options?.userIdentity),
              catch: (cause) => sessionCreateError({ cause }),
            }),
            (session) =>
              Effect.tryPromise({
                try: () => session.close(true),
                catch: (cause) => sessionCloseError({ cause }),
              }).pipe(Effect.ignore, Effect.andThen(PubSub.shutdown(events))),
          );
          yield* wireSessionEvents(raw, events);
          return yield* makeSession(raw, events);
        }),
      ),
  },
);

export const layer = OpcuaSession.layer;

export function makeHandle<
  const Id extends string,
  A,
  const Access extends VariableAccess,
>(
  def: VariableDef<Id, A, Access>,
): Effect.Effect<VariableHandle<Id, A, Access>, OpcuaError, OpcuaSession>;
export function makeHandle<const Spec extends AnyMethodDef>(
  def: Spec,
): Effect.Effect<
  MethodHandle<
    InputOfMethodDef<Spec>,
    OutputOfMethodDef<Spec>,
    Spec["objectId"],
    Spec["methodId"]
  >,
  OpcuaError,
  OpcuaSession
>;
export function makeHandle(
  def: HandleDef,
): Effect.Effect<HandleOf<HandleDef>, OpcuaError, OpcuaSession> {
  return Effect.flatMap(OpcuaSession, (session) =>
    session.makeHandle(def as never),
  ) as Effect.Effect<HandleOf<HandleDef>, OpcuaError, OpcuaSession>;
}

export const readMany = <
  const Items extends Record<string, ReadableVariableDef>,
>(
  items: Items,
  options?: ReadManyOptions,
) => Effect.flatMap(OpcuaSession, (session) => session.readMany(items, options));

export const writeMany = <const Items extends AnyWriteManyRecord>(
  items: Items & WriteManyInput<Items>,
  options?: WriteManyOptions,
) =>
  Effect.flatMap(OpcuaSession, (session) => session.writeMany(items, options));

export const callMany = <const Items extends AnyCallManyRecord>(
  items: Items & CallManyInput<Items>,
  options?: CallManyOptions,
) => Effect.flatMap(OpcuaSession, (session) => session.callMany(items, options));

export const makeSubscription = (
  options: Parameters<OpcuaSession["makeSubscription"]>[0],
) =>
  Effect.flatMap(OpcuaSession, (session) => session.makeSubscription(options));

export const makeSession = (
  unsafeRaw: ClientSession,
  events: PubSub.PubSub<OpcuaSessionEvent>,
): Effect.Effect<OpcuaSession, never, Scope.Scope> =>
  Effect.gen(function* () {
    const browseSemaphore = Semaphore.makeUnsafe(1);
    const structureRuntime = makeStructureRuntime(unsafeRaw);
    const metadata = makeMetadataService(unsafeRaw, structureRuntime);
    let generation = 0;
    const state: SessionState = {
      unsafeRaw,
      metadata,
      structureRuntime,
      generation: () => generation,
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const listener = () => {
          generation++;
          Effect.runSync(
            metadata.invalidate.pipe(
              Effect.andThen(structureRuntime.invalidate),
            ),
          );
        };
        unsafeRaw.on("session_restored", listener);
        return listener;
      }),
      (listener) =>
        Effect.sync(() => {
          if ("off" in unsafeRaw && typeof unsafeRaw.off === "function") {
            unsafeRaw.off("session_restored", listener);
          } else {
            unsafeRaw.removeListener("session_restored", listener);
          }
        }),
    );

    const makeHandle: OpcuaSession["makeHandle"] = ((def: HandleDef) =>
      Effect.gen(function* () {
        if (def._tag === "VariableDef") {
          const variableMetadata = yield* metadata.variable(def);
          return makeVariableHandle(
            unsafeRaw,
            def,
            variableMetadata,
            structureRuntime,
          );
        }
        const methodMetadata = yield* metadata.method(def);
        return yield* makeMethodHandle(
          unsafeRaw,
          def,
          methodMetadata,
          structureRuntime,
        );
      })) as OpcuaSession["makeHandle"];

    const readMany: OpcuaSession["readMany"] = (items, options) =>
      readManyWithState(state, items, options);

    const writeMany: OpcuaSession["writeMany"] = (items, options) =>
      writeManyWithState(state, items, options);

    const callMany: OpcuaSession["callMany"] = (items, options) =>
      callManyWithState(state, items, options);

    const makeSubscription: OpcuaSession["makeSubscription"] = (options) =>
      Effect.gen(function* () {
        const subscriptionEvents =
          yield* PubSub.sliding<OpcuaSubscriptionEvent>(EVENT_BUFFER_SIZE);
        const rawSubscription = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: async () =>
              ClientSubscription.create(unsafeRaw, {
                requestedPublishingInterval: durationMillis(
                  options.publishingInterval,
                ),
                requestedLifetimeCount:
                  options.lifetimeCount ?? DEFAULT_LIFETIME_COUNT,
                requestedMaxKeepAliveCount:
                  options.maxKeepAliveCount ?? DEFAULT_MAX_KEEP_ALIVE_COUNT,
                maxNotificationsPerPublish:
                  options.maxNotificationsPerPublish ??
                  DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH,
                publishingEnabled:
                  options.publishingEnabled ?? DEFAULT_PUBLISHING_ENABLED,
                priority: options.priority ?? DEFAULT_PRIORITY,
              }),
            catch: (cause) => subscriptionCreateError({ cause }),
          }),
          (subscription) =>
            Effect.tryPromise({
              try: () => subscription.terminate(),
              catch: (cause) => subscriptionCreateError({ cause }),
            }).pipe(
              Effect.ignore,
              Effect.andThen(PubSub.shutdown(subscriptionEvents)),
            ),
        );
        yield* wireSubscriptionEvents(rawSubscription, subscriptionEvents);
        return makeSubscriptionImpl(
          rawSubscription,
          subscriptionEvents,
          structureRuntime,
          (def) => makeHandle(def) as never,
        );
      });

    const browse: OpcuaSession["browse"] = (input) =>
      Effect.gen(function* () {
        const validationError = browseOptionsError(input);
        if (validationError) return yield* Effect.fail(validationError);

        const result = yield* Effect.tryPromise({
          try: () =>
            browseWithMaxReferences(
              unsafeRaw,
              {
                nodeId: resolveNodeId(input.nodeId),
                referenceTypeId: resolveNodeId(
                  input.referenceTypeId ?? DEFAULT_BROWSE_REFERENCE_TYPE_ID,
                ),
                browseDirection:
                  input.browseDirection ?? DEFAULT_BROWSE_DIRECTION,
                includeSubtypes:
                  input.includeSubtypes ?? DEFAULT_BROWSE_INCLUDE_SUBTYPES,
                nodeClassMask:
                  input.nodeClassMask ?? DEFAULT_BROWSE_NODE_CLASS_MASK,
                resultMask: input.resultMask ?? DEFAULT_BROWSE_RESULT_MASK,
              },
              input.maxReferencesPerNode ??
                DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
            ),
          catch: (cause) =>
            serviceError({
              operation: "browse",
              nodeId: input.nodeId,
              cause,
            }),
        }).pipe(browseSemaphore.withPermits(1));

        return normalizeBrowseResult(
          input.nodeId,
          result,
          input.includeRaw ?? false,
        );
      });

    const browseNext: OpcuaSession["browseNext"] = (continuation) =>
      Effect.gen(function* () {
        const validationError = browseContinuationError(
          "browseNext",
          continuation,
        );
        if (validationError) return yield* Effect.fail(validationError);

        const result = yield* Effect.tryPromise({
          try: () => unsafeRaw.browseNext(continuation.unsafeRaw, false),
          catch: (cause) =>
            serviceError({
              operation: "browseNext",
              nodeId: continuation.nodeId,
              cause,
            }),
        });

        return normalizeBrowseResult(
          continuation.nodeId,
          result,
          continuation.includeRaw ?? false,
        );
      });

    const releaseBrowseContinuation: OpcuaSession["releaseBrowseContinuation"] =
      (continuation) =>
        Effect.gen(function* () {
          const validationError = browseContinuationError(
            "releaseBrowseContinuation",
            continuation,
          );
          if (validationError) return yield* Effect.fail(validationError);

          yield* Effect.tryPromise({
            try: () => unsafeRaw.browseNext(continuation.unsafeRaw, true),
            catch: (cause) =>
              serviceError({
                operation: "releaseBrowseContinuation",
                nodeId: continuation.nodeId,
                cause,
              }),
          });
        });

    const browseChildren: OpcuaSession["browseChildren"] = (nodeId, options) =>
      Effect.gen(function* () {
        const mode = options?.mode ?? "all";
        const first = yield* browse({
          nodeId,
          referenceTypeId:
            options?.referenceTypeId ?? DEFAULT_BROWSE_REFERENCE_TYPE_ID,
          includeSubtypes:
            options?.includeSubtypes ?? DEFAULT_BROWSE_INCLUDE_SUBTYPES,
          nodeClassMask:
            options?.nodeClassMask ?? DEFAULT_BROWSE_NODE_CLASS_MASK,
          maxReferencesPerNode:
            options?.maxReferencesPerNode ??
            DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
          includeRaw: options?.includeRaw,
        });
        if (first._tag === "NonGoodStatus") return first;
        if (mode === "page") {
          return {
            _tag: "Browsed" as const,
            nodeId,
            status: first.status,
            references: first.references,
            continuation: first.continuation,
          };
        }

        const references = [...first.references];
        let continuation = first.continuation;
        while (continuation) {
          const next = yield* browseNext({
            ...continuation,
            includeRaw: options?.includeRaw,
          });
          if (next._tag === "NonGoodStatus") return next;
          references.push(...next.references);
          continuation = next.continuation;
        }
        return {
          _tag: "Browsed" as const,
          nodeId,
          status: first.status,
          references,
        };
      });

    return {
      makeHandle,
      readMany,
      writeMany,
      callMany,
      makeSubscription,
      browse,
      browseNext,
      releaseBrowseContinuation,
      browseChildren,
      events: Stream.fromPubSub(events),
      unsafeRaw,
    };
  });

export const make = makeSession;

const durationMillis = (duration: Duration.Duration) =>
  Duration.toMillis(duration);

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
};

type NormalizedCallItem = {
  readonly key: string;
  readonly def: AnyMethodDef;
  readonly input: unknown;
  readonly options?: MethodCallOptions;
};

const readManyWithState = <const Items extends Record<string, ReadableVariableDef>>(
  state: SessionState,
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

const writeManyWithState = <const Items extends AnyWriteManyRecord>(
  state: SessionState,
  items: Items & WriteManyInput<Items>,
  options?: WriteManyOptions,
): Effect.Effect<WriteManyResult<Items>, OpcuaError> =>
  Effect.gen(function* () {
    const normalizedOptions = yield* normalizeWriteManyOptions(options);
    const normalized = yield* normalizeWriteManyItems(items);
    if (normalized.length === 0) return {} as WriteManyResult<Items>;

    const handles = yield* Effect.forEach(normalized, (item) =>
      Effect.gen(function* () {
        const variableMetadata = yield* state.metadata.variable(item.def);
        return makeVariableHandle(
          state.unsafeRaw,
          item.def,
          variableMetadata,
          state.structureRuntime,
        );
      }),
    );
    const entries = normalized.map((item, index) => ({
      handle: handles[index] as WritableVariableHandle,
      value: item.value,
    })) as ReadonlyArray<WriteEntry<WritableVariableHandle>>;
    const results = yield* writeVariables(
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

const callManyWithState = <const Items extends AnyCallManyRecord>(
  state: SessionState,
  items: Items & CallManyInput<Items>,
  options?: CallManyOptions,
): Effect.Effect<CallManyResult<Items>, OpcuaError> =>
  Effect.gen(function* () {
    const normalizedOptions = yield* normalizeCallManyOptions(options);
    const normalized = yield* normalizeCallManyItems(items);
    if (normalized.length === 0) return {} as CallManyResult<Items>;

    const handles = yield* Effect.forEach(normalized, (item) =>
      Effect.gen(function* () {
        const methodMetadata = yield* state.metadata.method(item.def);
        return yield* makeMethodHandle(
          state.unsafeRaw,
          item.def,
          methodMetadata,
          state.structureRuntime,
        );
      }),
    );
    const entries = normalized.map((item, index) => ({
      handle: handles[index]!,
      input: item.input,
      options: item.options,
    })) as ReadonlyArray<MethodCallEntry<AnyMethodHandle>>;
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
    for (const [key, value] of Object.entries(items as Record<string, unknown>)) {
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
    for (const [key, tuple] of Object.entries(items as Record<string, unknown>)) {
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
      normalized.push({ key, def, value, nodeId });
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
    for (const [key, tuple] of Object.entries(items as Record<string, unknown>)) {
      if (!Array.isArray(tuple) || (tuple.length !== 2 && tuple.length !== 3)) {
        return Effect.fail(
          configurationError({
            operation: "callMany.items",
            key,
            cause: "call entries must be [definition, input] or [definition, input, options] tuples",
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
    const serviceError = serviceOptionsError("readMany.options.service", service, [
      "maxNodesPerRead",
      "maxConcurrentRequests",
    ]);
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
    const serviceError = serviceOptionsError("writeMany.options.service", service, [
      "maxNodesPerWrite",
      "maxConcurrentRequests",
    ]);
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
    const serviceError = serviceOptionsError("callMany.options.service", service, [
      "maxMethodsPerCall",
      "maxConcurrentRequests",
    ]);
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
    return configurationError({ operation, cause: "options must be an object" });
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

const keyedResults = <A extends { readonly key: string }, B>(
  entries: ReadonlyArray<A>,
  results: ReadonlyArray<B>,
) => {
  const out: Record<string, B> = {};
  for (let index = 0; index < entries.length; index++) {
    out[entries[index]!.key] = results[index]!;
  }
  return out;
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

const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value > 0;

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
