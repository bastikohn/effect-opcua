import {
  AttributeIds,
  ClientSubscription,
  DataChangeFilter,
  DataChangeTrigger,
  DeadbandType,
  StatusCodes,
  TimestampsToReturn,
  type ClientMonitoredItemGroup,
} from "node-opcua";
import {
  Duration,
  Effect,
  PubSub,
  Queue,
  Ref,
  Result,
  Scope,
  Semaphore,
  Stream,
} from "effect";

import { EVENT_BUFFER_SIZE } from "./constants.js";
import type { NodeIdString } from "./capabilities.js";
import { EventBus, type OpcuaSubscriptionEvent } from "./events.js";
import {
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaMonitorCreateError,
  OpcuaServiceError,
} from "./errors.js";
import {
  isGood,
  normalizeStatusCode,
  type OpcuaStatusInfo,
} from "./normalize.js";
import type { OpcuaStructureRuntime } from "./structure-runtime.js";
import {
  sampleFromDataValue,
  type AnyReadResult,
  type ReadResult,
  type ReadableVariableDef,
  type ValueOfVariableDef,
  type VariableHandle,
} from "./values.js";

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

export type MonitorOptions = {
  readonly samplingInterval: Duration.Duration;
  readonly queueSize: number;
  readonly discardOldest: boolean;
  readonly clientBuffer: BufferPolicy;
  readonly filter?: MonitorFilter;
};

export type MonitorDef<Def extends ReadableVariableDef = ReadableVariableDef> =
  Def & {
    readonly samplingInterval?: Duration.Duration;
    readonly filter?: MonitorFilter;
  };

export type MonitorItemOptions = {
  readonly samplingInterval: number;
  readonly filter?: MonitorFilter;
};

export type MonitoredItemState = {
  readonly nodeId: NodeIdString;
  readonly options: MonitorItemOptions;
};

export type MonitorAddResult<Id extends string = string> =
  | { readonly _tag: "Monitoring"; readonly nodeId: Id }
  | { readonly _tag: "AlreadyMonitoring"; readonly nodeId: Id }
  | {
      readonly _tag: "AlreadyMonitoringWithDifferentOptions";
      readonly nodeId: Id;
      readonly current: MonitorItemOptions;
      readonly requested: MonitorItemOptions;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "ConfigurationError";
      readonly nodeId: Id;
      readonly error: OpcuaConfigurationError;
    }
  | {
      readonly _tag: "AccessDenied";
      readonly nodeId: Id;
      readonly error: OpcuaAccessDeniedError;
    }
  | {
      readonly _tag: "ServiceError";
      readonly nodeId: Id;
      readonly error: OpcuaServiceError;
    };

export type MonitorRemoveResult<Id extends string = string> =
  | { readonly _tag: "Removed"; readonly nodeId: Id }
  | { readonly _tag: "NotMonitoring"; readonly nodeId: Id };

export type MonitorItemEvent =
  | MonitorAddResult
  | MonitorRemoveResult
  | {
      readonly _tag: "Terminated";
      readonly nodeId: NodeIdString;
      readonly cause?: unknown;
    };

export type MonitorSampleOf<Def> = Def extends ReadableVariableDef
  ? ReadResult<ValueOfVariableDef<Def>, Def["nodeId"]>
  : never;

export type ValueMonitor = {
  readonly add: <const Defs extends ReadonlyArray<MonitorDef>>(
    defs: Defs,
  ) => Effect.Effect<
    ReadonlyArray<
      Defs[number] extends MonitorDef<infer Def>
        ? MonitorAddResult<Def["nodeId"]>
        : never
    >,
    never
  >;
  readonly remove: <const Ids extends ReadonlyArray<NodeIdString>>(
    nodeIds: Ids,
  ) => Effect.Effect<
    ReadonlyArray<
      Ids[number] extends infer Id extends string
        ? MonitorRemoveResult<Id>
        : never
    >,
    never
  >;
  readonly items: Effect.Effect<ReadonlyMap<string, MonitoredItemState>>;
  readonly itemState: Stream.Stream<ReadonlyMap<string, MonitoredItemState>>;
  readonly itemEvents: Stream.Stream<MonitorItemEvent>;
  readonly samples: Stream.Stream<AnyReadResult>;
};

