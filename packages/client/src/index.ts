import {
  AccessLevelFlag,
  AttributeIds,
  BrowseDirection,
  ClientSubscription,
  coerceNodeId,
  DataChangeFilter,
  DataChangeTrigger,
  DataType,
  DataValue,
  DeadbandType,
  makeNodeClassMask,
  makeResultMask,
  NodeClass,
  NodeClassMask,
  NodeId,
  OPCUAClient,
  ResultMask,
  resolveNodeId,
  StatusCode,
  StatusCodes,
  TimestampsToReturn,
  Variant,
  VariantArrayType,
  type BrowseDescriptionOptions,
  type BrowseResult,
  type ClientMonitoredItemGroup,
  type ClientSession,
  type ExpandedNodeId,
  type OPCUAClientOptions,
  type ReferenceDescription,
  type ReadValueIdOptions,
  type UserIdentityInfo,
  type WriteValueOptions,
} from "node-opcua";
import {
  Config,
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  PubSub,
  Queue,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect";

export type NodeIdString = string;
export type ExpandedNodeIdString = string;
export type Capability = "read" | "write";
export type CapabilitySet = ReadonlyArray<Capability>;

const EVENT_BUFFER_SIZE = 256;
const DEFAULT_LIFETIME_COUNT = 60;
const DEFAULT_MAX_KEEP_ALIVE_COUNT = 10;
const DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH = 0;
const DEFAULT_PUBLISHING_ENABLED = true;
const DEFAULT_PRIORITY = 0;
const DEFAULT_BROWSE_REFERENCE_TYPE_ID = "HierarchicalReferences";
const DEFAULT_BROWSE_DIRECTION = BrowseDirection.Forward;
const DEFAULT_BROWSE_INCLUDE_SUBTYPES = true;
const DEFAULT_BROWSE_NODE_CLASS_MASK = 0;
const DEFAULT_BROWSE_RESULT_MASK = makeResultMask(
  "ReferenceType | IsForward | NodeClass | BrowseName | DisplayName | TypeDefinition",
);
const DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE = 0;

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

export type OpcuaStatusInfo = {
  readonly text: string;
  readonly code: number;
  readonly isGood: boolean;
  readonly isUncertain: boolean;
  readonly isBad: boolean;
};

export type OpcuaVariantInfo = {
  readonly dataType: string;
  readonly arrayType: "Scalar" | "Array" | "Matrix";
  readonly valueRank?: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
};

export type OpcuaDynamicValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<OpcuaDynamicValue>
  | { readonly _tag: "DateTime"; readonly iso: string }
  | { readonly _tag: "ByteString"; readonly base64: string }
  | { readonly _tag: "Int64"; readonly text: string }
  | { readonly _tag: "UInt64"; readonly text: string }
  | {
      readonly _tag: "LocalizedText";
      readonly text: string;
      readonly locale?: string;
    }
  | {
      readonly _tag: "QualifiedName";
      readonly namespaceIndex: number;
      readonly name: string;
      readonly text: string;
    }
  | {
      readonly _tag: "NodeId";
      readonly text: string;
      readonly namespace: number;
      readonly identifierType: string;
      readonly value: unknown;
    }
  | {
      readonly _tag: "ExtensionObject";
      readonly typeName?: string;
      readonly value?: unknown;
    };

export type OpcuaNodeIdInfo = {
  readonly text: string;
  readonly namespace: number;
  readonly namespaceUri?: string;
  readonly identifierType: string;
  readonly value: unknown;
};

export type OpcuaExpandedNodeIdInfo = OpcuaNodeIdInfo & {
  readonly serverIndex?: number;
  readonly isLocal: boolean;
  readonly isRemote: boolean;
};

export type OpcuaQualifiedNameInfo = {
  readonly namespaceIndex: number;
  readonly name: string;
  readonly text: string;
};

export type OpcuaLocalizedTextInfo = {
  readonly text: string;
  readonly locale?: string;
};

export type OpcuaBrowseReference = {
  readonly nodeId: OpcuaExpandedNodeIdInfo;
  readonly referenceTypeId?: NodeIdString;
  readonly isForward?: boolean;
  readonly nodeClass?: string;
  readonly browseName?: OpcuaQualifiedNameInfo;
  readonly displayName?: OpcuaLocalizedTextInfo;
  readonly typeDefinition?: OpcuaExpandedNodeIdInfo;
  readonly raw?: ReferenceDescription;
};

export type OpcuaBrowseContinuation = {
  readonly nodeId: NodeIdString;
  readonly raw: Buffer;
};

export type OpcuaBrowseResult = {
  readonly nodeId: NodeIdString;
  readonly status: OpcuaStatusInfo;
  readonly references: ReadonlyArray<OpcuaBrowseReference>;
  readonly continuation?: OpcuaBrowseContinuation;
  readonly raw?: BrowseResult;
};

export type OpcuaBrowseChildrenResult = {
  readonly nodeId: NodeIdString;
  readonly references: ReadonlyArray<OpcuaBrowseReference>;
  readonly continuation?: OpcuaBrowseContinuation;
};

export type OpcuaBrowseOptions = {
  readonly nodeId: NodeIdString;
  readonly referenceTypeId?: NodeIdString;
  readonly browseDirection?: BrowseDirection;
  readonly includeSubtypes?: boolean;
  readonly nodeClassMask?: number;
  readonly resultMask?: number;
  readonly maxReferencesPerNode?: number;
  readonly includeRaw?: boolean;
};

export type OpcuaBrowseChildrenOptions = {
  readonly mode?: "all" | "page";
  readonly maxReferencesPerNode?: number;
  readonly referenceTypeId?: string;
  readonly includeSubtypes?: boolean;
  readonly nodeClassMask?: number;
  readonly includeRaw?: boolean;
};

export type OpcuaValueSample<A, Id extends string = string> =
  | {
      readonly _tag: "Value";
      readonly nodeId: Id;
      readonly value: A;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly raw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly raw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    }
  | {
      readonly _tag: "DecodeError";
      readonly nodeId: Id;
      readonly error: Schema.SchemaError;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly raw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    };

export type OpcuaAnyValueSample =
  | OpcuaValueSample<unknown, string>
  | OpcuaValueSample<OpcuaDynamicValue, string>;

export type OpcuaWriteResult<Id extends string = string> =
  | {
      readonly _tag: "Written";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
    };

export type OpcuaWriteValuesResult<Ids extends string> = {
  readonly [Id in Ids]: OpcuaWriteResult<Id>;
};

export type OpcuaValueMetadata = {
  readonly nodeId: NodeIdString;
  readonly dataType: string;
  readonly dataTypeNodeId: OpcuaNodeIdInfo;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly accessLevel: number;
  readonly userAccessLevel?: number;
  readonly access: {
    readonly readable: boolean;
    readonly writable: boolean;
    readonly userReadable: boolean;
    readonly userWritable: boolean;
  };
  readonly raw: {
    readonly dataType: DataType;
    readonly dataTypeNodeId: NodeId;
  };
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
type ValueSpec<
  Id extends string = string,
  S extends AnySchema | undefined = AnySchema | undefined,
> = {
  readonly nodeId: Id;
  readonly schema?: S;
  readonly includeRaw?: boolean;
};
type ValueOfSpec<Spec> = Spec extends { readonly schema: infer S }
  ? S extends AnySchema
    ? SchemaType<S>
    : OpcuaDynamicValue
  : OpcuaDynamicValue;
type ReadValuesResult<Specs extends ReadonlyArray<ValueSpec>> = {
  readonly [Index in keyof Specs]: Specs[Index] extends ValueSpec<
    infer Id,
    AnySchema | undefined
  >
    ? OpcuaValueSample<ValueOfSpec<Specs[Index]>, Id>
    : never;
};
type HasCapability<
  Caps extends CapabilitySet,
  Cap extends Capability,
> = Cap extends Caps[number] ? unknown : never;
type ReadCapabilityPart<A, Caps extends CapabilitySet, Id extends string> =
  HasCapability<Caps, "read"> extends never
    ? Record<never, never>
    : {
        readonly read: () => Effect.Effect<
          OpcuaValueSample<A, Id>,
          OpcuaServiceError
        >;
      };
type WriteCapabilityPart<A, Caps extends CapabilitySet, Id extends string> =
  HasCapability<Caps, "write"> extends never
    ? Record<never, never>
    : {
        readonly write: (
          value: A,
        ) => Effect.Effect<
          OpcuaWriteResult<Id>,
          OpcuaEncodeError | OpcuaServiceError | OpcuaAccessDeniedError
        >;
      };

export type OpcuaValueHandle<
  A = OpcuaDynamicValue,
  Caps extends CapabilitySet = typeof Capabilities.read,
  Id extends string = string,
> = {
  readonly nodeId: Id;
  readonly schema?: Schema.Schema<A>;
  readonly metadata: OpcuaValueMetadata;
  readonly capabilities: Caps;
  readonly raw: {
    readonly nodeId: NodeId;
    readonly dataType: DataType;
  };
} & ReadCapabilityPart<A, Caps, Id> &
  WriteCapabilityPart<A, Caps, Id>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WritableOpcuaValueHandle<A = any, Id extends string = string> =
  | OpcuaValueHandle<A, typeof Capabilities.write, Id>
  | OpcuaValueHandle<A, typeof Capabilities.readWrite, Id>;

type ValueOfHandle<H> =
  H extends OpcuaValueHandle<infer A, CapabilitySet, string> ? A : never;
type NodeIdOfHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends OpcuaValueHandle<any, CapabilitySet, infer Id> ? Id : never;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WriteEntry<H extends WritableOpcuaValueHandle<any, string>> = {
  readonly handle: H;
  readonly value: ValueOfHandle<H>;
};

export type MonitorValueSpec<
  Id extends string = string,
  S extends AnySchema | undefined = AnySchema | undefined,
> = {
  readonly nodeId: Id;
  readonly schema?: S;
  readonly includeRaw?: boolean;
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

export type OpcuaMonitorItemOptions = {
  readonly samplingInterval: number;
  readonly filter?: MonitorValueFilter;
};

export type OpcuaMonitoredItemState = {
  readonly nodeId: NodeIdString;
  readonly options: OpcuaMonitorItemOptions;
};

export type OpcuaMonitorAddResult<Id extends string = string> =
  | { readonly _tag: "Monitoring"; readonly nodeId: Id }
  | { readonly _tag: "AlreadyMonitoring"; readonly nodeId: Id }
  | {
      readonly _tag: "AlreadyMonitoringWithDifferentOptions";
      readonly nodeId: Id;
      readonly current: OpcuaMonitorItemOptions;
      readonly requested: OpcuaMonitorItemOptions;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
      readonly cause?: unknown;
    };

export type OpcuaMonitorRemoveResult<Id extends string = string> =
  | { readonly _tag: "Removed"; readonly nodeId: Id }
  | { readonly _tag: "NotMonitoring"; readonly nodeId: Id };

export type OpcuaMonitorItemEvent =
  | OpcuaMonitorAddResult
  | OpcuaMonitorRemoveResult
  | {
      readonly _tag: "Terminated";
      readonly nodeId: NodeIdString;
      readonly cause?: unknown;
    };

export type OpcuaValueMonitor = {
  readonly add: <const Specs extends ReadonlyArray<MonitorValueSpec>>(
    specs: Specs,
  ) => Effect.Effect<
    ReadonlyArray<
      Specs[number] extends MonitorValueSpec<infer Id>
        ? OpcuaMonitorAddResult<Id>
        : never
    >,
    OpcuaConfigurationError | OpcuaServiceError
  >;
  readonly remove: <const Ids extends ReadonlyArray<NodeIdString>>(
    nodeIds: Ids,
  ) => Effect.Effect<
    ReadonlyArray<
      Ids[number] extends infer Id extends string
        ? OpcuaMonitorRemoveResult<Id>
        : never
    >,
    never
  >;
  readonly items: Effect.Effect<ReadonlyMap<string, OpcuaMonitoredItemState>>;
  readonly itemState: Stream.Stream<
    ReadonlyMap<string, OpcuaMonitoredItemState>
  >;
  readonly itemEvents: Stream.Stream<OpcuaMonitorItemEvent>;
  readonly samples: Stream.Stream<OpcuaAnyValueSample>;
};

export type OpcuaSubscription = {
  readonly monitorValues: <const Specs extends ReadonlyArray<MonitorValueSpec>>(
    specs: Specs,
    options: MonitorValuesOptions,
  ) => Stream.Stream<
    Specs[number] extends MonitorValueSpec<infer Id>
      ? OpcuaValueSample<ValueOfSpec<Specs[number]>, Id>
      : never,
    OpcuaMonitorCreateError | OpcuaConfigurationError
  >;
  readonly valueMonitor: (
    options: MonitorValuesOptions,
  ) => Effect.Effect<OpcuaValueMonitor, OpcuaConfigurationError, Scope.Scope>;
  readonly events: Stream.Stream<OpcuaSubscriptionEvent>;
  readonly raw: ClientSubscription;
};

export type OpcuaClient = {
  readonly events: Stream.Stream<OpcuaClientEvent>;
  readonly raw: OPCUAClient;
};

export type OpcuaClientLayerOptions = {
  readonly endpointUrl: string;
  readonly clientOptions?: OPCUAClientOptions;
};

export type OpcuaClientLayerConfig = {
  readonly endpointUrl: Config.Config<string>;
  readonly clientOptions?:
    | OPCUAClientOptions
    | Config.Config<OPCUAClientOptions>;
};

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
  readonly writeValues: <
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

export const OpcuaClient = Object.assign(
  Context.Service<OpcuaClient>("@effect-opcua/client/OpcuaClient"),
  {
    layer: (options: OpcuaClientLayerOptions) =>
      Layer.effect(OpcuaClient, makeOpcuaClient(options)),
    layerConfig: (options: OpcuaClientLayerConfig) =>
      Layer.effect(
        OpcuaClient,
        Effect.gen(function* () {
          const endpointUrl = yield* options.endpointUrl;
          const clientOptions =
            options.clientOptions === undefined
              ? undefined
              : Config.isConfig(options.clientOptions)
                ? yield* options.clientOptions
                : options.clientOptions;

          return yield* makeOpcuaClient({ endpointUrl, clientOptions });
        }),
      ),
  },
);

const makeOpcuaClient = (options: OpcuaClientLayerOptions) =>
  Effect.gen(function* () {
    const events = yield* PubSub.sliding<OpcuaClientEvent>(EVENT_BUFFER_SIZE);
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
  });

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

  const writeValues: OpcuaSession["writeValues"] = (writes) =>
    Effect.gen(function* () {
      const nodeIds = writes.map((write) => write.handle.nodeId);
      const duplicate = duplicateStringError("writeValues", nodeIds);
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
          }).pipe(Effect.ignore),
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
      });

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
    createSubscription,
    browse,
    browseNext,
    releaseBrowseContinuation,
    browseChildren,
    events: Stream.fromPubSub(events),
    raw,
  };
};

