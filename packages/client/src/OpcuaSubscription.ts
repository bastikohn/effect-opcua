import {
  AttributeIds,
  ClientSubscription,
  StatusCodes,
  type ClientMonitoredItemBase,
  type ClientMonitoredItemGroup,
  type DataValue,
  type StatusCode,
} from "node-opcua";
import { Duration, Effect, PubSub, Queue, Result, Scope, Stream } from "effect";

import { Codec } from "./internal/codecs.js";
import type { NodeIdString } from "./internal/capabilities.js";
import { chunksOf } from "./internal/collections.js";
import { EventBus, type OpcuaSubscriptionEvent } from "./internal/events.js";
import {
  applyMonitorOptions,
  makeQueue,
  normalizeMonitorItems,
  validateMonitorOptions,
  type EffectiveMonitorItem,
  type NormalizedCreateOptions,
} from "./internal/monitor-options.js";
import {
  decodeError,
  monitorCreateError,
  monitorRuntimeError,
  monitorStartupError,
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaDecodeError,
  OpcuaMonitorConfigurationError,
  OpcuaMonitorCreateError,
  OpcuaMonitorRuntimeError,
  OpcuaMonitorStartupError,
  OpcuaServiceError,
} from "./OpcuaError.js";
import {
  isGood,
  normalizeStatusCode,
  type OpcuaStatusInfo,
} from "./internal/normalize.js";
import type { OpcuaStructureRuntime } from "./internal/structure-runtime.js";
import {
  accessDeniedError,
  type ReadableVariableDef,
  type ValueOfVariableDef,
} from "./OpcuaVariable.js";

export type BufferPolicy =
  | { readonly _tag: "Sliding"; readonly capacity: number }
  | { readonly _tag: "Dropping"; readonly capacity: number };

export const BufferPolicy = {
  sliding: (capacity: number): BufferPolicy => ({
    _tag: "Sliding",
    capacity,
  }),
  dropping: (capacity: number): BufferPolicy => ({
    _tag: "Dropping",
    capacity,
  }),
  latest: (): BufferPolicy => ({ _tag: "Sliding", capacity: 1 }),
};

export type MonitorDeadband =
  | { readonly _tag: "None" }
  | { readonly _tag: "Absolute"; readonly value: number }
  | { readonly _tag: "Percent"; readonly value: number };

export const MonitorDeadband = {
  none: (): MonitorDeadband => ({ _tag: "None" }),
  absolute: (value: number): MonitorDeadband => ({
    _tag: "Absolute",
    value,
  }),
  percent: (value: number): MonitorDeadband => ({
    _tag: "Percent",
    value,
  }),
};

export type MonitorFilter =
  | { readonly _tag: "None" }
  | { readonly _tag: "Status" }
  | {
      readonly _tag: "StatusValue";
      readonly deadband: MonitorDeadband;
    }
  | {
      readonly _tag: "StatusValueTimestamp";
      readonly deadband: MonitorDeadband;
    };

export const MonitorFilter = {
  none: (): MonitorFilter => ({ _tag: "None" }),
  status: (): MonitorFilter => ({ _tag: "Status" }),
  statusValue: (
    deadband: MonitorDeadband = MonitorDeadband.none(),
  ): MonitorFilter => ({
    _tag: "StatusValue",
    deadband,
  }),
  statusValueTimestamp: (
    deadband: MonitorDeadband = MonitorDeadband.none(),
  ): MonitorFilter => ({
    _tag: "StatusValueTimestamp",
    deadband,
  }),
};

export type MonitorStartup = "strict" | "bestEffort";
export type MonitorValidation = "none" | "access" | "strict";
export type MonitorTimestamps = "none" | "source" | "server" | "both";

export type MonitorCreateOptions = {
  readonly maxItemsPerRequest?: number;
  readonly maxConcurrentRequests?: number;
};

export type MonitorItemOverride = Partial<{
  readonly samplingInterval: Duration.Duration;
  readonly queueSize: number;
  readonly discardOldest: boolean;
  readonly filter: MonitorFilter;
  readonly timestamps: MonitorTimestamps;
}>;

export type AnyVariableDefinition = ReadableVariableDef;
export type MonitorItemDictionary = Record<string, AnyVariableDefinition>;

