import {
  ClientSubscription,
  resolveNodeId,
  type ClientSession,
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
  serviceError,
  sessionCloseError,
  sessionCreateError,
  subscriptionCreateError,
  type OpcuaError,
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
import {
  callResolvedMethod,
  type AnyMethodDef,
  type InputOfMethodDef,
  type MethodCallOptions,
  type MethodCallResult,
  type OutputOfMethodDef,
  resolveMethod,
} from "./OpcuaMethod.js";
import {
  readVariable,
  writeVariable,
  type NodeIdOfVariableDef,
  type ReadableVariableDef,
  type ReadResult,
  type VariableAccess,
  type VariableDef,
  type ValueOfVariableDef,
  type WritableVariableDef,
  type WriteResult,
} from "./OpcuaVariable.js";
import {
  callManyWithState,
  readManyWithState,
  writeManyWithState,
  type SessionOperationsState,
} from "./internal/session-operations.js";

export type { OpcuaBrowseReference } from "./internal/browse.js";

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
    ? MethodCallResult<OutputOfMethodDef<Def>, Def["objectId"], Def["methodId"]>
    : never;
};

export type OpcuaSession = {
  readonly read: <const Def extends ReadableVariableDef>(
    def: Def,
  ) => Effect.Effect<
    ReadResult<ValueOfVariableDef<Def>, NodeIdOfVariableDef<Def>>,
    OpcuaError
  >;
  readonly write: <const Def extends WritableVariableDef>(
    def: Def,
    value: ValueOfVariableDef<Def>,
  ) => Effect.Effect<WriteResult<NodeIdOfVariableDef<Def>>, OpcuaError>;
  readonly call: <const Spec extends AnyMethodDef>(
    def: Spec,
    input: InputOfMethodDef<Spec>,
    options?: MethodCallOptions,
  ) => Effect.Effect<
    MethodCallResult<
      OutputOfMethodDef<Spec>,
      Spec["objectId"],
      Spec["methodId"]
    >,
    OpcuaError
  >;
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
  }) => Effect.Effect<OpcuaSubscription, OpcuaError, Scope.Scope>;
  readonly events: Stream.Stream<OpcuaSessionEvent>;
  readonly unsafeRaw: ClientSession;
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

export const read = <const Def extends ReadableVariableDef>(def: Def) =>
  Effect.flatMap(OpcuaSession, (session) => session.read(def));

export const write = <const Def extends WritableVariableDef>(
  def: Def,
  value: ValueOfVariableDef<Def>,
) => Effect.flatMap(OpcuaSession, (session) => session.write(def, value));

export const call = <const Spec extends AnyMethodDef>(
  def: Spec,
  input: InputOfMethodDef<Spec>,
  options?: MethodCallOptions,
) =>
  Effect.flatMap(OpcuaSession, (session) => session.call(def, input, options));

export const readMany = <
  const Items extends Record<string, ReadableVariableDef>,
>(
  items: Items,
  options?: ReadManyOptions,
) =>
  Effect.flatMap(OpcuaSession, (session) => session.readMany(items, options));

export const writeMany = <const Items extends AnyWriteManyRecord>(
  items: Items & WriteManyInput<Items>,
  options?: WriteManyOptions,
) =>
  Effect.flatMap(OpcuaSession, (session) => session.writeMany(items, options));

export const callMany = <const Items extends AnyCallManyRecord>(
  items: Items & CallManyInput<Items>,
  options?: CallManyOptions,
) =>
  Effect.flatMap(OpcuaSession, (session) => session.callMany(items, options));

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
    const state: SessionOperationsState = {
      unsafeRaw,
      metadata,
      structureRuntime,
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const listener = () => {
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

    const read: OpcuaSession["read"] = (def) =>
      Effect.gen(function* () {
        yield* metadata.variable(def);
        const result = yield* readVariable(unsafeRaw, def, structureRuntime);
        return result as ReadResult<
          ValueOfVariableDef<typeof def>,
          NodeIdOfVariableDef<typeof def>
        >;
      });

    const write: OpcuaSession["write"] = (def, value) =>
      Effect.gen(function* () {
        const variableMetadata = yield* metadata.variable(def);
        const result = yield* writeVariable(
          unsafeRaw,
          def,
          variableMetadata,
          value,
          structureRuntime,
        );
        return result as WriteResult<NodeIdOfVariableDef<typeof def>>;
      });

    const call: OpcuaSession["call"] = (def, input, options) =>
      Effect.gen(function* () {
        const methodMetadata = yield* metadata.method(def);
        const method = yield* resolveMethod(def, methodMetadata);
        return yield* callResolvedMethod(
          unsafeRaw,
          method,
          input,
          structureRuntime,
          options,
        );
      });

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
          (def) => metadata.variable(def),
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
      read,
      write,
      call,
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
