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
  OpcuaMethodInputError,
  OpcuaMethodNotExecutableError,
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
  hasStructureSpec,
  hasCapability,
  makeVariant,
  readDataValue,
  sampleFromDataValue,
  validateValueStructureSpec,
  writeByMetadata,
  writeResult,
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
  type NodeIdsOfHandles,
} from "./values.js";
import {
  callMethodHandles,
  makeMethodHandle,
  type InputOfMethodSpec,
  type MethodCallEntry,
  type MethodCallHandlesResult,
  type OpcuaMethodCallOptions,
  type OpcuaMethodCallResult,
  type OpcuaMethodHandle,
  type OpcuaMethodSpec,
  type OutputOfMethodSpec,
} from "./methods.js";
import { makeStructureRuntime } from "./structure-runtime.js";

export type OpcuaSession = {
  readonly readValue: <const Spec extends ValueSpec<NodeIdString>>(
    input: Spec,
  ) => Effect.Effect<
    Spec extends ValueSpec<infer Id>
      ? OpcuaValueSample<ValueOfSpec<Spec>, Id>
      : never,
    OpcuaServiceError
  >;
  readonly readValues: <const Specs extends ReadonlyArray<ValueSpec>>(
    specs: Specs,
  ) => Effect.Effect<
    ReadValuesResult<Specs>,
    OpcuaConfigurationError | OpcuaServiceError
  >;
  readonly valueHandle: <
    const Spec extends ValueSpec<NodeIdString>,
    const Caps extends CapabilitySet = typeof Capabilities.read,
  >(
    input: Spec & { readonly capabilities?: Caps },
  ) => Effect.Effect<
    Spec extends ValueSpec<infer Id>
      ? OpcuaValueHandle<ValueOfSpec<Spec>, Caps, Id>
      : never,
    OpcuaServiceError | OpcuaAccessDeniedError | OpcuaConfigurationError
  >;
  readonly writeValue: <const Spec extends ValueSpec<NodeIdString>>(
    input: Spec & {
      readonly value: ValueOfSpec<Spec>;
    },
  ) => Effect.Effect<
    Spec extends ValueSpec<infer Id> ? OpcuaWriteResult<Id> : never,
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
    OpcuaWriteValuesResult<NodeIdsOfHandles<Handles>>,
    | OpcuaConfigurationError
    | OpcuaEncodeError
    | OpcuaServiceError
    | OpcuaAccessDeniedError
  >;
  readonly methodHandle: <const Spec extends OpcuaMethodSpec>(
    spec: Spec,
  ) => Effect.Effect<
    OpcuaMethodHandle<
      InputOfMethodSpec<Spec>,
      OutputOfMethodSpec<Spec>,
      Spec["objectId"],
      Spec["methodId"]
    >,
    | OpcuaConfigurationError
    | OpcuaServiceError
    | OpcuaMethodNotExecutableError
    | OpcuaAccessDeniedError
  >;
  readonly callMethod: <const Spec extends OpcuaMethodSpec>(
    spec: Spec & { readonly inputValues: InputOfMethodSpec<Spec> },
    options?: OpcuaMethodCallOptions,
  ) => Effect.Effect<
    OpcuaMethodCallResult<
      OutputOfMethodSpec<Spec>,
      Spec["objectId"],
      Spec["methodId"]
    >,
    | OpcuaConfigurationError
    | OpcuaServiceError
    | OpcuaMethodInputError
    | OpcuaMethodNotExecutableError
    | OpcuaAccessDeniedError
  >;
  readonly callMethodHandles: <
    const Handles extends ReadonlyArray<OpcuaMethodHandle>,
  >(entries: {
    readonly [Index in keyof Handles]: MethodCallEntry<Handles[Index]>;
  }) => Effect.Effect<
    MethodCallHandlesResult<Handles>,
    | OpcuaConfigurationError
    | OpcuaServiceError
    | OpcuaMethodInputError
    | OpcuaMethodNotExecutableError
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
  const structureRuntime = makeStructureRuntime(raw);

  const readValue: OpcuaSession["readValue"] = (input) =>
    Effect.gen(function* () {
      if (hasStructureSpec(input)) {
        yield* structureRuntime.ensureInitialized();
      }
      const dataValue = yield* readDataValue(raw, input.nodeId);
      return sampleFromDataValue(input, dataValue, structureRuntime);
    }) as never;

  const readValues = <const Specs extends ReadonlyArray<ValueSpec>>(
    specs: Specs,
  ) =>
    Effect.gen(function* () {
      if (specs.some(hasStructureSpec)) {
        yield* structureRuntime.ensureInitialized();
      }
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
        sampleFromDataValue(spec, dataValues[index]!, structureRuntime),
      ) as ReadValuesResult<Specs>;
    });

  const valueHandle: OpcuaSession["valueHandle"] = (input) =>
    Effect.gen(function* () {
      const requested = input.capabilities ?? Capabilities.read;
      if (hasStructureSpec(input)) {
        yield* structureRuntime.ensureInitialized();
      }
      const metadata = yield* discoverMetadata(raw, input.nodeId, requested);
      const structureError = validateValueStructureSpec(
        "valueHandle.structure",
        input,
        metadata,
      );
      if (structureError) return yield* Effect.fail(structureError);
      const nodeId = coerceNodeId(input.nodeId);
      const base = {
        nodeId: input.nodeId,
        schema: input.schema,
        structure: input.structure,
        metadata,
        capabilities: requested,
        raw: { nodeId, builtInDataType: metadata.raw.builtInDataType },
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
            structure: input.structure,
            value,
            metadata,
            structureRuntime,
          });
      }
      return handle;
    }) as never;

  const writeValue: OpcuaSession["writeValue"] = (input) =>
    Effect.gen(function* () {
      if (hasStructureSpec(input)) {
        yield* structureRuntime.ensureInitialized();
      }
      const metadata = yield* discoverMetadata(raw, input.nodeId, [
        "write",
      ] as const);
      const structureError = validateValueStructureSpec(
        "writeValue.structure",
        input,
        metadata,
      );
      if (structureError) return yield* Effect.fail(structureError);
      return (yield* writeByMetadata(raw, {
        ...input,
        metadata,
        structureRuntime,
      })) as OpcuaWriteResult;
    }) as never;

  const writeValues: OpcuaSession["writeValues"] = (specs) =>
    Effect.gen(function* () {
      const writePayloads: Array<WriteValueOptions> = [];
      for (const spec of specs) {
        if (hasStructureSpec(spec)) {
          yield* structureRuntime.ensureInitialized();
        }
        const metadata = yield* discoverMetadata(raw, spec.nodeId, [
          "write",
        ] as const);
        const structureError = validateValueStructureSpec(
          "writeValues.structure",
          spec,
          metadata,
        );
        if (structureError) return yield* Effect.fail(structureError);
        const variant = yield* makeVariant(
          spec.nodeId,
          metadata,
          spec.value,
          spec.schema,
          spec.structure,
          structureRuntime,
        );
        writePayloads.push({
          nodeId: coerceNodeId(spec.nodeId),
          attributeId: AttributeIds.Value,
          value: {
            value: variant,
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

  const writeHandleValues = <
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Handles extends ReadonlyArray<WritableOpcuaValueHandle<any>>,
  >(writes: {
    readonly [Index in keyof Handles]: WriteEntry<Handles[Index]>;
  }) =>
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
        const variant = yield* makeVariant(
          write.handle.nodeId,
          write.handle.metadata,
          write.value,
          write.handle.schema,
          write.handle.structure,
          structureRuntime,
        );
        writePayloads.push({
          nodeId: coerceNodeId(write.handle.nodeId),
          attributeId: AttributeIds.Value,
          value: {
            value: variant,
          },
        });
      }
      const statusCodes = yield* Effect.tryPromise({
        try: () => raw.write(writePayloads),
        catch: (cause) =>
          new OpcuaServiceError({ operation: "writeHandleValues", cause }),
      });
      return writes.map((write, index) =>
        writeResult(write.handle.nodeId, statusCodes[index]!),
      ) as OpcuaWriteValuesResult<NodeIdsOfHandles<Handles>>;
    });

  const methodHandle: OpcuaSession["methodHandle"] = (spec) =>
    makeMethodHandle(raw, spec, structureRuntime);

  const callMethod: OpcuaSession["callMethod"] = (spec, options) =>
    Effect.gen(function* () {
      const handle = yield* methodHandle(spec);
      return yield* handle.call(spec.inputValues, options);
    });

  const callMethodHandles_: OpcuaSession["callMethodHandles"] = (entries) =>
    callMethodHandles(raw, entries, structureRuntime);

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
      return makeSubscription(
        rawSubscription,
        subscriptionEvents,
        structureRuntime,
      );
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
    methodHandle,
    callMethod,
    callMethodHandles: callMethodHandles_,
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