export type MonitorOptions<Items = MonitorItemDictionary> = {
  readonly startup: MonitorStartup;
  readonly validation: MonitorValidation;

  readonly samplingInterval: Duration.Duration;
  readonly queueSize: number;
  readonly discardOldest: boolean;
  readonly filter: MonitorFilter;
  readonly timestamps: MonitorTimestamps;

  readonly clientBuffer: BufferPolicy;

  readonly overrides?: {
    readonly [K in keyof Items]?: MonitorItemOverride;
  };

  readonly create?: MonitorCreateOptions;
};

export type EffectiveMonitorItemOptions = {
  readonly samplingInterval: number;
  readonly queueSize: number;
  readonly discardOldest: boolean;
  readonly filter: MonitorFilter;
  readonly timestamps: MonitorTimestamps;
};

export type RevisedMonitorItemOptions = {
  readonly samplingInterval?: number;
  readonly queueSize?: number;
};

export type MonitorStarted = {
  readonly key: string;
  readonly nodeId: string;
  readonly requested: EffectiveMonitorItemOptions;
  readonly revised?: RevisedMonitorItemOptions;
};

export type MonitorStartupFailure = {
  readonly key: string;
  readonly nodeId: string;
  readonly requested: EffectiveMonitorItemOptions;
  readonly error: OpcuaMonitorStartupError;
};

export type MonitorStartupReport<Items = MonitorItemDictionary> = {
  readonly ok: boolean;
  readonly requested: number;
  readonly activeCount: number;
  readonly failedCount: number;
  readonly active: ReadonlyMap<keyof Items & string, MonitorStarted>;
  readonly failed: ReadonlyMap<keyof Items & string, MonitorStartupFailure>;
};

export type MonitorValueForKey<
  Items,
  Key extends keyof Items & string,
> = Items[Key] extends ReadableVariableDef
  ? ValueOfVariableDef<Items[Key]>
  : never;

type MonitorNodeIdForKey<
  Items,
  Key extends keyof Items & string,
> = Items[Key] extends { readonly nodeId: infer Id extends string }
  ? Id
  : string;

type MonitorSampleBase<Items, Key extends keyof Items & string> = {
  readonly key: Key;
  readonly nodeId: MonitorNodeIdForKey<Items, Key>;
  readonly status: OpcuaStatusInfo;
  readonly sourceTimestamp?: Date;
  readonly serverTimestamp?: Date;
};

export type MonitorSample<Items = MonitorItemDictionary> = {
  readonly [Key in keyof Items & string]:
    | ({
        readonly _tag: "Value";
        readonly value: MonitorValueForKey<Items, Key>;
      } & MonitorSampleBase<Items, Key>)
    | ({
        readonly _tag: "Status";
      } & MonitorSampleBase<Items, Key>)
    | ({
        readonly _tag: "DecodeError";
        readonly error: OpcuaDecodeError;
        readonly rawValue: unknown;
      } & MonitorSampleBase<Items, Key>);
}[keyof Items & string];

export type ActiveMonitor<Items = MonitorItemDictionary> = {
  readonly startup: MonitorStartupReport<Items>;
  readonly samples: Stream.Stream<
    MonitorSample<Items>,
    OpcuaMonitorRuntimeError
  >;
};

export type OpcuaSubscription = {
  readonly monitor: <const Items extends MonitorItemDictionary>(
    items: Items,
    options: MonitorOptions<Items>,
  ) => Effect.Effect<
    ActiveMonitor<Items>,
    OpcuaMonitorCreateError<Items> | OpcuaMonitorConfigurationError,
    Scope.Scope
  >;
  readonly events: Stream.Stream<OpcuaSubscriptionEvent>;
  readonly unsafeRaw: ClientSubscription;
};

type ValidateVariable = <const Def extends ReadableVariableDef>(
  def: Def,
) => Effect.Effect<
  unknown,
  OpcuaAccessDeniedError | OpcuaConfigurationError | OpcuaServiceError
>;

type MonitorKey<Items> = keyof Items & string;

type ValidationResult<Items> = {
  readonly active: ReadonlyArray<EffectiveMonitorItem<Items>>;
  readonly failed: Map<MonitorKey<Items>, MonitorStartupFailure>;
};

type WireMonitorEntry<Items> = {
  readonly key: MonitorKey<Items>;
  readonly nodeId: NodeIdString;
  readonly def: ReadableVariableDef;
  readonly timestamps: MonitorTimestamps;
};