const makeSubscription = (
  raw: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
): OpcuaSubscription => {
  const finalizingMonitorGroups = new WeakSet<ClientMonitoredItemGroup>();

  const monitorValues = (<const Specs extends ReadonlyArray<MonitorValueSpec>>(
    specs: Specs,
    options: MonitorValuesOptions,
  ) =>
    Stream.scoped(
      Stream.unwrap(
        Effect.gen(function* () {
          const duplicate = duplicateNodeIdError("monitorValues", specs);
          if (duplicate) return yield* Effect.fail(duplicate);
          const bufferError = bufferPolicyError(options.clientBuffer);
          if (bufferError) return yield* Effect.fail(bufferError);
          const queue = yield* makeQueue<
            OpcuaAnyValueSample,
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
              finalizingMonitorGroups,
            );
            wireMonitorGroup(
              raw,
              events,
              group,
              monitorGroup,
              queue,
              options,
              finalizingMonitorGroups,
            );
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
      ),
    ) as Stream.Stream<
      Specs[number] extends MonitorValueSpec<infer Id>
        ? OpcuaValueSample<ValueOfSpec<Specs[number]>, Id>
        : never,
      OpcuaMonitorCreateError | OpcuaConfigurationError
    >) as OpcuaSubscription["monitorValues"];

  const valueMonitor: OpcuaSubscription["valueMonitor"] = (options) =>
    Effect.gen(function* () {
      const bufferError = bufferPolicyError(options.clientBuffer);
      if (bufferError) return yield* Effect.fail(bufferError);
      const sampleQueue = yield* makeQueue<OpcuaAnyValueSample, never>(
        options.clientBuffer,
      );
      const itemEvents =
        yield* PubSub.sliding<OpcuaMonitorItemEvent>(EVENT_BUFFER_SIZE);
      const itemState =
        yield* PubSub.sliding<ReadonlyMap<string, OpcuaMonitoredItemState>>(
          EVENT_BUFFER_SIZE,
        );
      type ActiveItem = {
        readonly spec: MonitorValueSpec;
        readonly options: OpcuaMonitorItemOptions;
        readonly group: ClientMonitoredItemGroup;
      };
      const registry = yield* Ref.make(new Map<string, ActiveItem>());

      const publishState = Ref.get(registry).pipe(
        Effect.flatMap((map) =>
          PubSub.publish(
            itemState,
            new Map(
              Array.from(map, ([nodeId, item]) => [
                nodeId,
                { nodeId, options: item.options },
              ]),
            ),
          ),
        ),
      );

      const add: OpcuaValueMonitor["add"] = (specs) =>
        Effect.gen(function* () {
          const results: Array<OpcuaMonitorAddResult> = [];
          for (const spec of specs) {
            const effective = effectiveMonitorOptions(spec, options);
            const current = (yield* Ref.get(registry)).get(spec.nodeId);
            if (current) {
              const result = monitorOptionsEqual(current.options, effective)
                ? ({
                    _tag: "AlreadyMonitoring",
                    nodeId: spec.nodeId,
                  } as const)
                : ({
                    _tag: "AlreadyMonitoringWithDifferentOptions",
                    nodeId: spec.nodeId,
                    current: current.options,
                    requested: effective,
                  } as const);
              results.push(result);
              yield* PubSub.publish(itemEvents, result);
              continue;
            }

            const groupSpec: MonitorGroupSpec = {
              samplingInterval: effective.samplingInterval,
              filter: effective.filter,
              entries: [{ spec }],
            };
            const group = yield* Effect.tryPromise({
              try: () =>
                raw.monitorItems(
                  [
                    {
                      nodeId: coerceNodeId(spec.nodeId),
                      attributeId: AttributeIds.Value,
                    },
                  ],
                  {
                    samplingInterval: effective.samplingInterval,
                    filter: toNodeOpcuaDataChangeFilter(effective.filter),
                    queueSize: options.queueSize,
                    discardOldest: options.discardOldest,
                  },
                  TimestampsToReturn.Both,
                ),
              catch: (cause) =>
                new OpcuaServiceError({
                  operation: "valueMonitor.add",
                  nodeId: spec.nodeId,
                  cause,
                }),
            });
            const failure = monitorCreateFailures(group, groupSpec)[0];
            if (failure) {
              yield* terminateMonitorGroup(group);
              const result = {
                _tag: "NonGoodStatus",
                nodeId: spec.nodeId,
                status: normalizeStatusCode(
                  failure.statusCode ?? StatusCodes.Bad,
                ),
                cause: failure.cause,
              } as const;
              results.push(result);
              yield* PubSub.publish(itemEvents, result);
              continue;
            }
            group.on("changed", (_item, dataValue) => {
              offerMonitorSample(
                raw,
                events,
                sampleQueue,
                options.clientBuffer,
                sampleFromDataValue(spec, dataValue),
              );
            });
            group.on("terminated", (cause) => {
              Effect.runFork(
                Ref.update(registry, (map) => {
                  const next = new Map(map);
                  next.delete(spec.nodeId);
                  return next;
                }).pipe(
                  Effect.andThen(publishState),
                  Effect.andThen(
                    PubSub.publish(itemEvents, {
                      _tag: "Terminated",
                      nodeId: spec.nodeId,
                      cause,
                    }),
                  ),
                ),
              );
            });
            yield* Ref.update(registry, (map) => {
              const next = new Map(map);
              next.set(spec.nodeId, { spec, options: effective, group });
              return next;
            });
            const result = {
              _tag: "Monitoring",
              nodeId: spec.nodeId,
            } as const;
            results.push(result);
            yield* PubSub.publish(itemEvents, result);
            yield* publishState;
          }
          return results as never;
        });

      const remove: OpcuaValueMonitor["remove"] = (nodeIds) =>
        Effect.gen(function* () {
          const results: Array<OpcuaMonitorRemoveResult> = [];
          for (const nodeId of nodeIds) {
            const current = (yield* Ref.get(registry)).get(nodeId);
            if (!current) {
              const result = { _tag: "NotMonitoring", nodeId } as const;
              results.push(result);
              yield* PubSub.publish(itemEvents, result);
              continue;
            }
            yield* Ref.update(registry, (map) => {
              const next = new Map(map);
              next.delete(nodeId);
              return next;
            });
            yield* terminateMonitorGroup(current.group);
            const result = { _tag: "Removed", nodeId } as const;
            results.push(result);
            yield* PubSub.publish(itemEvents, result);
            yield* publishState;
          }
          return results as never;
        });

      yield* Effect.addFinalizer(() =>
        Ref.get(registry).pipe(
          Effect.flatMap((map) =>
            Effect.forEach(
              Array.from(map.values()),
              (item) => terminateMonitorGroup(item.group),
              { discard: true },
            ),
          ),
          Effect.andThen(Queue.shutdown(sampleQueue)),
          Effect.andThen(PubSub.shutdown(itemEvents)),
          Effect.andThen(PubSub.shutdown(itemState)),
          Effect.ignore,
        ),
      );

      return {
        add,
        remove,
        items: Ref.get(registry).pipe(
          Effect.map(
            (map) =>
              new Map(
                Array.from(map, ([nodeId, item]) => [
                  nodeId,
                  { nodeId, options: item.options },
                ]),
              ),
          ),
        ),
        itemState: Stream.fromPubSub(itemState),
        itemEvents: Stream.fromPubSub(itemEvents),
        samples: Stream.fromQueue(sampleQueue),
      };
    });

  return {
    monitorValues,
    valueMonitor,
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

const effectiveMonitorOptions = (
  spec: MonitorValueSpec,
  options: MonitorValuesOptions,
): OpcuaMonitorItemOptions => ({
  samplingInterval: spec.samplingInterval
    ? durationMillis(spec.samplingInterval)
    : durationMillis(options.samplingInterval),
  filter: spec.filter ?? options.filter,
});

const monitorOptionsEqual = (
  left: OpcuaMonitorItemOptions,
  right: OpcuaMonitorItemOptions,
) =>
  left.samplingInterval === right.samplingInterval &&
  monitorValueFilterKey(left.filter) === monitorValueFilterKey(right.filter);

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
  finalizingMonitorGroups: WeakSet<ClientMonitoredItemGroup>,
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
        yield* terminateMonitorGroup(group);
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
      Effect.sync(() => finalizingMonitorGroups.add(group)).pipe(
        Effect.andThen(terminateMonitorGroup(group)),
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
  queue: Queue.Queue<OpcuaAnyValueSample, OpcuaMonitorCreateError>,
  options: MonitorValuesOptions,
  finalizingMonitorGroups: WeakSet<ClientMonitoredItemGroup>,
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
    if (finalizingMonitorGroups.has(group)) return;
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

const offerMonitorSample = <E>(
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  queue: Queue.Queue<OpcuaAnyValueSample, E>,
  policy: ClientBufferPolicy,
  sample: OpcuaAnyValueSample,
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

const sampleFromDataValue = <
  Id extends string,
  S extends AnySchema | undefined,
>(
  spec: ValueSpec<Id, S>,
  dataValue: DataValue,
): OpcuaValueSample<ValueOfSpec<ValueSpec<Id, S>>, Id> => {
  const base = sampleBase(spec.nodeId, dataValue, spec.includeRaw ?? false);
  if (!isGood(dataValue.statusCode)) {
    return { _tag: "NonGoodStatus", ...base };
  }
  try {
    const value = spec.schema
      ? decodeWithSchema(spec.schema, dataValue.value?.value)
      : normalizeDynamicValue(dataValue.value?.value, dataValue.value);
    return {
      _tag: "Value",
      ...base,
      value: value as ValueOfSpec<ValueSpec<Id, S>>,
    };
  } catch (error) {
    return {
      _tag: "DecodeError",
      ...base,
      error: error as Schema.SchemaError,
    };
  }
};

const sampleBase = <Id extends string>(
  nodeId: Id,
  dataValue: DataValue,
  includeRaw: boolean,
) => ({
  nodeId,
  status: normalizeStatusCode(dataValue.statusCode),
  sourceTimestamp: normalizeTimestamp(dataValue.sourceTimestamp),
  serverTimestamp: normalizeTimestamp(dataValue.serverTimestamp),
  variant: dataValue.value ? normalizeVariantInfo(dataValue.value) : undefined,
  raw: includeRaw
    ? {
        dataValue,
        variant: dataValue.value,
      }
    : undefined,
});

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
    const dataTypeNodeId = dataTypeValue.value.value as NodeId;
    return {
      nodeId,
      dataType: DataType[builtInDataType] ?? String(builtInDataType),
      dataTypeNodeId: normalizeNodeId(dataTypeNodeId),
      valueRank: valueRankValue.value.value as number,
      arrayDimensions:
        arrayDimensionsValue &&
        isGood(arrayDimensionsValue.statusCode) &&
        Array.isArray(arrayDimensionsValue.value?.value)
          ? arrayDimensionsValue.value.value
          : undefined,
      accessLevel,
      userAccessLevel,
      access: {
        readable: hasAccess(accessLevel, "read"),
        writable: hasAccess(accessLevel, "write"),
        userReadable:
          userAccessLevel === undefined || hasAccess(userAccessLevel, "read"),
        userWritable:
          userAccessLevel === undefined || hasAccess(userAccessLevel, "write"),
      },
      raw: {
        dataType: builtInDataType,
        dataTypeNodeId,
      },
    };
  });

const writeByMetadata = (
  session: ClientSession,
  input: {
    readonly nodeId: NodeIdString;
    readonly schema?: AnySchema;
    readonly value: unknown;
    readonly metadata: OpcuaValueMetadata;
  },
) =>
  Effect.gen(function* () {
    const encoded = yield* encodeValue(input.nodeId, input.schema, input.value);
    const statusCode = yield* Effect.tryPromise({
      try: () =>
        session.write({
          nodeId: coerceNodeId(input.nodeId),
          attributeId: AttributeIds.Value,
          value: {
            value: makeVariant(input.metadata, encoded),
          },
        }),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "writeValue",
          nodeId: input.nodeId,
          cause,
        }),
    });
    return writeResult(input.nodeId, statusCode);
  });

const encodeValue = (
  nodeId: NodeIdString,
  schema: AnySchema | undefined,
  value: unknown,
) =>
  schema
    ? Effect.sync(() =>
        Schema.encodeUnknownSync(schema as Schema.Encoder<unknown>)(value),
      ).pipe(
        Effect.mapError(
          (error) => new OpcuaEncodeError({ nodeId, value, error }),
        ),
      )
    : Effect.sync(() => denormalizeDynamicValue(value));

const makeVariant = (metadata: OpcuaValueMetadata, value: unknown) =>
  new Variant({
    dataType: metadata.raw.dataType,
    arrayType:
      Array.isArray(value) || isArrayRank(metadata.valueRank)
        ? VariantArrayType.Array
        : VariantArrayType.Scalar,
    value: value as Variant["value"],
  });

const writeResult = <Id extends string>(
  nodeId: Id,
  statusCode: StatusCode,
): OpcuaWriteResult<Id> =>
  isGood(statusCode)
    ? { _tag: "Written", nodeId, status: normalizeStatusCode(statusCode) }
    : {
        _tag: "NonGoodStatus",
        nodeId,
        status: normalizeStatusCode(statusCode),
      };

const accessDeniedError = (
  nodeId: NodeIdString,
  requestedCapability: Capability,
  accessLevel: number,
  userAccessLevel?: number,
) => {
  const hasNodeAccess = hasAccess(accessLevel, requestedCapability);
  const hasUserAccess =
    userAccessLevel === undefined ||
    hasAccess(userAccessLevel, requestedCapability);
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

const hasAccess = (accessLevel: number, capability: Capability) => {
  const flag =
    capability === "read"
      ? AccessLevelFlag.CurrentRead
      : AccessLevelFlag.CurrentWrite;
  return (accessLevel & flag) !== 0;
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

const browseOptionsError = (input: OpcuaBrowseOptions) => {
  if (input.nodeId.trim() === "") {
    return new OpcuaConfigurationError({
      operation: "browse",
      nodeId: input.nodeId,
      cause: "nodeId must not be empty",
    });
  }
  if (
    input.maxReferencesPerNode !== undefined &&
    (!Number.isInteger(input.maxReferencesPerNode) ||
      input.maxReferencesPerNode < 0)
  ) {
    return new OpcuaConfigurationError({
      operation: "browse",
      nodeId: input.nodeId,
      cause: "maxReferencesPerNode must be a non-negative integer",
    });
  }
  return undefined;
};

const browseContinuationError = (
  operation: string,
  continuation: OpcuaBrowseContinuation,
) => {
  if (continuation.nodeId.trim() === "") {
    return new OpcuaConfigurationError({
      operation,
      nodeId: continuation.nodeId,
      cause: "nodeId must not be empty",
    });
  }
  if (continuation.raw.length === 0) {
    return new OpcuaConfigurationError({
      operation,
      nodeId: continuation.nodeId,
      cause: "continuation raw buffer must not be empty",
    });
  }
  return undefined;
};

const browseWithMaxReferences = async (
  session: ClientSession,
  nodeToBrowse: BrowseDescriptionOptions,
  maxReferencesPerNode: number,
): Promise<BrowseResult> => {
  const previousMaxReferencesPerNode = session.requestedMaxReferencesPerNode;
  session.requestedMaxReferencesPerNode = maxReferencesPerNode;
  try {
    return await session.browse(nodeToBrowse);
  } finally {
    session.requestedMaxReferencesPerNode = previousMaxReferencesPerNode;
  }
};

const normalizeBrowseResultOrFail = (
  operation: string,
  nodeId: NodeIdString,
  result: BrowseResult,
  includeRaw: boolean,
): Effect.Effect<OpcuaBrowseResult, OpcuaNonGoodStatusError> => {
  if (!isGood(result.statusCode)) {
    return Effect.fail(
      new OpcuaNonGoodStatusError({
        operation,
        nodeId,
        statusCode: result.statusCode,
      }),
    );
  }

  return Effect.succeed(normalizeBrowseResult(nodeId, result, includeRaw));
};

const normalizeBrowseResult = (
  nodeId: NodeIdString,
  result: BrowseResult,
  includeRaw: boolean,
): OpcuaBrowseResult => ({
  nodeId,
  status: normalizeStatusCode(result.statusCode),
  references:
    result.references?.map((reference) =>
      normalizeBrowseReference(reference, includeRaw),
    ) ?? [],
  continuation:
    result.continuationPoint && result.continuationPoint.length > 0
      ? { nodeId, raw: result.continuationPoint }
      : undefined,
  raw: includeRaw ? result : undefined,
});

const normalizeBrowseReference = (
  reference: ReferenceDescription,
  includeRaw: boolean,
): OpcuaBrowseReference => ({
  nodeId: normalizeExpandedNodeId(reference.nodeId),
  referenceTypeId: reference.referenceTypeId?.toString(),
  isForward: reference.isForward,
  nodeClass:
    typeof reference.nodeClass === "number"
      ? NodeClass[reference.nodeClass]
      : undefined,
  browseName: reference.browseName
    ? normalizeQualifiedName(reference.browseName)
    : undefined,
  displayName: reference.displayName
    ? normalizeLocalizedText(reference.displayName)
    : undefined,
  typeDefinition: reference.typeDefinition
    ? normalizeExpandedNodeId(reference.typeDefinition)
    : undefined,
  raw: includeRaw ? reference : undefined,
});

const normalizeNodeId = (nodeId: NodeId): OpcuaNodeIdInfo => ({
  text: nodeId.toString(),
  namespace: nodeId.namespace,
  value: nodeId.value,
  identifierType: String(nodeId.identifierType),
});

const normalizeExpandedNodeId = (
  nodeId: ExpandedNodeId,
): OpcuaExpandedNodeIdInfo => {
  const isRemote = Boolean(nodeId.namespaceUri) || Boolean(nodeId.serverIndex);
  return {
    text: nodeId.toString(),
    namespace: nodeId.namespace,
    value: nodeId.value,
    identifierType: String(nodeId.identifierType),
    namespaceUri: nodeId.namespaceUri ?? undefined,
    serverIndex: nodeId.serverIndex || undefined,
    isLocal: !isRemote,
    isRemote,
  };
};

const normalizeQualifiedName = (name: {
  readonly namespaceIndex?: number;
  readonly name?: string | null;
  readonly toString: () => string;
}): OpcuaQualifiedNameInfo => ({
  namespaceIndex: name.namespaceIndex ?? 0,
  name: name.name ?? "",
  text: name.toString(),
});

const normalizeLocalizedText = (text: {
  readonly text?: string | null;
  readonly locale?: string | null;
}): OpcuaLocalizedTextInfo => ({
  text: text.text ?? "",
  locale: text.locale ?? undefined,
});

const normalizeStatusCode = (statusCode: StatusCode): OpcuaStatusInfo => ({
  text: statusCode.toString(),
  code: statusCode.value,
  isGood: statusCode.isGood(),
  isUncertain: !statusCode.isGood() && !statusCode.isBad(),
  isBad: statusCode.isBad(),
});

const normalizeVariantInfo = (variant: Variant): OpcuaVariantInfo => ({
  dataType: DataType[variant.dataType] ?? String(variant.dataType),
  arrayType: VariantArrayType[variant.arrayType] as
    | "Scalar"
    | "Array"
    | "Matrix",
  arrayDimensions: variant.dimensions ?? undefined,
});

const normalizeDynamicValue = (
  value: unknown,
  variant?: Variant,
): OpcuaDynamicValue => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDynamicValue(item));
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      _tag: "ByteString",
      base64: Buffer.from(value).toString("base64"),
    };
  }
  if (value instanceof Date) {
    return { _tag: "DateTime", iso: value.toISOString() };
  }
  if (value instanceof NodeId) {
    return { _tag: "NodeId", ...normalizeNodeId(value) };
  }
  if (typeof value === "bigint") {
    return variant?.dataType === DataType.UInt64
      ? { _tag: "UInt64", text: value.toString() }
      : { _tag: "Int64", text: value.toString() };
  }
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    if (variant?.dataType === DataType.Int64) {
      return { _tag: "Int64", text: String(value) };
    }
    if (variant?.dataType === DataType.UInt64) {
      return { _tag: "UInt64", text: String(value) };
    }
    return value;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("text" in record && !("name" in record)) {
      return {
        _tag: "LocalizedText",
        text: String(record.text ?? ""),
        locale: typeof record.locale === "string" ? record.locale : undefined,
      };
    }
    if ("name" in record && "namespaceIndex" in record) {
      return {
        _tag: "QualifiedName",
        namespaceIndex:
          typeof record.namespaceIndex === "number" ? record.namespaceIndex : 0,
        name: String(record.name ?? ""),
        text:
          typeof record.toString === "function"
            ? String(record.toString())
            : `${String(record.namespaceIndex ?? 0)}:${String(record.name ?? "")}`,
      };
    }
    return {
      _tag: "ExtensionObject",
      typeName: value.constructor?.name,
      value: normalizePlainObject(record),
    };
  }
  return String(value);
};

