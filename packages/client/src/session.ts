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
} from "./constants.js";
import { OpcuaClient } from "./client.js";
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
} from "./browse.js";
import {
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaMethodNotExecutableError,
  OpcuaServiceError,
  OpcuaSessionCloseError,
  OpcuaSessionCreateError,
  OpcuaSubscriptionCreateError,
} from "./errors.js";
import {
  type OpcuaSessionEvent,
  type OpcuaSubscriptionEvent,
  wireSessionEvents,
  wireSubscriptionEvents,
} from "./events.js";
import { makeMetadataService } from "./metadata.js";
import { makeSubscription, type OpcuaSubscription } from "./monitoring.js";
import { makeStructureRuntime } from "./structure-runtime.js";
import type { NodeIdString } from "./capabilities.js";
import {
  makeMethodHandle,
  type AnyMethodDef,
  type InputOfMethodDef,
  type MethodDef,
  type MethodHandle,
  type OutputOfMethodDef,
} from "./methods.js";
import {
  makeVariableHandle,
  type AnyVariableDef,
  type VariableAccess,
  type VariableDef,
  type VariableHandle,
} from "./values.js";

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

type HandleError =
  | OpcuaConfigurationError
  | OpcuaServiceError
  | OpcuaAccessDeniedError
  | OpcuaMethodNotExecutableError;

export type OpcuaSession = {
  readonly handle: {
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
  readonly handleAll: <const Defs extends ReadonlyArray<HandleDef>>(
    defs: Defs,
  ) => Effect.Effect<HandlesOf<Defs>, HandleError>;
  readonly browse: (
    input: OpcuaBrowseOptions,
  ) => Effect.Effect<
    OpcuaBrowseResult,
    OpcuaConfigurationError | OpcuaServiceError
  >;
  readonly browseNext: (
    continuation: OpcuaBrowseContinuation & { readonly includeRaw?: boolean },
  ) => Effect.Effect<
    OpcuaBrowseResult,
    OpcuaConfigurationError | OpcuaServiceError
  >;
  readonly releaseBrowseContinuation: (
    continuation: OpcuaBrowseContinuation,
  ) => Effect.Effect<void, OpcuaConfigurationError | OpcuaServiceError>;
  readonly browseChildren: (
    nodeId: NodeIdString,
    options?: OpcuaBrowseChildrenOptions,
  ) => Effect.Effect<
    OpcuaBrowseChildrenResult,
    OpcuaConfigurationError | OpcuaServiceError
  >;
  readonly subscription: (options: {
    readonly publishingInterval: Duration.Duration;
    readonly lifetimeCount?: number;
    readonly maxKeepAliveCount?: number;
    readonly maxNotificationsPerPublish?: number;
    readonly publishingEnabled?: boolean;
    readonly priority?: number;
  }) => Effect.Effect<
    OpcuaSubscription,
    OpcuaSubscriptionCreateError,
    Scope.Scope
  >;
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
              catch: (cause) => new OpcuaSessionCreateError({ cause }),
            }),
            (session) =>
              Effect.tryPromise({
                try: () => session.close(true),
                catch: (cause) => new OpcuaSessionCloseError({ cause }),
              }).pipe(Effect.ignore, Effect.andThen(PubSub.shutdown(events))),
          );
          yield* wireSessionEvents(raw, events);
          return yield* makeSession(raw, events);
        }),
      ),
  },
);

export const makeSession = (
  unsafeRaw: ClientSession,
  events: PubSub.PubSub<OpcuaSessionEvent>,
): Effect.Effect<OpcuaSession, never, Scope.Scope> =>
  Effect.gen(function* () {
    const browseSemaphore = Semaphore.makeUnsafe(1);
    const structureRuntime = makeStructureRuntime(unsafeRaw);
    const metadata = makeMetadataService(unsafeRaw, structureRuntime);
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const listener = () => {
          Effect.runFork(
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

    const handle: OpcuaSession["handle"] = ((def: HandleDef) =>
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
      })) as OpcuaSession["handle"];

    const handleAll: OpcuaSession["handleAll"] = (defs) =>
      Effect.forEach(defs, (def) => handle(def as never)) as Effect.Effect<
        HandlesOf<typeof defs>,
        HandleError
      >;

    const subscription: OpcuaSession["subscription"] = (options) =>
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
            catch: (cause) => new OpcuaSubscriptionCreateError({ cause }),
          }),
          (subscription) =>
            Effect.tryPromise({
              try: () => subscription.terminate(),
              catch: (cause) => new OpcuaSubscriptionCreateError({ cause }),
            }).pipe(
              Effect.ignore,
              Effect.andThen(PubSub.shutdown(subscriptionEvents)),
            ),
        );
        yield* wireSubscriptionEvents(rawSubscription, subscriptionEvents);
        return makeSubscription(
          rawSubscription,
          subscriptionEvents,
          structureRuntime,
          (def) => handle(def) as never,
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
            new OpcuaServiceError({
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
            new OpcuaServiceError({
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
              new OpcuaServiceError({
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
      handle,
      handleAll,
      subscription,
      browse,
      browseNext,
      releaseBrowseContinuation,
      browseChildren,
      events: Stream.fromPubSub(events),
      unsafeRaw,
    };
  });

const durationMillis = (duration: Duration.Duration) =>
  Duration.toMillis(duration);
