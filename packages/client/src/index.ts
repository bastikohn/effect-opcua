import {
  AccessLevelFlag,
  AttributeIds,
  ClientSubscription,
  coerceNodeId,
  DataType,
  DataChangeFilter,
  DataChangeTrigger,
  DataValue,
  DeadbandType,
  NodeId,
  OPCUAClient,
  StatusCode,
  StatusCodes,
  TimestampsToReturn,
  Variant,
  VariantArrayType,
  type ClientMonitoredItemGroup,
  type ClientSession,
  type OPCUAClientOptions,
  type ReadValueIdOptions,
  type UserIdentityInfo,
  type WriteValueOptions,
} from "node-opcua";
import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  PubSub,
  Queue,
  Schema,
  Scope,
  Stream,
} from "effect";

export type NodeIdString = string;
export type Capability = "read" | "write";
export type CapabilitySet = ReadonlyArray<Capability>;

const EVENT_BUFFER_SIZE = 256;
const DEFAULT_LIFETIME_COUNT = 60;
const DEFAULT_MAX_KEEP_ALIVE_COUNT = 10;
const DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH = 0;
const DEFAULT_PUBLISHING_ENABLED = true;
const DEFAULT_PRIORITY = 0;

export const capabilities = <
  const Capabilities extends ReadonlyArray<Capability>,
>(
  ...capabilities: Capabilities
): Capabilities => capabilities;

export const Capabilities = {
  read: capabilities("read"),
  write: capabilities("write"),
  readWrite: capabilities("read", "write"),
} as const;

export class OpcuaConnectError extends Data.TaggedError("OpcuaConnectError")<{
  readonly endpointUrl: string;
  readonly cause?: unknown;
}> {}

export class OpcuaDisconnectError extends Data.TaggedError(
  "OpcuaDisconnectError",
)<{
  readonly endpointUrl?: string;
  readonly cause?: unknown;
}> {}

export class OpcuaSessionCreateError extends Data.TaggedError(
  "OpcuaSessionCreateError",
)<{
  readonly endpointUrl?: string;
  readonly cause?: unknown;
}> {}

export class OpcuaSessionCloseError extends Data.TaggedError(
  "OpcuaSessionCloseError",
)<{
  readonly cause?: unknown;
}> {}

export class OpcuaSubscriptionCreateError extends Data.TaggedError(
  "OpcuaSubscriptionCreateError",
)<{
  readonly cause?: unknown;
}> {}

export class OpcuaMonitorCreateError extends Data.TaggedError(
  "OpcuaMonitorCreateError",
)<{
  readonly subscriptionId?: number;
  readonly nodeIds?: ReadonlyArray<NodeIdString>;
  readonly details?: ReadonlyArray<{
    readonly nodeId: NodeIdString;
    readonly statusCode?: StatusCode;
    readonly cause?: unknown;
  }>;
  readonly cause?: unknown;
}> {}

export class OpcuaServiceError extends Data.TaggedError("OpcuaServiceError")<{
  readonly operation: string;
  readonly nodeId?: NodeIdString;
  readonly cause?: unknown;
}> {}

export class OpcuaNonGoodStatusError extends Data.TaggedError(
  "OpcuaNonGoodStatusError",
)<{
  readonly operation: string;
  readonly nodeId: NodeIdString;
  readonly statusCode: StatusCode;
  readonly dataValue?: DataValue;
  readonly cause?: unknown;
}> {}

export class OpcuaDecodeError extends Data.TaggedError("OpcuaDecodeError")<{
  readonly nodeId: NodeIdString;
  readonly error: Schema.SchemaError;
  readonly dataValue: DataValue;
  readonly cause?: unknown;
}> {}

export class OpcuaEncodeError extends Data.TaggedError("OpcuaEncodeError")<{
  readonly nodeId: NodeIdString;
  readonly value: unknown;
  readonly error: unknown;
  readonly cause?: unknown;
}> {}

export class OpcuaAccessDeniedError extends Data.TaggedError(
  "OpcuaAccessDeniedError",
)<{
  readonly nodeId: NodeIdString;
  readonly requestedCapability: Capability;
  readonly accessLevel?: number;
  readonly userAccessLevel?: number;
  readonly cause?: unknown;
}> {}

export class OpcuaSchemaDataTypeMismatchError extends Data.TaggedError(
  "OpcuaSchemaDataTypeMismatchError",
)<{
  readonly nodeId: NodeIdString;
  readonly expected: string;
  readonly actual: string;
  readonly cause?: unknown;
}> {}

export class OpcuaUnsupportedValueRankError extends Data.TaggedError(
  "OpcuaUnsupportedValueRankError",
)<{
  readonly nodeId: NodeIdString;
  readonly valueRank: number;
  readonly cause?: unknown;
}> {}

export class OpcuaConfigurationError extends Data.TaggedError(
  "OpcuaConfigurationError",
)<{
  readonly operation: string;
  readonly nodeId?: NodeIdString;
  readonly cause?: unknown;
}> {}

export type OpcuaClientEvent =
  | { readonly _tag: "Connected"; readonly endpointUrl: string }
  | {
      readonly _tag: "ConnectionFailed";
      readonly endpointUrl: string;
      readonly cause: unknown;
    }
  | { readonly _tag: "Backoff"; readonly raw: unknown }
  | { readonly _tag: "StartReconnection"; readonly raw: unknown }
  | { readonly _tag: "AfterReconnection"; readonly raw: unknown }
  | { readonly _tag: "ConnectionLost"; readonly raw: unknown }
  | { readonly _tag: "ConnectionReestablished"; readonly raw: unknown }
  | { readonly _tag: "Disconnected"; readonly endpointUrl?: string };

export type OpcuaSessionEvent =
  | { readonly _tag: "KeepAlive"; readonly raw: unknown }
  | { readonly _tag: "KeepAliveFailure"; readonly raw: unknown }
  | { readonly _tag: "SessionClosed"; readonly raw: unknown }
  | { readonly _tag: "SessionRestored" };

