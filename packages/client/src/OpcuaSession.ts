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
import type {
  OpcuaAccessBits,
  OpcuaMetadataReadFailure,
  OpcuaNodeMetadata,
  OpcuaNodeMetadataResult,
} from "./internal/metadata.js";
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
import { validateSubscriptionOptions } from "./internal/subscription-options.js";
import {
  readDataTypeDefinition as readDataTypeDefinitionImpl,
  readManyDataTypeDefinitions as readManyDataTypeDefinitionsImpl,
  type OpcuaDataTypeDefinition,
  type OpcuaDataTypeDefinitionResult,
  type OpcuaEnumDefinition,
  type OpcuaEnumField,
  type OpcuaStructureDefinition,
  type OpcuaStructureField,
} from "./internal/data-type-definition.js";

export type {
  OpcuaBrowseChildrenOptions,
  OpcuaBrowseChildrenResult,
  OpcuaBrowseContinuation,
  OpcuaBrowseOptions,
  OpcuaBrowseReference,
  OpcuaBrowseResult,
} from "./internal/browse.js";
export type {
  OpcuaAccessBits,
  OpcuaMetadataReadFailure,
  OpcuaNodeMetadata,
  OpcuaNodeMetadataResult,
  OpcuaDataTypeDefinition,
  OpcuaDataTypeDefinitionResult,
  OpcuaEnumDefinition,
  OpcuaEnumField,
  OpcuaStructureDefinition,
  OpcuaStructureField,
};

export type ReadManyServiceOptions = {
  readonly maxNodesPerRead?: number;
  readonly maxConcurrentRequests?: number;
};

export type WriteManyServiceOptions = {
  readonly maxNodesPerWrite?: number;
  readonly maxConcurrentRequests?: number;
};

export type CallManyServiceOptions = {
  readonly maxMethodsPerCall?: number;
  readonly maxConcurrentRequests?: number;
};

export type OpcuaSessionBatchingOptions = {
  readonly read?: ReadManyServiceOptions;
  readonly write?: WriteManyServiceOptions;
  readonly call?: CallManyServiceOptions;
};

export type OpcuaSessionOptions = {
  readonly userIdentity?: UserIdentityInfo;
  readonly batching?: OpcuaSessionBatchingOptions;
};

export type OpcuaSubscriptionOptions = {
  readonly publishingInterval: Duration.Duration;
  readonly lifetimeCount?: number;
  readonly maxKeepAliveCount?: number;
  readonly maxNotificationsPerPublish?: number;
  readonly publishingEnabled?: boolean;
  readonly priority?: number;
};

export type ReadManyOptions = {
  readonly validation?: "strict" | "none";
  readonly service?: ReadManyServiceOptions;
};

export type WriteManyOptions = {
  readonly service?: WriteManyServiceOptions;
};

export type CallManyOptions = {
  readonly service?: CallManyServiceOptions;
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
  readonly readNamespaceArray: () => Effect.Effect<
    readonly string[],
    OpcuaError
  >;
  readonly readNodeMetadata: (
    nodeId: string,
  ) => Effect.Effect<OpcuaNodeMetadata, OpcuaError>;
  readonly readManyNodeMetadata: (
    nodeIds: readonly string[],
  ) => Effect.Effect<readonly OpcuaNodeMetadataResult[], OpcuaError>;
  readonly readDataTypeDefinition: (
    dataTypeNodeId: string,
  ) => Effect.Effect<OpcuaDataTypeDefinitionResult, OpcuaError>;
  readonly readManyDataTypeDefinitions: (
    dataTypeNodeIds: readonly string[],
  ) => Effect.Effect<readonly OpcuaDataTypeDefinitionResult[], OpcuaError>;
  readonly makeSubscription: (
    options: OpcuaSubscriptionOptions,
  ) => Effect.Effect<OpcuaSubscription, OpcuaError, Scope.Scope>;
  readonly events: Stream.Stream<OpcuaSessionEvent>;
  readonly unsafeRaw: ClientSession;
};