type RetainedMonitorGroup<Items> = {
  readonly group: ClientMonitoredItemGroup;
  readonly entries: ReadonlyArray<WireMonitorEntry<Items> | undefined>;
  readonly nodeIds: ReadonlyArray<NodeIdString>;
};

type RawMonitorNotification<Items> = {
  readonly entry: WireMonitorEntry<Items>;
  readonly dataValue: DataValue;
};

type CreatedChunk<Items> = {
  readonly retained?: RetainedMonitorGroup<Items>;
  readonly active: ReadonlyArray<readonly [MonitorKey<Items>, MonitorStarted]>;
  readonly failed: ReadonlyArray<
    readonly [MonitorKey<Items>, MonitorStartupFailure]
  >;
};

type MonitorGroupRegistry = {
  readonly add: (group: ClientMonitoredItemGroup) => void;
  readonly remove: (group: ClientMonitoredItemGroup) => void;
};

export const makeSubscription = (
  unsafeRaw: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  structureRuntime: OpcuaStructureRuntime,
  validateVariable: ValidateVariable,
): OpcuaSubscription => {
  const finalizingMonitorGroups = new WeakSet<ClientMonitoredItemGroup>();

  const monitor = Effect.fnUntraced(function* <
    const Items extends MonitorItemDictionary,
  >(
    items: Items,
    options: MonitorOptions<Items>,
  ): Effect.fn.Return<
    ActiveMonitor<Items>,
    OpcuaMonitorCreateError<Items> | OpcuaMonitorConfigurationError,
    Scope.Scope
  > {
    const normalized = yield* normalizeMonitorItems(items);
    const createOptions = yield* validateMonitorOptions(normalized, options);
    const effective = yield* applyMonitorOptions(normalized, options);
    const validation = yield* validateStartupItems(
      unsafeRaw,
      effective,
      options.validation,
      createOptions,
      validateVariable,
    );

    if (options.startup === "strict" && validation.failed.size > 0) {
      const report = makeStartupReport<Items>(
        normalized.length,
        new Map(),
        validation.failed,
      );
      return yield* Effect.fail(
        monitorCreateError<Items>({
          subscriptionId: unsafeRaw.subscriptionId,
          startup: report,
          cause: Array.from(validation.failed.values()),
        }),
      );
    }

    const notificationQueue = yield* makeQueue<
      RawMonitorNotification<Items>,
      OpcuaMonitorRuntimeError
    >(options.clientBuffer);
    const createdGroups: Array<ClientMonitoredItemGroup> = [];
    const retainedGroups: Array<RetainedMonitorGroup<Items>> = [];
    const teardowns: Array<() => void> = [];
    const groupRegistry: MonitorGroupRegistry = {
      add: (group) => {
        createdGroups.push(group);
      },
      remove: (group) => {
        removeCreatedMonitorGroup(createdGroups, group);
      },
    };

    yield* Effect.addFinalizer(() =>
      cleanupMonitor(
        createdGroups,
        teardowns,
        notificationQueue,
        finalizingMonitorGroups,
      ),
    );

    const created =
      validation.active.length > 0
        ? yield* createMonitorChunks(
            unsafeRaw,
            validation.active,
            createOptions,
            groupRegistry,
          )
        : [];
    const active = new Map<MonitorKey<Items>, MonitorStarted>();
    const failed = new Map(validation.failed);

    for (const chunk of created) {
      for (const [key, started] of chunk.active) active.set(key, started);
      for (const [key, failure] of chunk.failed) failed.set(key, failure);
      if (chunk.retained) retainedGroups.push(chunk.retained);
    }

    const report = makeStartupReport<Items>(normalized.length, active, failed);

    if (options.startup === "strict" && failed.size > 0) {
      yield* cleanupMonitor(
        createdGroups,
        teardowns,
        notificationQueue,
        finalizingMonitorGroups,
      );
      return yield* Effect.fail(
        monitorCreateError<Items>({
          subscriptionId: unsafeRaw.subscriptionId,
          startup: report,
          cause: Array.from(failed.values()),
        }),
      );
    }

    for (const retained of retainedGroups) {
      teardowns.push(
        wireMonitorGroup(
          unsafeRaw,
          events,
          retained.group,
          retained.entries,
          notificationQueue,
          options.clientBuffer,
          finalizingMonitorGroups,
        ),
      );
    }

    return {
      startup: report,
      samples: Stream.fromQueue(notificationQueue).pipe(
        Stream.mapEffect(
          ({ entry, dataValue }) =>
            monitorSampleFromDataValue(entry, dataValue, structureRuntime),
          { concurrency: 1 },
        ),
      ),
    };
  });

  return {
    monitor: monitor as OpcuaSubscription["monitor"],
    events: Stream.fromPubSub(events),
    unsafeRaw,
  };
};

