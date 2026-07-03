import {
  AttributeIds,
  type ClientMonitoredItemBase,
  type ClientMonitoredItemGroup,
  type ClientSubscription,
  type DataValue,
  type StatusCode,
} from "node-opcua";
import { Effect, PubSub, Queue, Result, Scope, Stream } from "effect";

import * as OpcuaError from "../../OpcuaError.js";
import type * as OpcuaVariable from "../../OpcuaVariable.js";
import type {
  ActiveMonitor,
  BufferPolicy,
  MonitorItemDictionary,
  MonitorOptions,
  MonitorStartupFailure,
  MonitorStartupReport,
  MonitorStarted,
  MonitorValidation,
  OpcuaSubscription,
} from "../../OpcuaSubscription.js";
import { chunksOf } from "../common/collections.js";
import type { NodeIdString } from "../common/node-id.js";
import type { OpcuaSubscriptionEvent } from "../events/model.js";
import { EventBus } from "../events/wire.js";
import type { OpcuaStructureRuntime } from "../structures/runtime.js";
import { isGood, normalizeStatusCode } from "../values/normalize.js";
import * as VariableOperations from "../variable/operations.js";
import {
  applyMonitorOptions,
  normalizeMonitorItems,
  validateMonitorOptions,
  type EffectiveMonitorItem,
  type NormalizedCreateOptions,
} from "./options.js";
import {
  monitoredItemStatusCode,
  monitorItems,
  revisedMonitorItemOptions,
} from "./requests.js";
import {
  monitorSampleFromDataValue,
  type MonitorKey,
  type RawMonitorNotification,
  type WireMonitorEntry,
} from "./samples.js";

export type ValidateVariable = <
  const Def extends OpcuaVariable.ReadableVariableDef,
>(
  def: Def,
) => Effect.Effect<
  unknown,
  | OpcuaError.OpcuaAccessDeniedError
  | OpcuaError.OpcuaConfigurationError
  | OpcuaError.OpcuaServiceError
>;

type ValidationResult<Items> = {
  readonly active: ReadonlyArray<EffectiveMonitorItem<Items>>;
  readonly failed: Map<MonitorKey<Items>, MonitorStartupFailure>;
};

type RetainedMonitorGroup<Items> = {
  readonly group: ClientMonitoredItemGroup;
  readonly entries: ReadonlyArray<WireMonitorEntry<Items> | undefined>;
  readonly nodeIds: ReadonlyArray<NodeIdString>;
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

export const makeSubscriptionService = (
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
    | OpcuaError.OpcuaMonitorCreateError<Items>
    | OpcuaError.OpcuaMonitorConfigurationError,
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
        OpcuaError.monitorCreateError<Items>({
          subscriptionId: unsafeRaw.subscriptionId,
          startup: report,
          cause: Array.from(validation.failed.values()),
        }),
      );
    }

    const notificationQueue = yield* makeMonitorQueue<
      RawMonitorNotification<Items>,
      OpcuaError.OpcuaMonitorRuntimeError
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
        OpcuaError.monitorCreateError<Items>({
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
      const error = VariableOperations.accessDeniedError(
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
      const statusCode = monitoredItemStatusCode(monitoredItem);
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

const wireMonitorGroup = <Items>(
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  group: ClientMonitoredItemGroup,
  entries: ReadonlyArray<WireMonitorEntry<Items> | undefined>,
  queue: Queue.Queue<
    RawMonitorNotification<Items>,
    OpcuaError.OpcuaMonitorRuntimeError
  >,
  policy: BufferPolicy,
  finalizingMonitorGroups: WeakSet<ClientMonitoredItemGroup>,
) => {
  const nodeIds = entries.flatMap((entry) => (entry ? [entry.nodeId] : []));
  const failRuntime = (cause: unknown) => {
    if (finalizingMonitorGroups.has(group)) return;
    const error = OpcuaError.monitorRuntimeError({
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

const offerMonitorNotification = <Items>(
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  queue: Queue.Queue<
    RawMonitorNotification<Items>,
    OpcuaError.OpcuaMonitorRuntimeError
  >,
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
  queue: Queue.Queue<
    RawMonitorNotification<Items>,
    OpcuaError.OpcuaMonitorRuntimeError
  >,
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

const makeMonitorQueue = <A, E>(policy: BufferPolicy) =>
  policy._tag === "Sliding"
    ? Queue.sliding<A, E>(policy.capacity)
    : Queue.dropping<A, E>(policy.capacity);

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
  error: OpcuaError.monitorStartupError({
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

const removeCreatedMonitorGroup = (
  groups: Array<ClientMonitoredItemGroup>,
  group: ClientMonitoredItemGroup,
) => {
  const index = groups.indexOf(group);
  if (index >= 0) groups.splice(index, 1);
};
