import {
  AttributeIds,
  ClientSubscription,
  coerceNodeId,
  resolveNodeId,
  type ClientSession,
  type UserIdentityInfo,
  type WriteValueOptions,
} from "node-opcua";
import {
  Context,
  Duration,
  Effect,
  Layer,
  PubSub,
  Semaphore,
  Scope,
  Stream,
} from "effect";

import {
  Capabilities,
  type CapabilitySet,
  type NodeIdString,
} from "./capabilities.js";
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
  normalizeBrowseResultOrFail,
  type OpcuaBrowseChildrenOptions,
  type OpcuaBrowseChildrenResult,
  type OpcuaBrowseContinuation,
  type OpcuaBrowseOptions,
  type OpcuaBrowseResult,
} from "./browse.js";
import {
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaEncodeError,
  OpcuaNonGoodStatusError,
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
import { makeSubscription, type OpcuaSubscription } from "./monitoring.js";
import { isGood } from "./normalize.js";
import {
  discoverMetadata,
  encodeValue,
  hasCapability,
  makeVariant,
  readDataValue,
  sampleFromDataValue,
  writeByMetadata,
  writeResult,
  type AnySchema,
  type OpcuaValueHandle,
  type OpcuaValueSample,
  type OpcuaWriteResult,
  type OpcuaWriteValuesResult,
  type WriteValuesResult,
  type ReadValuesResult,
  type ValueOfSpec,
  type ValueSpec,
  type WritableOpcuaValueHandle,
  type WriteEntry,
  type NodeIdOfHandle,
} from "./values.js";

export type OpcuaSession = {
  readonly readValue: <
    const Id extends NodeIdString,
    S extends AnySchema | undefined = undefined,
  >(
    input: ValueSpec<Id, S>,
  ) => Effect.Effect<
    OpcuaValueSample<ValueOfSpec<ValueSpec<Id, S>>, Id>,
    OpcuaServiceError
  >;
  readonly readValues: <const Specs extends ReadonlyArray<ValueSpec>>(
    specs: Specs,
  ) => Effect.Effect<
    ReadValuesResult<Specs>,
    OpcuaConfigurationError | OpcuaServiceError
  >;
  readonly valueHandle: <
    const Id extends NodeIdString,
    S extends AnySchema | undefined = undefined,
    const Caps extends CapabilitySet = typeof Capabilities.read,
  >(
    input: ValueSpec<Id, S> & { readonly capabilities?: Caps },
  ) => Effect.Effect<
    OpcuaValueHandle<ValueOfSpec<ValueSpec<Id, S>>, Caps, Id>,
    OpcuaServiceError | OpcuaAccessDeniedError | OpcuaConfigurationError
  >;
  readonly writeValue: <
    const Id extends NodeIdString,
    S extends AnySchema | undefined = undefined,
  >(
    input: ValueSpec<Id, S> & {
      readonly value: ValueOfSpec<ValueSpec<Id, S>>;
    },
  ) => Effect.Effect<
    OpcuaWriteResult<Id>,
    | OpcuaConfigurationError
    | OpcuaEncodeError
    | OpcuaServiceError
    | OpcuaAccessDeniedError
  >;
  readonly writeValues: <const Specs extends ReadonlyArray<ValueSpec>>(specs: {
    readonly [Index in keyof Specs]: Specs[Index] & {
      readonly value: ValueOfSpec<Specs[Index]>;
    };
  }) => Effect.Effect<
    WriteValuesResult<Specs>,
    | OpcuaConfigurationError
    | OpcuaEncodeError
    | OpcuaServiceError
    | OpcuaAccessDeniedError
  >;
  readonly writeHandleValues: <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Handles extends ReadonlyArray<WritableOpcuaValueHandle<any>>,
  >(writes: {
    readonly [Index in keyof Handles]: WriteEntry<Handles[Index]>;
  }) => Effect.Effect<
    OpcuaWriteValuesResult<NodeIdOfHandle<Handles[number]>>,
    | OpcuaConfigurationError
    | OpcuaEncodeError
    | OpcuaServiceError
    | OpcuaAccessDeniedError
  >;
  readonly browse: (
    input: OpcuaBrowseOptions,
  ) => Effect.Effect<
    OpcuaBrowseResult,
    OpcuaConfigurationError | OpcuaServiceError | OpcuaNonGoodStatusError
  >;
  readonly browseNext: (
    continuation: OpcuaBrowseContinuation & { readonly includeRaw?: boolean },
  ) => Effect.Effect<
    OpcuaBrowseResult,
    OpcuaConfigurationError | OpcuaServiceError | OpcuaNonGoodStatusError
  >;
  readonly releaseBrowseContinuation: (
    continuation: OpcuaBrowseContinuation,
  ) => Effect.Effect<
    void,
    OpcuaConfigurationError | OpcuaServiceError | OpcuaNonGoodStatusError
  >;
  readonly browseChildren: (
    nodeId: NodeIdString,
    options?: OpcuaBrowseChildrenOptions,
  ) => Effect.Effect<
    OpcuaBrowseChildrenResult,
    OpcuaConfigurationError | OpcuaServiceError | OpcuaNonGoodStatusError
  >;
  readonly createSubscription: (options: {
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
  readonly raw: ClientSession;
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
              try: () => client.raw.createSession(options?.userIdentity),
              catch: (cause) => new OpcuaSessionCreateError({ cause }),
            }),
            (session) =>
              Effect.tryPromise({
                try: () => session.close(true),
                catch: (cause) => new OpcuaSessionCloseError({ cause }),
              }).pipe(Effect.ignore, Effect.andThen(PubSub.shutdown(events))),
          );
          wireSessionEvents(raw, events);
          return makeSession(raw, events);
        }),
      ),
  },
);