export type OpcuaSubscriptionEvent =
  | { readonly _tag: "Started"; readonly subscriptionId: number }
  | {
      readonly _tag: "Terminated";
      readonly subscriptionId?: number;
      readonly cause?: unknown;
    }
  | { readonly _tag: "KeepAlive"; readonly subscriptionId: number }
  | {
      readonly _tag: "InternalError";
      readonly subscriptionId?: number;
      readonly cause: unknown;
    }
  | {
      readonly _tag: "StatusChanged";
      readonly subscriptionId?: number;
      readonly raw: unknown;
    }
  | {
      readonly _tag: "ClientBufferDropped";
      readonly subscriptionId?: number;
      readonly nodeId: NodeIdString;
    }
  | {
      readonly _tag: "MonitorItemsCreated";
      readonly subscriptionId?: number;
      readonly nodeIds: ReadonlyArray<NodeIdString>;
    }
  | {
      readonly _tag: "MonitorItemsTerminated";
      readonly subscriptionId?: number;
      readonly nodeIds: ReadonlyArray<NodeIdString>;
    };

export type OpcuaValueSample<A, Id extends string> =
  | {
      readonly _tag: "Value";
      readonly nodeId: Id;
      readonly value: A;
      readonly dataValue: DataValue;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly dataValue: DataValue;
    }
  | {
      readonly _tag: "DecodeError";
      readonly nodeId: Id;
      readonly error: Schema.SchemaError;
      readonly dataValue: DataValue;
    };

export type OpcuaWriteValuesResult<Ids extends string> = {
  readonly [Id in Ids]: StatusCode;
};

export type OpcuaValueMetadata = {
  readonly nodeId: NodeIdString;
  readonly dataType: DataType;
  readonly dataTypeNodeId: NodeId;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly accessLevel: number;
  readonly userAccessLevel?: number;
};

export type ClientBufferPolicy =
  | { readonly _tag: "Sliding"; readonly capacity: number }
  | { readonly _tag: "Dropping"; readonly capacity: number };

export const ClientBufferPolicy = {
  sliding: (capacity: number): ClientBufferPolicy => ({
    _tag: "Sliding",
    capacity,
  }),
  dropping: (capacity: number): ClientBufferPolicy => ({
    _tag: "Dropping",
    capacity,
  }),
  latest: (): ClientBufferPolicy => ({ _tag: "Sliding", capacity: 1 }),
};

export type MonitorValueDeadband =
  | { readonly _tag: "None" }
  | { readonly _tag: "Absolute"; readonly value: number }
  | { readonly _tag: "Percent"; readonly value: number };

export const MonitorValueDeadband = {
  none: (): MonitorValueDeadband => ({ _tag: "None" }),
  absolute: (value: number): MonitorValueDeadband => ({
    _tag: "Absolute",
    value,
  }),
  percent: (value: number): MonitorValueDeadband => ({
    _tag: "Percent",
    value,
  }),
};

export type MonitorValueFilter =
  | { readonly _tag: "None" }
  | { readonly _tag: "Status" }
  | {
      readonly _tag: "StatusValue";
      readonly deadband: MonitorValueDeadband;
    }
  | {
      readonly _tag: "StatusValueTimestamp";
      readonly deadband: MonitorValueDeadband;
    };

export const MonitorValueFilter = {
  none: (): MonitorValueFilter => ({ _tag: "None" }),
  status: (): MonitorValueFilter => ({ _tag: "Status" }),
  statusValue: (
    deadband: MonitorValueDeadband = MonitorValueDeadband.none(),
  ): MonitorValueFilter => ({
    _tag: "StatusValue",
    deadband,
  }),
  statusValueTimestamp: (
    deadband: MonitorValueDeadband = MonitorValueDeadband.none(),
  ): MonitorValueFilter => ({
    _tag: "StatusValueTimestamp",
    deadband,
  }),
};

type AnySchema = Schema.Schema<unknown>;
type SchemaType<S> = S extends Schema.Schema<infer A> ? A : never;
type ValueSpec<Id extends string = string, S extends AnySchema = AnySchema> = {
  readonly nodeId: Id;
  readonly schema: S;
};
type ReadValuesResult<Specs extends ReadonlyArray<ValueSpec>> = {
  readonly [Spec in Specs[number] as Spec["nodeId"]]: OpcuaValueSample<
    SchemaType<Spec["schema"]>,
    Spec["nodeId"]
  >;
};
type HasCapability<
  Caps extends CapabilitySet,
  Cap extends Capability,
> = Cap extends Caps[number] ? unknown : never;
type ReadCapabilityPart<A, Caps extends CapabilitySet> =
  HasCapability<Caps, "read"> extends never
    ? Record<never, never>
    : {
        readonly read: () => Effect.Effect<
          A,
          OpcuaNonGoodStatusError | OpcuaDecodeError | OpcuaServiceError
        >;
      };
type WriteCapabilityPart<A, Caps extends CapabilitySet> =
  HasCapability<Caps, "write"> extends never
    ? Record<never, never>
    : {
        readonly write: (
          value: A,
        ) => Effect.Effect<
          void,
          | OpcuaEncodeError
          | OpcuaNonGoodStatusError
          | OpcuaServiceError
          | OpcuaAccessDeniedError
        >;
      };

export type OpcuaValueHandle<
  A,
  Caps extends CapabilitySet = typeof Capabilities.readWrite,
  Id extends string = string,
> = {
  readonly nodeId: Id;
  readonly schema: Schema.Schema<A>;
  readonly metadata: OpcuaValueMetadata;
  readonly capabilities: Caps;
  readonly raw: {
    readonly nodeId: NodeId;
    readonly dataType: DataType;
  };
} & ReadCapabilityPart<A, Caps> &
  WriteCapabilityPart<A, Caps>;

