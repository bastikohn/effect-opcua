import {
  AttributeIds,
  ClientSubscription,
  DataChangeFilter,
  DataChangeTrigger,
  DeadbandType,
  StatusCodes,
  TimestampsToReturn,
  coerceNodeId,
  type ClientMonitoredItemGroup,
  type StatusCode,
} from "node-opcua";
import {
  Duration,
  Effect,
  PubSub,
  Queue,
  Ref,
  Scope,
  Semaphore,
  Stream,
} from "effect";

import { EVENT_BUFFER_SIZE } from "./constants.js";
import { type NodeIdString } from "./capabilities.js";
import {
  OpcuaConfigurationError,
  OpcuaMonitorCreateError,
  OpcuaServiceError,
} from "./errors.js";
import { type OpcuaSubscriptionEvent, publishUnsafe } from "./events.js";
import {
  isGood,
  normalizeStatusCode,
  type OpcuaStatusInfo,
} from "./normalize.js";
import {
  sampleFromDataValue,
  type AnySchema,
  type OpcuaAnyValueSample,
  type OpcuaValueSample,
  type ValueOfSpec,
} from "./values.js";

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

export const makeSubscription = (
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
              if (finalizingMonitorGroups.has(group)) return;
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
        }).pipe(mutationLock.withPermits(1));

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
                Effect.sync(() => finalizingMonitorGroups.add(item.group)).pipe(
                  Effect.andThen(terminateMonitorGroup(item.group)),
                ),
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

const durationMillis = (duration: Duration.Duration) =>
  Duration.toMillis(duration);

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