export type OpcuaSubscription = {
  readonly monitor: (
    options: MonitorOptions,
  ) => Effect.Effect<ValueMonitor, OpcuaConfigurationError, Scope.Scope>;
  readonly watch: <const Defs extends ReadonlyArray<MonitorDef>>(
    defs: Defs,
    options: MonitorOptions,
  ) => Stream.Stream<
    MonitorSampleOf<Defs[number]>,
    OpcuaMonitorCreateError | OpcuaConfigurationError
  >;
  readonly events: Stream.Stream<OpcuaSubscriptionEvent>;
  readonly unsafeRaw: ClientSubscription;
};

type HandleVariable = <const Def extends ReadableVariableDef>(
  def: Def,
) => Effect.Effect<
  VariableHandle<Def["nodeId"], ValueOfVariableDef<Def>, "read" | "readWrite">,
  OpcuaAccessDeniedError | OpcuaConfigurationError | OpcuaServiceError
>;

export const makeSubscription = (
  unsafeRaw: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  structureRuntime: OpcuaStructureRuntime,
  handleVariable: HandleVariable,
): OpcuaSubscription => {
  const finalizingMonitorGroups = new WeakSet<ClientMonitoredItemGroup>();

  const monitor: OpcuaSubscription["monitor"] = (options) =>
    Effect.gen(function* () {
      const bufferError = bufferPolicyError(options.clientBuffer);
      if (bufferError) return yield* Effect.fail(bufferError);
      const sampleQueue = yield* makeQueue<AnyReadResult, never>(
        options.clientBuffer,
      );
      const itemEvents =
        yield* PubSub.sliding<MonitorItemEvent>(EVENT_BUFFER_SIZE);
      const itemState =
        yield* PubSub.sliding<ReadonlyMap<string, MonitoredItemState>>(
          EVENT_BUFFER_SIZE,
        );
      type ActiveItem = {
        readonly handle: VariableHandle<string, unknown, "read" | "readWrite">;
        readonly options: MonitorItemOptions;
        readonly group: ClientMonitoredItemGroup;
        readonly teardown: () => void;
      };
      const registry = yield* Ref.make(new Map<string, ActiveItem>());
      const mutationLock = yield* Semaphore.make(1);

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

      const add: ValueMonitor["add"] = (defs) =>
        Effect.gen(function* () {
          const results: Array<MonitorAddResult> = [];
          for (const def of defs) {
            const effective = effectiveMonitorOptions(def, options);
            const current = (yield* Ref.get(registry)).get(def.nodeId);
            if (current) {
              const result = monitorOptionsEqual(current.options, effective)
                ? ({
                    _tag: "AlreadyMonitoring",
                    nodeId: def.nodeId,
                  } as const)
                : ({
                    _tag: "AlreadyMonitoringWithDifferentOptions",
                    nodeId: def.nodeId,
                    current: current.options,
                    requested: effective,
                  } as const);
              results.push(result);
              yield* PubSub.publish(itemEvents, result);
              continue;
            }

            const handleResult = yield* Effect.result(handleVariable(def));
            if (Result.isFailure(handleResult)) {
              const result = monitorAddErrorResult(
                def.nodeId,
                handleResult.failure,
              );
              results.push(result);
              yield* PubSub.publish(itemEvents, result);
              continue;
            }

            const handle = handleResult.success;
            const groupResult = yield* Effect.result(
              Effect.tryPromise({
                try: () =>
                  unsafeRaw.monitorItems(
                    [
                      {
                        nodeId: handle.unsafeRaw.nodeId,
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
                    operation: "monitor.add",
                    nodeId: def.nodeId,
                    cause,
                  }),
              }),
            );
            if (Result.isFailure(groupResult)) {
              const result = monitorAddErrorResult(
                def.nodeId,
                groupResult.failure,
              );
              results.push(result);
              yield* PubSub.publish(itemEvents, result);
              continue;
            }

            const group = groupResult.success;
            const failure = monitorCreateFailures(group, [def.nodeId])[0];
            if (failure) {
              yield* terminateMonitorGroup(group);
              const result = {
                _tag: "NonGoodStatus",
                nodeId: def.nodeId,
                status: normalizeStatusCode(
                  failure.statusCode ?? StatusCodes.Bad,
                ),
                cause: failure.cause,
              } as const;
              results.push(result);
              yield* PubSub.publish(itemEvents, result);
              continue;
            }

            const teardown = wireMonitorGroup(
              unsafeRaw,
              events,
              group,
              [{ nodeId: def.nodeId, handle }],
              sampleQueue,
              options.clientBuffer,
              structureRuntime,
              finalizingMonitorGroups,
              (nodeId, cause) =>
                Effect.runSync(
                  Ref.update(registry, (map) => {
                    const next = new Map(map);
                    next.delete(nodeId);
                    return next;
                  }).pipe(
                    Effect.andThen(publishState),
                    Effect.andThen(
                      PubSub.publish(itemEvents, {
                        _tag: "Terminated",
                        nodeId,
                        cause,
                      }),
                    ),
                  ),
                ),
            );

            yield* Ref.update(registry, (map) => {
              const next = new Map(map);
              next.set(def.nodeId, {
                handle,
                options: effective,
                group,
                teardown,
              });
              return next;
            });
            const result = {
              _tag: "Monitoring",
              nodeId: def.nodeId,
            } as const;
            results.push(result);
            yield* PubSub.publish(itemEvents, result);
            yield* publishState;
          }
          return results as never;
        }).pipe(mutationLock.withPermits(1));

      const remove: ValueMonitor["remove"] = (nodeIds) =>
        Effect.gen(function* () {
          const results: Array<MonitorRemoveResult> = [];
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
            current.teardown();
            yield* Effect.sync(() =>
              finalizingMonitorGroups.add(current.group),
            );
            yield* terminateMonitorGroup(current.group);
            const result = { _tag: "Removed", nodeId } as const;
            results.push(result);
            yield* PubSub.publish(itemEvents, result);
            yield* publishState;
          }
          return results as never;
        }).pipe(mutationLock.withPermits(1));

      yield* Effect.addFinalizer(() =>
        Ref.get(registry).pipe(
          Effect.flatMap((map) =>
            Effect.forEach(
              Array.from(map.values()),
              (item) =>
                Effect.sync(() => {
                  item.teardown();
                  finalizingMonitorGroups.add(item.group);
                }).pipe(Effect.andThen(terminateMonitorGroup(item.group))),
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

  const watch: OpcuaSubscription["watch"] = (defs, options) =>
    Stream.scoped(
      Stream.unwrap(
        Effect.gen(function* () {
          const active = yield* monitor(options);
          const results = yield* active.add(defs);
          yield* assertWatchStarted(results);
          return active.samples as unknown as Stream.Stream<
            MonitorSampleOf<(typeof defs)[number]>,
            OpcuaMonitorCreateError | OpcuaConfigurationError
          >;
        }),
      ),
    );

  return {
    monitor,
    watch,
    events: Stream.fromPubSub(events),
    unsafeRaw,
  };
};

type MonitorAddError =
  | OpcuaAccessDeniedError
  | OpcuaConfigurationError
  | OpcuaServiceError;

const monitorAddErrorResult = <Id extends string>(
  nodeId: Id,
  error: MonitorAddError,
): MonitorAddResult<Id> => {
  switch (error._tag) {
    case "OpcuaAccessDeniedError":
      return { _tag: "AccessDenied", nodeId, error };
    case "OpcuaConfigurationError":
      return { _tag: "ConfigurationError", nodeId, error };
    case "OpcuaServiceError":
      return { _tag: "ServiceError", nodeId, error };
  }
};

const assertWatchStarted = (
  results: ReadonlyArray<MonitorAddResult>,
): Effect.Effect<void, OpcuaMonitorCreateError> => {
  const failures = results.filter(isMonitorAddFailure);
  return failures.length === 0
    ? Effect.void
    : Effect.fail(
        new OpcuaMonitorCreateError({
          nodeIds: failures.map((failure) => failure.nodeId),
          details: failures.map(monitorCreateFailureDetail),
          cause: failures,
        }),
      );
};

const isMonitorAddFailure = (
  result: MonitorAddResult,
): result is Exclude<
  MonitorAddResult,
  | { readonly _tag: "Monitoring"; readonly nodeId: string }
  | { readonly _tag: "AlreadyMonitoring"; readonly nodeId: string }
> => result._tag !== "Monitoring" && result._tag !== "AlreadyMonitoring";

const monitorCreateFailureDetail = (
  failure: Exclude<
    MonitorAddResult,
    | { readonly _tag: "Monitoring"; readonly nodeId: string }
    | { readonly _tag: "AlreadyMonitoring"; readonly nodeId: string }
  >,
) => {
  switch (failure._tag) {
    case "AlreadyMonitoringWithDifferentOptions":
      return {
        nodeId: failure.nodeId,
        cause: {
          current: failure.current,
          requested: failure.requested,
        },
      };
    case "NonGoodStatus":
      return {
        nodeId: failure.nodeId,
        status: failure.status,
        cause: failure.cause,
      };
    case "ConfigurationError":
    case "AccessDenied":
    case "ServiceError":
      return { nodeId: failure.nodeId, cause: failure.error };
  }
};

type MonitorGroupEntry = {
  readonly nodeId: NodeIdString;
  readonly handle: VariableHandle<string, unknown, "read" | "readWrite">;
};

const effectiveMonitorOptions = (
  def: MonitorDef,
  options: MonitorOptions,
): MonitorItemOptions => ({
  samplingInterval: def.samplingInterval
    ? durationMillis(def.samplingInterval)
    : durationMillis(options.samplingInterval),
  filter: def.filter ?? options.filter,
});

const monitorOptionsEqual = (
  left: MonitorItemOptions,
  right: MonitorItemOptions,
) =>
  left.samplingInterval === right.samplingInterval &&
  monitorFilterKey(left.filter) === monitorFilterKey(right.filter);

const monitorFilterKey = (filter: MonitorFilter | undefined) => {
  if (!filter) return "None";
  switch (filter._tag) {
    case "None":
      return "None";
    case "Status":
      return "Status";
    case "StatusValue":
      return `StatusValue:${monitorDeadbandKey(filter.deadband)}`;
    case "StatusValueTimestamp":
      return `StatusValueTimestamp:${monitorDeadbandKey(filter.deadband)}`;
  }
};

const monitorDeadbandKey = (deadband: MonitorDeadband) => {
  switch (deadband._tag) {
    case "None":
      return "None";
    case "Absolute":
      return `Absolute:${deadband.value}`;
    case "Percent":
      return `Percent:${deadband.value}`;
  }
};

const toNodeOpcuaDataChangeFilter = (filter: MonitorFilter | undefined) =>
  filter && filter._tag !== "None"
    ? new DataChangeFilter({
        trigger: toNodeOpcuaDataChangeTrigger(filter),
        ...toNodeOpcuaDeadband(filter),
      })
    : undefined;

const toNodeOpcuaDataChangeTrigger = (filter: MonitorFilter) => {
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
  filter: MonitorFilter,
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

const terminateMonitorGroup = (group: ClientMonitoredItemGroup) =>
  Effect.tryPromise({
    try: () => group.terminate(),
    catch: (cause) => cause,
  }).pipe(Effect.ignore);

const monitorCreateFailures = (
  group: ClientMonitoredItemGroup,
  nodeIds: ReadonlyArray<NodeIdString>,
) =>
  group.monitoredItems
    .flatMap((item, index) => {
      const nodeId = nodeIds[index];
      return nodeId
        ? [
            {
              nodeId,
              statusCode: item.statusCode,
              cause: item.result,
            },
          ]
        : [];
    })
    .filter((detail) => !detail.statusCode || !isGood(detail.statusCode));

const wireMonitorGroup = (
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  group: ClientMonitoredItemGroup,
  entries: ReadonlyArray<MonitorGroupEntry>,
  queue: Queue.Queue<AnyReadResult, never>,
  policy: BufferPolicy,
  structureRuntime: OpcuaStructureRuntime,
  finalizingMonitorGroups: WeakSet<ClientMonitoredItemGroup>,
  onTerminated: (nodeId: NodeIdString, cause: unknown) => void,
) => {
  const onChanged = (
    _item: unknown,
    dataValue: import("node-opcua").DataValue,
    index: number,
  ) => {
    const entry = entries[index];
    if (!entry) return;
    Effect.runSync(
      sampleFromDataValue(entry.handle.def, dataValue, structureRuntime).pipe(
        Effect.tap((sample) =>
          Effect.sync(() =>
            offerMonitorSample(subscription, events, queue, policy, sample),
          ),
        ),
      ),
    );
  };
  const onError = (message: unknown) => {
    EventBus.publishUnsafe(events, {
      _tag: "InternalError",
      subscriptionId: subscription.subscriptionId,
      cause: message,
    });
  };
  const onTerminatedGroup = (cause: unknown) => {
    if (finalizingMonitorGroups.has(group)) return;
    EventBus.publishUnsafe(events, {
      _tag: "MonitorItemsTerminated",
      subscriptionId: subscription.subscriptionId,
      nodeIds: entries.map((entry) => entry.nodeId),
    });
    for (const entry of entries) onTerminated(entry.nodeId, cause);
  };
  group.on("changed", onChanged);
  group.on("err", onError);
  group.on("terminated", onTerminatedGroup);
  EventBus.publishUnsafe(events, {
    _tag: "MonitorItemsCreated",
    subscriptionId: subscription.subscriptionId,
    nodeIds: entries.map((entry) => entry.nodeId),
  });
  return () => {
    group.removeListener("changed", onChanged);
    group.removeListener("err", onError);
    group.removeListener("terminated", onTerminatedGroup);
  };
};

const offerMonitorSample = <E>(
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  queue: Queue.Queue<AnyReadResult, E>,
  policy: BufferPolicy,
  sample: AnyReadResult,
) => {
  const willDrop =
    policy._tag === "Sliding" && Queue.sizeUnsafe(queue) >= policy.capacity;
  const offered = Queue.offerUnsafe(queue, sample);
  if (willDrop || !offered) {
    EventBus.publishUnsafe(events, {
      _tag: "ClientBufferDropped",
      subscriptionId: subscription.subscriptionId,
      nodeId: sample.nodeId,
    });
  }
};

const durationMillis = (duration: Duration.Duration) =>
  Duration.toMillis(duration);

const bufferPolicyError = (policy: BufferPolicy) => {
  if (!Number.isInteger(policy.capacity) || policy.capacity < 1) {
    return new OpcuaConfigurationError({
      operation: "BufferPolicy",
      cause: "capacity must be a positive integer",
    });
  }
  return undefined;
};

const makeQueue = <A, E>(policy: BufferPolicy) =>
  policy._tag === "Sliding"
    ? Queue.sliding<A, E>(policy.capacity)
    : Queue.dropping<A, E>(policy.capacity);