const validateStartupItems = <Items>(
  subscription: ClientSubscription,
  items: ReadonlyArray<EffectiveMonitorItem<Items>>,
  validation: MonitorValidation,
  create: NormalizedCreateOptions,
  validateVariable: ValidateVariable,
): Effect.Effect<ValidationResult<Items>, never> => {
  switch (validation) {
    case "none":
      return Effect.succeed({ active: items, failed: new Map() });
    case "access":
      return validateAccess(subscription, items, create);
    case "strict":
      return validateStrict(items, validateVariable);
  }
};

const validateStrict = <Items>(
  items: ReadonlyArray<EffectiveMonitorItem<Items>>,
  validateVariable: ValidateVariable,
): Effect.Effect<ValidationResult<Items>, never> =>
  Effect.gen(function* () {
    const active: Array<EffectiveMonitorItem<Items>> = [];
    const failed = new Map<MonitorKey<Items>, MonitorStartupFailure>();
    for (const item of items) {
      const result = yield* Effect.result(validateVariable(item.def));
      if (Result.isFailure(result)) {
        failed.set(
          item.key,
          startupFailure(item, "Validation", result.failure),
        );
        continue;
      }
      active.push(item);
    }
    return { active, failed };
  });

const validateAccess = <Items>(
  subscription: ClientSubscription,
  items: ReadonlyArray<EffectiveMonitorItem<Items>>,
  create: NormalizedCreateOptions,
): Effect.Effect<ValidationResult<Items>, never> =>
  Effect.gen(function* () {
    const results = yield* Effect.forEach(
      chunksOf(items, create.maxItemsPerRequest),
      (chunk) => validateAccessChunk(subscription, chunk),
      {
        concurrency: create.maxConcurrentRequests,
      },
    );
    const active: Array<EffectiveMonitorItem<Items>> = [];
    const failed = new Map<MonitorKey<Items>, MonitorStartupFailure>();
    for (const result of results) {
      active.push(...result.active);
      for (const [key, failure] of result.failed) failed.set(key, failure);
    }
    return { active, failed };
  });

const validateAccessChunk = <Items>(
  subscription: ClientSubscription,
  chunk: ReadonlyArray<EffectiveMonitorItem<Items>>,
): Effect.Effect<ValidationResult<Items>, never> =>
  Effect.gen(function* () {
    const nodes = chunk.flatMap((item) => [
      { nodeId: item.rawNodeId, attributeId: AttributeIds.AccessLevel },
      { nodeId: item.rawNodeId, attributeId: AttributeIds.UserAccessLevel },
    ]);
    const readResult = yield* Effect.result(
      Effect.tryPromise({
        try: () => subscription.session.read(nodes, 0),
        catch: (cause) => cause,
      }),
    );
    if (Result.isFailure(readResult)) {
      return {
        active: [],
        failed: new Map(
          chunk.map((item) => [
            item.key,
            startupFailure(item, "Validation", readResult.failure),
          ]),
        ),
      };
    }

    const values = Array.isArray(readResult.success)
      ? readResult.success
      : [readResult.success];
    const active: Array<EffectiveMonitorItem<Items>> = [];
    const failed = new Map<MonitorKey<Items>, MonitorStartupFailure>();
    for (let index = 0; index < chunk.length; index++) {
      const item = chunk[index]!;
      const accessLevelValue = values[index * 2];
      const userAccessLevelValue = values[index * 2 + 1];
      if (
        !accessLevelValue ||
        !isGood(accessLevelValue.statusCode) ||
        typeof accessLevelValue.value?.value !== "number"
      ) {
        failed.set(
          item.key,
          startupFailure(
            item,
            "Validation",
            "AccessLevel is unreadable",
            accessLevelValue?.statusCode,
          ),
        );
        continue;
      }
      const userAccessLevel =
        userAccessLevelValue &&
        isGood(userAccessLevelValue.statusCode) &&
        typeof userAccessLevelValue.value?.value === "number"
          ? (userAccessLevelValue.value.value as number)
          : undefined;
      const error = accessDeniedError(
        item.nodeId,
        "read",
        accessLevelValue.value.value as number,
        userAccessLevel,
      );
      if (error) {
        failed.set(item.key, startupFailure(item, "Validation", error));
        continue;
      }
      active.push(item);
    }
    return { active, failed };
  });