export type WritableOpcuaValueHandle<A = any, Id extends string = string> =
  | OpcuaValueHandle<A, typeof Capabilities.write, Id>
  | OpcuaValueHandle<A, typeof Capabilities.readWrite, Id>;

type ValueOfHandle<H> =
  H extends OpcuaValueHandle<infer A, CapabilitySet, string> ? A : never;
type NodeIdOfHandle<H> =
  H extends OpcuaValueHandle<any, CapabilitySet, infer Id> ? Id : never;
type WriteEntry<H extends WritableOpcuaValueHandle<any, string>> = {
  readonly handle: H;
  readonly value: ValueOfHandle<H>;
};

export type MonitorValueSpec<
  Id extends string = string,
  S extends AnySchema = AnySchema,
> = {
  readonly nodeId: Id;
  readonly schema: S;
  readonly samplingInterval?: Duration.Duration;
  readonly filter?: MonitorValueFilter;
};

export type MonitorValuesOptions = {
  readonly samplingInterval: Duration.Duration;
  readonly queueSize: number;
  readonly discardOldest: boolean;
  readonly clientBuffer: ClientBufferPolicy;
  readonly filter?: MonitorValueFilter;
};

export type OpcuaSubscription = {
  readonly monitorValues: <const Specs extends ReadonlyArray<MonitorValueSpec>>(
    specs: Specs,
    options: MonitorValuesOptions,
  ) => Stream.Stream<
    Specs[number] extends MonitorValueSpec<infer Id, infer S>
      ? OpcuaValueSample<SchemaType<S>, Id>
      : never,
    OpcuaMonitorCreateError | OpcuaConfigurationError
  >;
  readonly events: Stream.Stream<OpcuaSubscriptionEvent>;
  readonly raw: ClientSubscription;
};

export type OpcuaClient = {
  readonly events: Stream.Stream<OpcuaClientEvent>;
  readonly raw: OPCUAClient;
};

export type OpcuaSession = {
  readonly readValue: <S extends AnySchema>(
    input: ValueSpec<NodeIdString, S>,
  ) => Effect.Effect<
    SchemaType<S>,
    OpcuaNonGoodStatusError | OpcuaDecodeError | OpcuaServiceError
  >;
  readonly readValues: <const Specs extends ReadonlyArray<ValueSpec>>(
    specs: Specs,
  ) => Effect.Effect<
    ReadValuesResult<Specs>,
    OpcuaConfigurationError | OpcuaServiceError
  >;
  readonly valueHandle: <
    const Id extends NodeIdString,
    S extends AnySchema,
    const Caps extends CapabilitySet = typeof Capabilities.readWrite,
  >(
    input: ValueSpec<Id, S> & { readonly capabilities?: Caps },
  ) => Effect.Effect<
    OpcuaValueHandle<SchemaType<S>, Caps, Id>,
    | OpcuaServiceError
    | OpcuaAccessDeniedError
    | OpcuaUnsupportedValueRankError
    | OpcuaSchemaDataTypeMismatchError
    | OpcuaConfigurationError
  >;
  readonly writeValues: <
    const Handles extends ReadonlyArray<WritableOpcuaValueHandle<any>>,
  >(writes: {
    readonly [Index in keyof Handles]: WriteEntry<Handles[Index]>;
  }) => Effect.Effect<
    OpcuaWriteValuesResult<NodeIdOfHandle<Handles[number]>>,
    OpcuaConfigurationError | OpcuaEncodeError | OpcuaServiceError
  >;
  readonly createSubscription: (options: {
    readonly publishingInterval: Duration.Duration;
  }) => Effect.Effect<
    OpcuaSubscription,
    OpcuaSubscriptionCreateError,
    Scope.Scope
  >;
  readonly events: Stream.Stream<OpcuaSessionEvent>;
  readonly raw: ClientSession;
};

export const OpcuaClient = Object.assign(
  Context.Service<OpcuaClient>("@effect-opcua/client/OpcuaClient"),
  {
    layer: (options: {
      readonly endpointUrl: string;
      readonly clientOptions?: OPCUAClientOptions;
    }) =>
      Layer.effect(
        OpcuaClient,
        Effect.gen(function* () {
          const events =
            yield* PubSub.sliding<OpcuaClientEvent>(EVENT_BUFFER_SIZE);
          const raw = OPCUAClient.create(options.clientOptions ?? {});
          wireClientEvents(raw, events);
          yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: async () => {
                await raw.connect(options.endpointUrl);
                publishUnsafe(events, {
                  _tag: "Connected",
                  endpointUrl: options.endpointUrl,
                });
                return raw;
              },
              catch: (cause) => {
                publishUnsafe(events, {
                  _tag: "ConnectionFailed",
                  endpointUrl: options.endpointUrl,
                  cause,
                });
                return new OpcuaConnectError({
                  endpointUrl: options.endpointUrl,
                  cause,
                });
              },
            }),
            () =>
              Effect.tryPromise({
                try: async () => {
                  await raw.disconnect();
                  publishUnsafe(events, {
                    _tag: "Disconnected",
                    endpointUrl: options.endpointUrl,
                  });
                },
                catch: (cause) =>
                  new OpcuaDisconnectError({
                    endpointUrl: options.endpointUrl,
                    cause,
                  }),
              }).pipe(Effect.ignore),
          );
          return {
            events: Stream.fromPubSub(events),
            raw,
          };
        }),
      ),
  },
);

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
              }).pipe(Effect.ignore),
          );
          wireSessionEvents(raw, events);
          return makeSession(raw, events);
        }),
      ),
  },
);