export const makeSession = (
  raw: ClientSession,
  events: PubSub.PubSub<OpcuaSessionEvent>,
): OpcuaSession => {
  const browseSemaphore = Semaphore.makeUnsafe(1);

  const readValue = <
    const Id extends NodeIdString,
    S extends AnySchema | undefined = undefined,
  >(
    input: ValueSpec<Id, S>,
  ) =>
    readDataValue(raw, input.nodeId).pipe(
      Effect.map((dataValue) => sampleFromDataValue(input, dataValue)),
    ) as Effect.Effect<
      OpcuaValueSample<ValueOfSpec<ValueSpec<Id, S>>, Id>,
      OpcuaServiceError
    >;

  const readValues = <const Specs extends ReadonlyArray<ValueSpec>>(
    specs: Specs,
  ) =>
    Effect.gen(function* () {
      const dataValues = yield* Effect.tryPromise({
        try: () =>
          raw.read(
            specs.map((spec) => ({
              nodeId: coerceNodeId(spec.nodeId),
              attributeId: AttributeIds.Value,
            })),
            0,
          ),
        catch: (cause) =>
          new OpcuaServiceError({ operation: "readValues", cause }),
      });
      return specs.map((spec, index) =>
        sampleFromDataValue(spec, dataValues[index]!),
      ) as ReadValuesResult<Specs>;
    });

  const valueHandle = <
    const Id extends NodeIdString,
    S extends AnySchema | undefined = undefined,
    const Caps extends CapabilitySet = typeof Capabilities.read,
  >(
    input: ValueSpec<Id, S> & { readonly capabilities?: Caps },
  ) =>
    Effect.gen(function* () {
      const requested = (input.capabilities ?? Capabilities.read) as Caps;
      const metadata = yield* discoverMetadata(raw, input.nodeId, requested);
      const nodeId = coerceNodeId(input.nodeId);
      const base = {
        nodeId: input.nodeId,
        schema: input.schema,
        metadata,
        capabilities: requested,
        raw: { nodeId, dataType: metadata.raw.dataType },
      };
      const handle: Record<string, unknown> = { ...base };
      if (hasCapability(requested, "read")) {
        handle.read = () => readValue(input);
      }
      if (hasCapability(requested, "write")) {
        handle.write = (value: unknown) =>
          writeByMetadata(raw, {
            nodeId: input.nodeId,
            schema: input.schema,
            value,
            metadata,
          });
      }
      return handle as OpcuaValueHandle<
        ValueOfSpec<ValueSpec<Id, S>>,
        Caps,
        Id
      >;
    });

  const writeValue = <
    const Id extends NodeIdString,
    S extends AnySchema | undefined = undefined,
  >(
    input: ValueSpec<Id, S> & {
      readonly value: ValueOfSpec<ValueSpec<Id, S>>;
    },
  ) =>
    Effect.gen(function* () {
      const metadata = yield* discoverMetadata(raw, input.nodeId, [
        "write",
      ] as const);
      return (yield* writeByMetadata(raw, {
        ...input,
        metadata,
      })) as OpcuaWriteResult<Id>;
    });

  const writeValues: OpcuaSession["writeValues"] = (specs) =>
    Effect.gen(function* () {
      const writePayloads: Array<WriteValueOptions> = [];
      for (const spec of specs) {
        const metadata = yield* discoverMetadata(raw, spec.nodeId, [
          "write",
        ] as const);
        const encoded = yield* encodeValue(
          spec.nodeId,
          spec.schema,
          spec.value,
          metadata,
        );
        writePayloads.push({
          nodeId: coerceNodeId(spec.nodeId),
          attributeId: AttributeIds.Value,
          value: {
            value: makeVariant(metadata, encoded),
          },
        });
      }

      const statusCodes = yield* Effect.tryPromise({
        try: () => raw.write(writePayloads),
        catch: (cause) =>
          new OpcuaServiceError({ operation: "writeValues", cause }),
      });

      return specs.map((spec, index) =>
        writeResult(spec.nodeId, statusCodes[index]!),
      ) as WriteValuesResult<typeof specs>;
    });

  const writeHandleValues: OpcuaSession["writeHandleValues"] = (writes) =>
    Effect.gen(function* () {
      const nodeIds = writes.map((write) => write.handle.nodeId);
      const duplicate = duplicateStringError("writeHandleValues", nodeIds);
      if (duplicate) return yield* Effect.fail(duplicate);
      const writePayloads: Array<WriteValueOptions> = [];
      for (const write of writes) {
        if (!hasCapability(write.handle.capabilities, "write")) {
          return yield* Effect.fail(
            new OpcuaAccessDeniedError({
              nodeId: write.handle.nodeId,
              requestedCapability: "write",
              accessLevel: write.handle.metadata.accessLevel,
              userAccessLevel: write.handle.metadata.userAccessLevel,
            }),
          );
        }
        const encoded = yield* encodeValue(
          write.handle.nodeId,
          write.handle.schema,
          write.value,
          write.handle.metadata,
        );
        writePayloads.push({
          nodeId: coerceNodeId(write.handle.nodeId),
          attributeId: AttributeIds.Value,
          value: {
            value: makeVariant(write.handle.metadata, encoded),
          },
        });
      }
      const statusCodes = yield* Effect.tryPromise({
        try: () => raw.write(writePayloads),
        catch: (cause) =>
          new OpcuaServiceError({ operation: "writeHandleValues", cause }),
      });
      const result: Record<string, OpcuaWriteResult> = {};
      for (let index = 0; index < writes.length; index++) {
        const nodeId = writes[index]!.handle.nodeId;
        result[nodeId] = writeResult(nodeId, statusCodes[index]!);
      }
      return result as OpcuaWriteValuesResult<
        (typeof writes)[number]["handle"]["nodeId"]
      >;
    });

  const createSubscription: OpcuaSession["createSubscription"] = (options) =>
    Effect.gen(function* () {
      const subscriptionEvents =
        yield* PubSub.sliding<OpcuaSubscriptionEvent>(EVENT_BUFFER_SIZE);
      const rawSubscription = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const subscription = ClientSubscription.create(raw, {
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
            });
            wireSubscriptionEvents(subscription, subscriptionEvents);
            return subscription;
          },
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
      return makeSubscription(rawSubscription, subscriptionEvents);
    });

  const browse: OpcuaSession["browse"] = (input) =>
    Effect.gen(function* () {
      const validationError = browseOptionsError(input);
      if (validationError) return yield* Effect.fail(validationError);

      const result = yield* Effect.tryPromise({
        try: () =>
          browseWithMaxReferences(
            raw,
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

      return yield* normalizeBrowseResultOrFail(
        "browse",
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
        try: () => raw.browseNext(continuation.raw, false),
        catch: (cause) =>
          new OpcuaServiceError({
            operation: "browseNext",
            nodeId: continuation.nodeId,
            cause,
          }),
      });

      return yield* normalizeBrowseResultOrFail(
        "browseNext",
        continuation.nodeId,
        result,
        continuation.includeRaw ?? false,
      );
    });

  const releaseBrowseContinuation: OpcuaSession["releaseBrowseContinuation"] = (
    continuation,
  ) =>
    Effect.gen(function* () {
      const validationError = browseContinuationError(
        "releaseBrowseContinuation",
        continuation,
      );
      if (validationError) return yield* Effect.fail(validationError);

      const result = yield* Effect.tryPromise({
        try: () => raw.browseNext(continuation.raw, true),
        catch: (cause) =>
          new OpcuaServiceError({
            operation: "releaseBrowseContinuation",
            nodeId: continuation.nodeId,
            cause,
          }),
      });

      if (!isGood(result.statusCode)) {
        return yield* Effect.fail(
          new OpcuaNonGoodStatusError({
            operation: "releaseBrowseContinuation",
            nodeId: continuation.nodeId,
            statusCode: result.statusCode,
          }),
        );
      }
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
        nodeClassMask: options?.nodeClassMask ?? DEFAULT_BROWSE_NODE_CLASS_MASK,
        maxReferencesPerNode:
          options?.maxReferencesPerNode ??
          DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
        includeRaw: options?.includeRaw,
      });
      if (mode === "page") {
        return {
          nodeId,
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
        references.push(...next.references);
        continuation = next.continuation;
      }
      return { nodeId, references };
    });

  return {
    readValue,
    readValues,
    valueHandle,
    writeValue,
    writeValues,
    writeHandleValues,
    createSubscription,
    browse,
    browseNext,
    releaseBrowseContinuation,
    browseChildren,
    events: Stream.fromPubSub(events),
    raw,
  };
};

const duplicateStringError = (
  operation: string,
  nodeIds: ReadonlyArray<NodeIdString>,
) => {
  const seen = new Set<string>();
  for (const nodeId of nodeIds) {
    if (seen.has(nodeId)) {
      return new OpcuaConfigurationError({
        operation,
        nodeId,
        cause: "Duplicate nodeId",
      });
    }
    seen.add(nodeId);
  }
  return undefined;
};

const durationMillis = (duration: Duration.Duration) =>
  Duration.toMillis(duration);