const createMonitorChunks = <Items>(
  subscription: ClientSubscription,
  items: ReadonlyArray<EffectiveMonitorItem<Items>>,
  create: NormalizedCreateOptions,
  groupRegistry: MonitorGroupRegistry,
): Effect.Effect<ReadonlyArray<CreatedChunk<Items>>, never> => {
  const chunks = Array.from(groupCompatibleItems(items).values()).flatMap(
    (group) => chunksOf(group, create.maxItemsPerRequest),
  );
  return Effect.forEach(
    chunks,
    (chunk) => createMonitorChunk(subscription, chunk, groupRegistry),
    {
      concurrency: create.maxConcurrentRequests,
    },
  );
};

const createMonitorChunk = <Items>(
  subscription: ClientSubscription,
  chunk: ReadonlyArray<EffectiveMonitorItem<Items>>,
  groupRegistry: MonitorGroupRegistry,
): Effect.Effect<CreatedChunk<Items>, never> =>
  Effect.gen(function* () {
    const groupResult = yield* Effect.result(monitorItems(subscription, chunk));
    if (Result.isFailure(groupResult)) {
      return {
        active: [],
        failed: chunk.map((item) => [
          item.key,
          startupFailure(item, "Create", groupResult.failure),
        ]),
      };
    }

    const { group, disposeAbort } = groupResult.success;
    groupRegistry.add(group);
    disposeAbort();
    const active: Array<readonly [MonitorKey<Items>, MonitorStarted]> = [];
    const failed: Array<readonly [MonitorKey<Items>, MonitorStartupFailure]> =
      [];
    const entries: Array<WireMonitorEntry<Items> | undefined> = [];
    const retainedNodeIds: Array<NodeIdString> = [];

    for (let index = 0; index < chunk.length; index++) {
      const item = chunk[index]!;
      const monitoredItem = group.monitoredItems[index];
      const statusCode = monitoredItem?.statusCode ?? StatusCodes.Bad;
      if (!isGood(statusCode)) {
        failed.push([
          item.key,
          startupFailure(item, "Create", monitoredItem?.result, statusCode),
        ]);
        entries.push(undefined);
        continue;
      }
      active.push([
        item.key,
        {
          key: item.key,
          nodeId: item.nodeId,
          requested: item.requested,
          revised: revisedMonitorItemOptions(monitoredItem),
        },
      ]);
      entries.push({
        key: item.key,
        nodeId: item.nodeId,
        def: item.def,
        timestamps: item.requested.timestamps,
      });
      retainedNodeIds.push(item.nodeId);
    }

    if (retainedNodeIds.length === 0) {
      yield* terminateCreatedMonitorGroup(group, groupRegistry);
      return { active, failed };
    }
    return {
      active,
      failed,
      retained: {
        group,
        entries,
        nodeIds: retainedNodeIds,
      },
    };
  });

const monitorItems = <Items>(
  subscription: ClientSubscription,
  chunk: ReadonlyArray<EffectiveMonitorItem<Items>>,
) => {
  const first = chunk[0]!;
  return Effect.tryPromise({
    try: (signal) =>
      subscription
        .monitorItems(
          chunk.map((item) => ({
            nodeId: item.rawNodeId,
            attributeId: AttributeIds.Value,
          })),
          {
            samplingInterval: first.requested.samplingInterval,
            queueSize: first.requested.queueSize,
            discardOldest: first.requested.discardOldest,
            filter: first.nodeOpcuaFilter,
          },
          first.timestampsToReturn,
        )
        .then((group) => monitorItemsSuccess(group, signal)),
    catch: (cause) => cause,
  });
};