const makeSession = (
  raw: ClientSession,
  events: PubSub.PubSub<OpcuaSessionEvent>,
): OpcuaSession => {
  const readValue = <S extends AnySchema>(input: ValueSpec<NodeIdString, S>) =>
    readDataValue(raw, input.nodeId).pipe(
      Effect.flatMap((dataValue) =>
        strictDecode(input.nodeId, input.schema, dataValue),
      ),
    ) as Effect.Effect<
      SchemaType<S>,
      OpcuaNonGoodStatusError | OpcuaDecodeError | OpcuaServiceError
    >;

  const readValues = <const Specs extends ReadonlyArray<ValueSpec>>(
    specs: Specs,
  ) =>
    Effect.gen(function* () {
      const duplicate = duplicateNodeIdError("readValues", specs);
      if (duplicate) return yield* Effect.fail(duplicate);
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
      const out: Record<string, OpcuaValueSample<unknown, string>> = {};
      for (let index = 0; index < specs.length; index++) {
        out[specs[index]!.nodeId] = sampleFromDataValue(
          specs[index]!,
          dataValues[index]!,
        );
      }
      return out as ReadValuesResult<Specs>;
    });

  const valueHandle = <
    const Id extends NodeIdString,
    S extends AnySchema,
    const Caps extends CapabilitySet = typeof Capabilities.readWrite,
  >(
    input: ValueSpec<Id, S> & { readonly capabilities?: Caps },
  ) =>
    Effect.gen(function* () {
      const requested = (input.capabilities ?? Capabilities.readWrite) as Caps;
      const metadata = yield* discoverMetadata(raw, input.nodeId, requested);
      const rankError = schemaRankError(
        input.nodeId,
        input.schema,
        metadata.valueRank,
      );
      if (rankError) return yield* Effect.fail(rankError);
      const dataTypeError = schemaDataTypeError(
        input.nodeId,
        input.schema,
        metadata.dataType,
      );
      if (dataTypeError) return yield* Effect.fail(dataTypeError);
      const nodeId = coerceNodeId(input.nodeId);
      const base = {
        nodeId: input.nodeId,
        schema: input.schema,
        metadata,
        capabilities: requested,
        raw: { nodeId, dataType: metadata.dataType },
      };
      const handle: Record<string, unknown> = { ...base };
      if (hasCapability(requested, "read")) {
        handle.read = () => readValue(input);
      }
      if (hasCapability(requested, "write")) {
        handle.write = (value: SchemaType<S>) =>
          writeOne(
            raw,
            base as unknown as OpcuaValueHandle<SchemaType<S>, Caps, Id>,
            value,
            true,
          );
      }
      return handle as OpcuaValueHandle<SchemaType<S>, Caps, Id>;
    });

  const writeValues: OpcuaSession["writeValues"] = (writes) =>
    Effect.gen(function* () {
      const nodeIds = writes.map((write) => write.handle.nodeId);
      const duplicate = duplicateStringError("writeValues", nodeIds);
      if (duplicate) return yield* Effect.fail(duplicate);
      for (const write of writes) {
        if (!hasCapability(write.handle.capabilities, "write")) {
          return yield* Effect.fail(
            new OpcuaConfigurationError({
              operation: "writeValues",
              nodeId: write.handle.nodeId,
              cause: "Handle lacks write capability",
            }),
          );
        }
      }
      const writePayloads: Array<WriteValueOptions> = [];
      for (const write of writes) {
        const encoded = yield* encodeHandleValue(
          write.handle as OpcuaValueHandle<unknown, CapabilitySet>,
          write.value,
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
          new OpcuaServiceError({ operation: "writeValues", cause }),
      });
      const result: Record<string, StatusCode> = {};
      for (let index = 0; index < writes.length; index++) {
        result[writes[index]!.handle.nodeId] = statusCodes[index]!;
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
              requestedLifetimeCount: DEFAULT_LIFETIME_COUNT,
              requestedMaxKeepAliveCount: DEFAULT_MAX_KEEP_ALIVE_COUNT,
              maxNotificationsPerPublish: DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH,
              publishingEnabled: DEFAULT_PUBLISHING_ENABLED,
              priority: DEFAULT_PRIORITY,
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
          }).pipe(Effect.ignore),
      );
      return makeSubscription(rawSubscription, subscriptionEvents);
    });

  return {
    readValue,
    readValues,
    valueHandle,
    writeValues,
    createSubscription,
    events: Stream.fromPubSub(events),
    raw,
  };
};

const makeSubscription = (
  raw: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
): OpcuaSubscription => {
  const monitorValues = (<const Specs extends ReadonlyArray<MonitorValueSpec>>(
    specs: Specs,
    options: MonitorValuesOptions,
  ) =>
    Stream.unwrap(
      Effect.gen(function* () {
        const duplicate = duplicateNodeIdError("monitorValues", specs);
        if (duplicate) return yield* Effect.fail(duplicate);
        const bufferError = bufferPolicyError(options.clientBuffer);
        if (bufferError) return yield* Effect.fail(bufferError);
        const queue = yield* makeQueue<
          OpcuaValueSample<unknown, string>,
          OpcuaMonitorCreateError
        >(options.clientBuffer);
        const monitorGroups = groupMonitorSpecs(
          specs,
          durationMillis(options.samplingInterval),
          options.filter,
        );
        for (const monitorGroup of monitorGroups) {
          const group = yield* acquireMonitorGroup(
            raw,
            events,
            monitorGroup,
            options,
          );
          wireMonitorGroup(raw, events, group, monitorGroup, queue, options);
        }
        publishUnsafe(events, {
          _tag: "MonitorItemsCreated",
          subscriptionId: raw.subscriptionId,
          nodeIds: specs.map((spec) => spec.nodeId),
        });
        return Stream.fromQueue(queue).pipe(
          Stream.ensuring(Queue.shutdown(queue)),
        );
      }),
    ) as Stream.Stream<
      Specs[number] extends MonitorValueSpec<infer Id, infer S>
        ? OpcuaValueSample<SchemaType<S>, Id>
        : never,
      OpcuaMonitorCreateError | OpcuaConfigurationError
    >) as OpcuaSubscription["monitorValues"];

  return {
    monitorValues,
    events: Stream.fromPubSub(events),
    raw,
  };
};