export const OpcuaSession = Object.assign(
  Context.Service<OpcuaSession>("@effect-opcua/client/OpcuaSession"),
  {
    layer: (options?: OpcuaSessionOptions) =>
      Layer.effect(
        OpcuaSession,
        Effect.gen(function* () {
          const client = yield* OpcuaClient;
          const events =
            yield* PubSub.sliding<OpcuaSessionEvent>(EVENT_BUFFER_SIZE);
          const raw = yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: async (signal) => {
                let aborted = signal.aborted;
                const abort = () => {
                  aborted = true;
                };
                signal.addEventListener("abort", abort, { once: true });
                try {
                  const session = await client.unsafeRaw.createSession(
                    options?.userIdentity,
                  );
                  if (aborted) {
                    await session.close(true).catch(() => undefined);
                    throw new Error("Session creation aborted");
                  }
                  return session;
                } finally {
                  signal.removeEventListener("abort", abort);
                }
              },
              catch: (cause) => sessionCreateError({ cause }),
            }).pipe(
              Effect.withSpan("opcua.session.create", { kind: "client" }),
            ),
            (session) =>
              Effect.tryPromise({
                try: () => session.close(true),
                catch: (cause) => sessionCloseError({ cause }),
              }).pipe(
                Effect.withSpan("opcua.session.close", { kind: "client" }),
                Effect.ignore,
                Effect.andThen(PubSub.shutdown(events)),
              ),
          );
          yield* wireSessionEvents(raw, events);
          return yield* makeSession(raw, events, {
            batching: options?.batching,
          });
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

export const browse = (input: OpcuaBrowseOptions) =>
  Effect.flatMap(OpcuaSession, (session) => session.browse(input));

export const browseNext = (
  continuation: Parameters<OpcuaSession["browseNext"]>[0],
) =>
  Effect.flatMap(OpcuaSession, (session) => session.browseNext(continuation));

export const releaseBrowseContinuation = (
  continuation: OpcuaBrowseContinuation,
) =>
  Effect.flatMap(OpcuaSession, (session) =>
    session.releaseBrowseContinuation(continuation),
  );

export const browseChildren = (
  nodeId: NodeIdString,
  options?: OpcuaBrowseChildrenOptions,
) =>
  Effect.flatMap(OpcuaSession, (session) =>
    session.browseChildren(nodeId, options),
  );

export const readNamespaceArray = () =>
  Effect.flatMap(OpcuaSession, (session) => session.readNamespaceArray());

export const readNodeMetadata = (nodeId: string) =>
  Effect.flatMap(OpcuaSession, (session) => session.readNodeMetadata(nodeId));

export const readManyNodeMetadata = (nodeIds: readonly string[]) =>
  Effect.flatMap(OpcuaSession, (session) =>
    session.readManyNodeMetadata(nodeIds),
  );

export const readDataTypeDefinition = (dataTypeNodeId: string) =>
  Effect.flatMap(OpcuaSession, (session) =>
    session.readDataTypeDefinition(dataTypeNodeId),
  );

export const readManyDataTypeDefinitions = (
  dataTypeNodeIds: readonly string[],
) =>
  Effect.flatMap(OpcuaSession, (session) =>
    session.readManyDataTypeDefinitions(dataTypeNodeIds),
  );

export const makeSession = (
  unsafeRaw: ClientSession,
  events: PubSub.PubSub<OpcuaSessionEvent>,
  options?: Pick<OpcuaSessionOptions, "batching">,
): Effect.Effect<OpcuaSession, never, Scope.Scope> =>
  Effect.gen(function* () {
    const browseSemaphore = Semaphore.makeUnsafe(1);
    const structureRuntime = makeStructureRuntime(unsafeRaw);
    const metadata = makeMetadataService(unsafeRaw, structureRuntime);
    const state: SessionOperationsState = {
      unsafeRaw,
      metadata,
      structureRuntime,
      batching: options?.batching,
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
      }).pipe(
        Effect.withSpan("opcua.session.read", {
          attributes: { "opcua.node_id": def.nodeId },
          kind: "client",
        }),
      );

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
      }).pipe(
        Effect.withSpan("opcua.session.write", {
          attributes: { "opcua.node_id": def.nodeId },
          kind: "client",
        }),
      );

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
      }).pipe(
        Effect.withSpan("opcua.session.call", {
          attributes: {
            "opcua.object_id": def.objectId,
            "opcua.method_id": def.methodId,
          },
          kind: "client",
        }),
      );

    const readMany: OpcuaSession["readMany"] = (items, options) =>
      readManyWithState(state, items, options).pipe(
        Effect.withSpan("opcua.session.readMany", {
          attributes: { "opcua.node_count": Object.keys(items).length },
          kind: "client",
        }),
      );

    const writeMany: OpcuaSession["writeMany"] = (items, options) =>
      writeManyWithState(state, items, options).pipe(
        Effect.withSpan("opcua.session.writeMany", {
          attributes: { "opcua.node_count": Object.keys(items).length },
          kind: "client",
        }),
      );

    const callMany: OpcuaSession["callMany"] = (items, options) =>
      callManyWithState(state, items, options).pipe(
        Effect.withSpan("opcua.session.callMany", {
          attributes: { "opcua.method_count": Object.keys(items).length },
          kind: "client",
        }),
      );

    const makeSubscription: OpcuaSession["makeSubscription"] = (options) =>
      Effect.gen(function* () {
        const normalized = yield* validateSubscriptionOptions(options);
        const subscriptionEvents =
          yield* PubSub.sliding<OpcuaSubscriptionEvent>(EVENT_BUFFER_SIZE);
        const rawSubscription = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: async () =>
              ClientSubscription.create(unsafeRaw, {
                requestedPublishingInterval: normalized.publishingInterval,
                requestedLifetimeCount: normalized.lifetimeCount,
                requestedMaxKeepAliveCount: normalized.maxKeepAliveCount,
                maxNotificationsPerPublish:
                  normalized.maxNotificationsPerPublish,
                publishingEnabled: normalized.publishingEnabled,
                priority: normalized.priority,
              }),
            catch: (cause) => subscriptionCreateError({ cause }),
          }).pipe(
            Effect.withSpan("opcua.subscription.create", {
              attributes: {
                "opcua.publishing_interval_ms": normalized.publishingInterval,
              },
              kind: "client",
            }),
          ),
          (subscription) =>
            Effect.tryPromise({
              try: () => subscription.terminate(),
              catch: (cause) => subscriptionCreateError({ cause }),
            }).pipe(
              Effect.withSpan("opcua.subscription.terminate", {
                attributes: {
                  "opcua.subscription_id": subscription.subscriptionId,
                },
                kind: "client",
              }),
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
      }).pipe(
        Effect.withSpan("opcua.session.browse", {
          attributes: {
            "opcua.node_id": input.nodeId,
            "opcua.max_references_per_node":
              input.maxReferencesPerNode ??
              DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
          },
          kind: "client",
        }),
      );

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
      }).pipe(
        Effect.withSpan("opcua.session.browseNext", {
          attributes: { "opcua.node_id": continuation.nodeId },
          kind: "client",
        }),
      );

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
        }).pipe(
          Effect.withSpan("opcua.session.releaseBrowseContinuation", {
            attributes: { "opcua.node_id": continuation.nodeId },
            kind: "client",
          }),
        );

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
      }).pipe(
        Effect.withSpan("opcua.session.browseChildren", {
          attributes: {
            "opcua.node_id": nodeId,
            "opcua.browse_mode": options?.mode ?? "all",
          },
          kind: "client",
        }),
      );

    const readNamespaceArray: OpcuaSession["readNamespaceArray"] = () =>
      metadata.namespaceArray();

    const readNodeMetadata: OpcuaSession["readNodeMetadata"] = (nodeId) =>
      metadata.node(nodeId);

    const readManyNodeMetadata: OpcuaSession["readManyNodeMetadata"] = (
      nodeIds,
    ) => metadata.nodes(nodeIds);

    const readDataTypeDefinition: OpcuaSession["readDataTypeDefinition"] = (
      dataTypeNodeId,
    ) => readDataTypeDefinitionImpl(unsafeRaw, metadata, dataTypeNodeId);

    const readManyDataTypeDefinitions: OpcuaSession["readManyDataTypeDefinitions"] =
      (dataTypeNodeIds) =>
        readManyDataTypeDefinitionsImpl(unsafeRaw, metadata, dataTypeNodeIds);

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
      readNamespaceArray,
      readNodeMetadata,
      readManyNodeMetadata,
      readDataTypeDefinition,
      readManyDataTypeDefinitions,
      events: Stream.fromPubSub(events),
      unsafeRaw,
    };
  });

export const make = makeSession;