const monitorItemsSuccess = (
  group: ClientMonitoredItemGroup,
  signal: AbortSignal,
) => {
  if (signal.aborted) {
    terminateMonitorGroupUnsafe(group);
    return { group, disposeAbort: () => undefined };
  }
  const abort = () => terminateMonitorGroupUnsafe(group);
  signal.addEventListener("abort", abort, { once: true });
  return {
    group,
    disposeAbort: () => {
      signal.removeEventListener("abort", abort);
    },
  };
};

const wireMonitorGroup = <Items>(
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  group: ClientMonitoredItemGroup,
  entries: ReadonlyArray<WireMonitorEntry<Items> | undefined>,
  queue: Queue.Queue<RawMonitorNotification<Items>, OpcuaMonitorRuntimeError>,
  policy: BufferPolicy,
  finalizingMonitorGroups: WeakSet<ClientMonitoredItemGroup>,
) => {
  const nodeIds = entries.flatMap((entry) => (entry ? [entry.nodeId] : []));
  const failRuntime = (cause: unknown) => {
    if (finalizingMonitorGroups.has(group)) return;
    const error = monitorRuntimeError({
      subscriptionId: subscription.subscriptionId,
      nodeIds,
      cause,
    });
    EventBus.publishUnsafe(events, {
      _tag: "InternalError",
      subscriptionId: subscription.subscriptionId,
      cause,
    });
    Effect.runSync(Queue.fail(queue, error));
  };
  const onChanged = (
    _item: ClientMonitoredItemBase,
    dataValue: DataValue,
    index: number,
  ) => {
    const entry = entries[index];
    if (!entry) return;
    offerMonitorNotification(subscription, events, queue, policy, {
      entry,
      dataValue,
    });
  };
  const onError = (message: unknown) => {
    failRuntime(message);
  };
  const onTerminatedGroup = (cause: unknown) => {
    if (finalizingMonitorGroups.has(group)) return;
    EventBus.publishUnsafe(events, {
      _tag: "MonitorItemsTerminated",
      subscriptionId: subscription.subscriptionId,
      nodeIds,
    });
    failRuntime(cause);
  };
  group.on("changed", onChanged);
  group.on("err", onError);
  group.on("terminated", onTerminatedGroup);
  EventBus.publishUnsafe(events, {
    _tag: "MonitorItemsCreated",
    subscriptionId: subscription.subscriptionId,
    nodeIds,
  });
  return () => {
    group.removeListener("changed", onChanged);
    group.removeListener("err", onError);
    group.removeListener("terminated", onTerminatedGroup);
  };
};

const monitorSampleFromDataValue = <Items>(
  entry: WireMonitorEntry<Items>,
  dataValue: DataValue,
  structureRuntime: OpcuaStructureRuntime,
): Effect.Effect<MonitorSample<Items>> =>
  Effect.gen(function* () {
    const base = monitorSampleBase(entry, dataValue);
    if (!isGood(dataValue.statusCode)) {
      return { _tag: "Status", ...base } as MonitorSample<Items>;
    }
    const decoded = yield* Effect.result(
      Codec.decode(
        entry.def.codec,
        dataValue.value,
        dataValue,
        structureRuntime,
      ),
    );
    if (Result.isFailure(decoded)) {
      return {
        _tag: "DecodeError",
        ...base,
        error: decodeError({
          nodeId: entry.nodeId,
          cause: decoded.failure,
        }),
        rawValue: dataValue.value?.value,
      } as MonitorSample<Items>;
    }
    return {
      _tag: "Value",
      ...base,
      value: decoded.success,
    } as MonitorSample<Items>;
  });

const monitorSampleBase = <Items>(
  entry: WireMonitorEntry<Items>,
  dataValue: DataValue,
) => ({
  key: entry.key,
  nodeId: entry.nodeId,
  status: normalizeStatusCode(dataValue.statusCode),
  sourceTimestamp:
    entry.timestamps === "source" || entry.timestamps === "both"
      ? dateTimestamp(dataValue.sourceTimestamp)
      : undefined,
  serverTimestamp:
    entry.timestamps === "server" || entry.timestamps === "both"
      ? dateTimestamp(dataValue.serverTimestamp)
      : undefined,
});