type MonitorGroupEntry = {
  readonly spec: MonitorValueSpec;
};

type MonitorGroupSpec = {
  readonly samplingInterval: number;
  readonly filter?: MonitorValueFilter;
  readonly entries: ReadonlyArray<MonitorGroupEntry>;
};

const groupMonitorSpecs = (
  specs: ReadonlyArray<MonitorValueSpec>,
  defaultSamplingInterval: number,
  defaultFilter?: MonitorValueFilter,
): ReadonlyArray<MonitorGroupSpec> => {
  const groups = new Map<
    string,
    {
      readonly samplingInterval: number;
      readonly filter?: MonitorValueFilter;
      readonly entries: Array<MonitorGroupEntry>;
    }
  >();
  specs.forEach((spec) => {
    const samplingInterval = spec.samplingInterval
      ? durationMillis(spec.samplingInterval)
      : defaultSamplingInterval;
    const filter = spec.filter ?? defaultFilter;
    const key = `${samplingInterval}:${monitorValueFilterKey(filter)}`;
    const group = groups.get(key);
    if (group) {
      group.entries.push({ spec });
    } else {
      groups.set(key, {
        samplingInterval,
        filter,
        entries: [{ spec }],
      });
    }
  });
  return Array.from(groups.values());
};

const monitorValueFilterKey = (filter: MonitorValueFilter | undefined) => {
  if (!filter) return "None";
  switch (filter._tag) {
    case "None":
      return "None";
    case "Status":
      return "Status";
    case "StatusValue":
      return `StatusValue:${monitorValueDeadbandKey(filter.deadband)}`;
    case "StatusValueTimestamp":
      return `StatusValueTimestamp:${monitorValueDeadbandKey(filter.deadband)}`;
  }
};

const monitorValueDeadbandKey = (deadband: MonitorValueDeadband) => {
  switch (deadband._tag) {
    case "None":
      return "None";
    case "Absolute":
      return `Absolute:${deadband.value}`;
    case "Percent":
      return `Percent:${deadband.value}`;
  }
};

const toNodeOpcuaDataChangeFilter = (filter: MonitorValueFilter | undefined) =>
  filter && filter._tag !== "None"
    ? new DataChangeFilter({
        trigger: toNodeOpcuaDataChangeTrigger(filter),
        ...toNodeOpcuaDeadband(filter),
      })
    : undefined;

const toNodeOpcuaDataChangeTrigger = (filter: MonitorValueFilter) => {
  switch (filter._tag) {
    case "None":
      return DataChangeTrigger.StatusValue;
    case "Status":
      return DataChangeTrigger.Status;
    case "StatusValue":
      return DataChangeTrigger.StatusValue;
    case "StatusValueTimestamp":
      return DataChangeTrigger.StatusValueTimestamp;
  }
};

const toNodeOpcuaDeadband = (
  filter: MonitorValueFilter,
): {
  readonly deadbandType?: DeadbandType;
  readonly deadbandValue?: number;
} => {
  if (filter._tag === "None" || filter._tag === "Status") return {};
  switch (filter.deadband._tag) {
    case "None":
      return {
        deadbandType: DeadbandType.None,
        deadbandValue: 0,
      };
    case "Absolute":
      return {
        deadbandType: DeadbandType.Absolute,
        deadbandValue: filter.deadband.value,
      };
    case "Percent":
      return {
        deadbandType: DeadbandType.Percent,
        deadbandValue: filter.deadband.value,
      };
  }
};

const acquireMonitorGroup = (
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  groupSpec: MonitorGroupSpec,
  options: MonitorValuesOptions,
) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const group = yield* Effect.tryPromise({
        try: () =>
          subscription.monitorItems(
            groupSpec.entries.map(({ spec }) => ({
              nodeId: coerceNodeId(spec.nodeId),
              attributeId: AttributeIds.Value,
            })),
            {
              samplingInterval: groupSpec.samplingInterval,
              filter: toNodeOpcuaDataChangeFilter(groupSpec.filter),
              queueSize: options.queueSize,
              discardOldest: options.discardOldest,
            },
            TimestampsToReturn.Both,
          ),
        catch: (cause) => monitorCreateError(subscription, groupSpec, cause),
      });
      const failures = monitorCreateFailures(group, groupSpec);
      if (failures.length > 0) {
        yield* terminateMonitorGroup(group).pipe(Effect.ignore);
        return yield* Effect.fail(
          monitorCreateError(
            subscription,
            groupSpec,
            "One or more monitored items failed to initialize",
            failures,
          ),
        );
      }
      return group;
    }),
    (group) =>
      terminateMonitorGroup(group).pipe(
        Effect.tap(() =>
          Effect.sync(() =>
            publishUnsafe(events, {
              _tag: "MonitorItemsTerminated",
              subscriptionId: subscription.subscriptionId,
              nodeIds: groupSpec.entries.map(({ spec }) => spec.nodeId),
            }),
          ),
        ),
      ),
  );

const terminateMonitorGroup = (group: ClientMonitoredItemGroup) =>
  Effect.tryPromise({
    try: () => group.terminate(),
    catch: (cause) => cause,
  }).pipe(Effect.ignore);

const monitorCreateFailures = (
  group: ClientMonitoredItemGroup,
  groupSpec: MonitorGroupSpec,
) =>
  group.monitoredItems
    .flatMap((item, index) => {
      const entry = groupSpec.entries[index];
      return entry
        ? [
            {
              nodeId: entry.spec.nodeId,
              statusCode: item.statusCode,
              cause: item.result,
            },
          ]
        : [];
    })
    .filter((detail) => !detail.statusCode || !isGood(detail.statusCode));