const normalizePlainObject = (record: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, value]) => [key, normalizeDynamicValue(value)]),
  );

const denormalizeDynamicValue = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  const tagged = value as { readonly _tag?: string };
  switch (tagged._tag) {
    case "DateTime":
      return new Date((value as { readonly iso: string }).iso);
    case "ByteString":
      return Buffer.from(
        (value as { readonly base64: string }).base64,
        "base64",
      );
    case "Int64":
    case "UInt64":
      return (value as { readonly text: string }).text;
    default:
      return value;
  }
};

const normalizeTimestamp = (timestamp: Date | null | undefined) =>
  timestamp instanceof Date ? timestamp.toISOString() : undefined;
const durationMillis = (duration: Duration.Duration) =>
  Duration.toMillis(duration);
const isGood = (statusCode: StatusCode) => statusCode.isGood();
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
  BrowseResult,
  ClientMonitoredItemGroup,
  ClientSession,
  ClientSubscription,
  DataValue,
  ExpandedNodeId,
  NodeId,
  OPCUAClient,
  OPCUAClientOptions,
  ReferenceDescription,
  ReadValueIdOptions,
  StatusCode,
  UserIdentityInfo,
};
export {
  AccessLevelFlag,
  AttributeIds,
  BrowseDirection,
  DataType,
  NodeClass,
  NodeClassMask,
  ResultMask,
  StatusCodes,
  TimestampsToReturn,
  Variant,
  VariantArrayType,
  makeNodeClassMask,
  makeResultMask,
};