const offerMonitorNotification = <Items>(
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  queue: Queue.Queue<RawMonitorNotification<Items>, OpcuaMonitorRuntimeError>,
  policy: BufferPolicy,
  notification: RawMonitorNotification<Items>,
) => {
  const willDrop =
    policy._tag === "Sliding" && Queue.sizeUnsafe(queue) >= policy.capacity;
  const offered = Queue.offerUnsafe(queue, notification);
  if (willDrop || !offered) {
    EventBus.publishUnsafe(events, {
      _tag: "ClientBufferDropped",
      subscriptionId: subscription.subscriptionId,
      nodeId: notification.entry.nodeId,
    });
  }
};

const cleanupMonitor = <Items>(
  createdGroups: Array<ClientMonitoredItemGroup>,
  teardowns: Array<() => void>,
  queue: Queue.Queue<RawMonitorNotification<Items>, OpcuaMonitorRuntimeError>,
  finalizingMonitorGroups: WeakSet<ClientMonitoredItemGroup>,
) =>
  Effect.gen(function* () {
    const listeners = teardowns.splice(0);
    for (const teardown of listeners) yield* Effect.sync(teardown);
    const groups = createdGroups.splice(0);
    for (const group of groups) {
      yield* Effect.sync(() => {
        finalizingMonitorGroups.add(group);
      });
      yield* terminateMonitorGroup(group);
    }
    yield* Queue.shutdown(queue);
  }).pipe(Effect.ignore);

const groupCompatibleItems = <Items>(
  items: ReadonlyArray<EffectiveMonitorItem<Items>>,
) => {
  const groups = new Map<string, Array<EffectiveMonitorItem<Items>>>();
  for (const item of items) {
    const group = groups.get(item.compatibilityKey);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.compatibilityKey, [item]);
    }
  }
  return groups;
};

const startupFailure = <Items>(
  item: EffectiveMonitorItem<Items>,
  phase: "Validation" | "Create",
  cause: unknown,
  statusCode?: StatusCode,
): MonitorStartupFailure => ({
  key: item.key,
  nodeId: item.nodeId,
  requested: item.requested,
  error: monitorStartupError({
    phase,
    key: item.key,
    nodeId: item.nodeId,
    statusCode,
    status: statusCode ? normalizeStatusCode(statusCode) : undefined,
    cause,
  }),
});

const makeStartupReport = <Items>(
  requested: number,
  active: ReadonlyMap<MonitorKey<Items>, MonitorStarted>,
  failed: ReadonlyMap<MonitorKey<Items>, MonitorStartupFailure>,
): MonitorStartupReport<Items> => ({
  ok: failed.size === 0,
  requested,
  activeCount: active.size,
  failedCount: failed.size,
  active,
  failed,
});

const terminateMonitorGroup = (group: ClientMonitoredItemGroup) =>
  Effect.tryPromise({
    try: () => group.terminate(),
    catch: (cause) => cause,
  }).pipe(Effect.ignore);

const terminateCreatedMonitorGroup = (
  group: ClientMonitoredItemGroup,
  registry: MonitorGroupRegistry,
) =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      yield* terminateMonitorGroup(group);
      yield* Effect.sync(() => registry.remove(group));
    }),
  );

const terminateMonitorGroupUnsafe = (group: ClientMonitoredItemGroup) => {
  void group.terminate().catch(() => undefined);
};

const removeCreatedMonitorGroup = (
  groups: Array<ClientMonitoredItemGroup>,
  group: ClientMonitoredItemGroup,
) => {
  const index = groups.indexOf(group);
  if (index >= 0) groups.splice(index, 1);
};

const revisedMonitorItemOptions = (
  monitoredItem: ClientMonitoredItemBase | undefined,
): RevisedMonitorItemOptions | undefined => {
  const result = monitoredItem?.result as
    | {
        readonly revisedSamplingInterval?: number;
        readonly revisedQueueSize?: number;
      }
    | undefined;
  if (!result) return undefined;
  const revised: RevisedMonitorItemOptions = {
    samplingInterval:
      typeof result.revisedSamplingInterval === "number"
        ? result.revisedSamplingInterval
        : undefined,
    queueSize:
      typeof result.revisedQueueSize === "number"
        ? result.revisedQueueSize
        : undefined,
  };
  return revised.samplingInterval === undefined &&
    revised.queueSize === undefined
    ? undefined
    : revised;
};

const dateTimestamp = (timestamp: Date | null | undefined) =>
  timestamp instanceof Date ? timestamp : undefined;