const monitorCreateError = (
  subscription: ClientSubscription,
  groupSpec: MonitorGroupSpec,
  cause: unknown,
  details?: ReadonlyArray<{
    readonly nodeId: NodeIdString;
    readonly statusCode?: StatusCode;
    readonly cause?: unknown;
  }>,
) =>
  new OpcuaMonitorCreateError({
    subscriptionId: subscription.subscriptionId,
    nodeIds: groupSpec.entries.map(({ spec }) => spec.nodeId),
    details,
    cause,
  });

const wireMonitorGroup = (
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  group: ClientMonitoredItemGroup,
  groupSpec: MonitorGroupSpec,
  queue: Queue.Queue<
    OpcuaValueSample<unknown, string>,
    OpcuaMonitorCreateError
  >,
  options: MonitorValuesOptions,
) => {
  group.on("changed", (_item, dataValue, index) => {
    const spec = groupSpec.entries[index]?.spec;
    if (!spec) return;
    offerMonitorSample(
      subscription,
      events,
      queue,
      options.clientBuffer,
      sampleFromDataValue(spec, dataValue),
    );
  });
  group.on("err", (message) => {
    publishUnsafe(events, {
      _tag: "InternalError",
      subscriptionId: subscription.subscriptionId,
      cause: message,
    });
  });
  group.on("terminated", (cause) => {
    publishUnsafe(events, {
      _tag: "MonitorItemsTerminated",
      subscriptionId: subscription.subscriptionId,
      nodeIds: groupSpec.entries.map(({ spec }) => spec.nodeId),
    });
    Effect.runFork(
      Queue.fail(queue, monitorCreateError(subscription, groupSpec, cause)),
    );
  });
};

const offerMonitorSample = (
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  queue: Queue.Queue<
    OpcuaValueSample<unknown, string>,
    OpcuaMonitorCreateError
  >,
  policy: ClientBufferPolicy,
  sample: OpcuaValueSample<unknown, string>,
) => {
  const willDrop =
    policy._tag === "Sliding" && Queue.sizeUnsafe(queue) >= policy.capacity;
  const offered = Queue.offerUnsafe(queue, sample);
  if (willDrop || !offered) {
    publishUnsafe(events, {
      _tag: "ClientBufferDropped",
      subscriptionId: subscription.subscriptionId,
      nodeId: sample.nodeId,
    });
  }
};

const readDataValue = (session: ClientSession, nodeId: NodeIdString) =>
  Effect.tryPromise({
    try: () =>
      session.read(
        {
          nodeId: coerceNodeId(nodeId),
          attributeId: AttributeIds.Value,
        },
        0,
      ),
    catch: (cause) =>
      new OpcuaServiceError({ operation: "readValue", nodeId, cause }),
  });

const strictDecode = <S extends AnySchema>(
  nodeId: NodeIdString,
  schema: S,
  dataValue: DataValue,
): Effect.Effect<SchemaType<S>, OpcuaNonGoodStatusError | OpcuaDecodeError> => {
  if (!isGood(dataValue.statusCode)) {
    return Effect.fail(
      new OpcuaNonGoodStatusError({
        operation: "readValue",
        nodeId,
        statusCode: dataValue.statusCode,
        dataValue,
      }),
    );
  }
  return Effect.sync(() =>
    decodeWithSchema(schema, dataValue.value?.value),
  ).pipe(
    Effect.mapError(
      (error) => new OpcuaDecodeError({ nodeId, error, dataValue }),
    ),
  );
};

const sampleFromDataValue = <Id extends string, S extends AnySchema>(
  spec: ValueSpec<Id, S>,
  dataValue: DataValue,
): OpcuaValueSample<SchemaType<S>, Id> => {
  if (!isGood(dataValue.statusCode)) {
    return { _tag: "NonGoodStatus", nodeId: spec.nodeId, dataValue };
  }
  try {
    return {
      _tag: "Value",
      nodeId: spec.nodeId,
      value: decodeWithSchema(spec.schema, dataValue.value?.value),
      dataValue,
    };
  } catch (error) {
    return {
      _tag: "DecodeError",
      nodeId: spec.nodeId,
      error: error as Schema.SchemaError,
      dataValue,
    };
  }
};

const discoverMetadata = (
  session: ClientSession,
  nodeId: NodeIdString,
  requested: CapabilitySet,
) =>
  Effect.gen(function* () {
    const nodes = [
      AttributeIds.DataType,
      AttributeIds.ValueRank,
      AttributeIds.ArrayDimensions,
      AttributeIds.AccessLevel,
      AttributeIds.UserAccessLevel,
    ].map((attributeId) => ({ nodeId: coerceNodeId(nodeId), attributeId }));
    const [
      dataTypeValue,
      valueRankValue,
      arrayDimensionsValue,
      accessLevelValue,
      userAccessLevelValue,
    ] = yield* Effect.tryPromise({
      try: () => session.read(nodes, 0),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "valueHandle.discovery",
          nodeId,
          cause,
        }),
    });
    if (
      !dataTypeValue ||
      !isGood(dataTypeValue.statusCode) ||
      !(dataTypeValue.value?.value instanceof NodeId)
    ) {
      return yield* Effect.fail(
        new OpcuaConfigurationError({
          operation: "valueHandle.discovery",
          nodeId,
          cause: "DataType is unreadable",
        }),
      );
    }
    if (
      !valueRankValue ||
      !isGood(valueRankValue.statusCode) ||
      typeof valueRankValue.value?.value !== "number"
    ) {
      return yield* Effect.fail(
        new OpcuaConfigurationError({
          operation: "valueHandle.discovery",
          nodeId,
          cause: "ValueRank is unreadable",
        }),
      );
    }
    if (
      !accessLevelValue ||
      !isGood(accessLevelValue.statusCode) ||
      typeof accessLevelValue.value?.value !== "number"
    ) {
      return yield* Effect.fail(
        new OpcuaConfigurationError({
          operation: "valueHandle.discovery",
          nodeId,
          cause: "AccessLevel is unreadable",
        }),
      );
    }
    const valueRank = valueRankValue.value.value as number;
    if (!isSupportedValueRank(valueRank)) {
      return yield* Effect.fail(
        new OpcuaUnsupportedValueRankError({ nodeId, valueRank }),
      );
    }
    const builtInDataType = yield* Effect.tryPromise({
      try: () => session.getBuiltInDataType(coerceNodeId(nodeId)),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "valueHandle.discovery.getBuiltInDataType",
          nodeId,
          cause,
        }),
    });
    const accessLevel = accessLevelValue.value.value as number;
    const userAccessLevel =
      userAccessLevelValue &&
      isGood(userAccessLevelValue.statusCode) &&
      typeof userAccessLevelValue.value?.value === "number"
        ? (userAccessLevelValue.value.value as number)
        : undefined;
    for (const capability of requested) {
      const accessError = accessDeniedError(
        nodeId,
        capability,
        accessLevel,
        userAccessLevel,
      );
      if (accessError) return yield* Effect.fail(accessError);
    }
    return {
      nodeId,
      dataTypeNodeId: dataTypeValue.value.value as NodeId,
      dataType: builtInDataType,
      valueRank,
      arrayDimensions:
        arrayDimensionsValue &&
        isGood(arrayDimensionsValue.statusCode) &&
        Array.isArray(arrayDimensionsValue.value?.value)
          ? arrayDimensionsValue.value.value
          : undefined,
      accessLevel,
      userAccessLevel,
    };
  });

const writeOne = <A, Caps extends CapabilitySet>(
  session: ClientSession,
  handle: OpcuaValueHandle<A, Caps>,
  value: A,
  strictStatus: boolean,
) =>
  Effect.gen(function* () {
    if (!hasCapability(handle.capabilities, "write")) {
      return yield* Effect.fail(
        new OpcuaAccessDeniedError({
          nodeId: handle.nodeId,
          requestedCapability: "write",
        }),
      );
    }
    const encoded = yield* encodeHandleValue(handle, value);
    const statusCode = yield* Effect.tryPromise({
      try: () =>
        session.write({
          nodeId: coerceNodeId(handle.nodeId),
          attributeId: AttributeIds.Value,
          value: {
            value: makeVariant(handle.metadata, encoded),
          },
        }),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "writeValue",
          nodeId: handle.nodeId,
          cause,
        }),
    });
    if (strictStatus && !isGood(statusCode)) {
      return yield* Effect.fail(
        new OpcuaNonGoodStatusError({
          operation: "writeValue",
          nodeId: handle.nodeId,
          statusCode,
        }),
      );
    }
  });

const encodeHandleValue = <A, Caps extends CapabilitySet>(
  handle: OpcuaValueHandle<A, Caps>,
  value: A,
) =>
  Effect.sync(() =>
    Schema.encodeUnknownSync(handle.schema as Schema.Encoder<unknown>)(value),
  ).pipe(
    Effect.mapError(
      (error) => new OpcuaEncodeError({ nodeId: handle.nodeId, value, error }),
    ),
  );

const makeVariant = (metadata: OpcuaValueMetadata, value: unknown) =>
  new Variant({
    dataType: metadata.dataType,
    arrayType: isArrayRank(metadata.valueRank)
      ? VariantArrayType.Array
      : VariantArrayType.Scalar,
    value: value as Variant["value"],
  });

const schemaRankError = (
  nodeId: NodeIdString,
  schema: AnySchema,
  valueRank: number,
) => {
  const schemaIsArray = schemaShape(schema) === "array";
  const valueIsArray = isArrayRank(valueRank);
  if (schemaIsArray !== valueIsArray) {
    return new OpcuaSchemaDataTypeMismatchError({
      nodeId,
      expected: schemaIsArray ? "array" : "scalar",
      actual: valueIsArray ? "array" : "scalar",
    });
  }
  return undefined;
};

const schemaDataTypeError = (
  nodeId: NodeIdString,
  schema: AnySchema,
  dataType: DataType,
) => {
  const expected = schemaDataTypeCategory(schema);
  if (!expected) return undefined;
  const actual = opcuaDataTypeCategory(dataType);
  if (expected !== actual) {
    return new OpcuaSchemaDataTypeMismatchError({
      nodeId,
      expected,
      actual,
    });
  }
  return undefined;
};

const accessDeniedError = (
  nodeId: NodeIdString,
  requestedCapability: Capability,
  accessLevel: number,
  userAccessLevel?: number,
) => {
  const flag =
    requestedCapability === "read"
      ? AccessLevelFlag.CurrentRead
      : AccessLevelFlag.CurrentWrite;
  const hasNodeAccess = (accessLevel & flag) !== 0;
  const hasUserAccess =
    userAccessLevel === undefined || (userAccessLevel & flag) !== 0;
  if (!hasNodeAccess || !hasUserAccess) {
    return new OpcuaAccessDeniedError({
      nodeId,
      requestedCapability,
      accessLevel,
      userAccessLevel,
    });
  }
  return undefined;
};

const bufferPolicyError = (policy: ClientBufferPolicy) => {
  if (!Number.isInteger(policy.capacity) || policy.capacity < 1) {
    return new OpcuaConfigurationError({
      operation: "ClientBufferPolicy",
      cause: "capacity must be a positive integer",
    });
  }
  return undefined;
};

const makeQueue = <A, E>(policy: ClientBufferPolicy) => {
  return policy._tag === "Sliding"
    ? Queue.sliding<A, E>(policy.capacity)
    : Queue.dropping<A, E>(policy.capacity);
};

const duplicateNodeIdError = (
  operation: string,
  specs: ReadonlyArray<{ readonly nodeId: NodeIdString }>,
) =>
  duplicateStringError(
    operation,
    specs.map((spec) => spec.nodeId),
  );

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
const isGood = (statusCode: StatusCode) => statusCode.isGood();
const isSupportedValueRank = (valueRank: number) =>
  valueRank === -1 || valueRank === 1;
const isArrayRank = (valueRank: number) => valueRank === 1;
const hasCapability = (capabilities: CapabilitySet, capability: Capability) =>
  capabilities.includes(capability);
const decodeWithSchema = <S extends AnySchema>(
  schema: S,
  value: unknown,
): SchemaType<S> =>
  Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown>)(
    value,
  ) as SchemaType<S>;

type SchemaAst = {
  readonly _tag?: string;
  readonly literal?: unknown;
  readonly members?: ReadonlyArray<SchemaAst>;
  readonly rest?: ReadonlyArray<SchemaAst>;
  readonly annotations?: {
    readonly typeConstructor?: { readonly _tag?: string };
  };
};

const schemaAst = (schema: AnySchema) =>
  (schema as unknown as { readonly ast?: SchemaAst }).ast;

const schemaShape = (schema: AnySchema): "scalar" | "array" =>
  schemaAst(schema)?._tag === "Arrays" ? "array" : "scalar";

const schemaDataTypeCategory = (schema: AnySchema) => {
  const ast = schemaAst(schema);
  if (!ast) return undefined;
  if (ast._tag === "Arrays") {
    return schemaAstDataTypeCategory(ast.rest?.[0]);
  }
  return schemaAstDataTypeCategory(ast);
};

const schemaAstDataTypeCategory = (
  ast: SchemaAst | undefined,
): "boolean" | "number" | "string" | "date" | undefined => {
  switch (ast?._tag) {
    case "Boolean":
      return "boolean";
    case "Number":
      return "number";
    case "String":
      return "string";
    case "Literal":
      switch (typeof ast.literal) {
        case "boolean":
          return "boolean";
        case "number":
          return "number";
        case "string":
          return "string";
        default:
          return undefined;
      }
    case "Declaration":
      return ast.annotations?.typeConstructor?._tag === "Date"
        ? "date"
        : undefined;
    case "Union": {
      const categories = ast.members
        ?.map(schemaAstDataTypeCategory)
        .filter((category) => category !== undefined);
      if (!categories || categories.length !== ast.members?.length) {
        return undefined;
      }
      const [first] = categories;
      return categories.every((category) => category === first)
        ? first
        : undefined;
    }
    default:
      return undefined;
  }
};

const opcuaDataTypeCategory = (dataType: DataType) => {
  switch (dataType) {
    case DataType.Boolean:
      return "boolean";
    case DataType.SByte:
    case DataType.Byte:
    case DataType.Int16:
    case DataType.UInt16:
    case DataType.Int32:
    case DataType.UInt32:
    case DataType.Int64:
    case DataType.UInt64:
    case DataType.Float:
    case DataType.Double:
      return "number";
    case DataType.String:
      return "string";
    case DataType.DateTime:
      return "date";
    default:
      return DataType[dataType] ?? String(dataType);
  }
};

const publishUnsafe = <A>(pubsub: PubSub.PubSub<A>, event: A) => {
  Effect.runFork(PubSub.publish(pubsub, event));
};

const wireClientEvents = (
  client: OPCUAClient,
  events: PubSub.PubSub<OpcuaClientEvent>,
) => {
  client.on("backoff", (...raw) =>
    publishUnsafe(events, { _tag: "Backoff", raw }),
  );
  client.on("start_reconnection", (...raw) =>
    publishUnsafe(events, { _tag: "StartReconnection", raw }),
  );
  client.on("after_reconnection", (...raw) =>
    publishUnsafe(events, { _tag: "AfterReconnection", raw }),
  );
  client.on("connection_lost", (...raw) =>
    publishUnsafe(events, { _tag: "ConnectionLost", raw }),
  );
  client.on("connection_reestablished", (...raw) =>
    publishUnsafe(events, { _tag: "ConnectionReestablished", raw }),
  );
};

const wireSessionEvents = (
  session: ClientSession,
  events: PubSub.PubSub<OpcuaSessionEvent>,
) => {
  session.on("keepalive", (raw) =>
    publishUnsafe(events, { _tag: "KeepAlive", raw }),
  );
  session.on("keepalive_failure", (raw) =>
    publishUnsafe(events, { _tag: "KeepAliveFailure", raw }),
  );
  session.on("session_closed", (raw) =>
    publishUnsafe(events, { _tag: "SessionClosed", raw }),
  );
  session.on("session_restored", () =>
    publishUnsafe(events, { _tag: "SessionRestored" }),
  );
};

const wireSubscriptionEvents = (
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
) => {
  subscription.on("started", (subscriptionId) =>
    publishUnsafe(events, { _tag: "Started", subscriptionId }),
  );
  subscription.on("terminated", (...raw) =>
    publishUnsafe(events, {
      _tag: "Terminated",
      subscriptionId: subscription.subscriptionId,
      cause: raw,
    }),
  );
  subscription.on("keepalive", () =>
    publishUnsafe(events, {
      _tag: "KeepAlive",
      subscriptionId: subscription.subscriptionId,
    }),
  );
  subscription.on("internal_error", (cause) =>
    publishUnsafe(events, {
      _tag: "InternalError",
      subscriptionId: subscription.subscriptionId,
      cause,
    }),
  );
  subscription.on("status_changed", (...raw) =>
    publishUnsafe(events, {
      _tag: "StatusChanged",
      subscriptionId: subscription.subscriptionId,
      raw,
    }),
  );
};

export type {
  ClientMonitoredItemGroup,
  ClientSession,
  ClientSubscription,
  DataValue,
  NodeId,
  OPCUAClient,
  OPCUAClientOptions,
  ReadValueIdOptions,
  StatusCode,
  UserIdentityInfo,
};
export {
  AccessLevelFlag,
  AttributeIds,
  DataType,
  StatusCodes,
  TimestampsToReturn,
  Variant,
  VariantArrayType,
};
