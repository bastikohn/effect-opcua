import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  Duration,
  Effect,
  Fiber,
  Option,
  PubSub,
  Result,
  Schema,
  Stream,
} from "effect";

import {
  Opcua,
  OpcuaSession,
  type OpcuaSubscription,
  type OpcuaVariable,
} from "@effect-opcua/client";
import type { OpcuaSubscriptionEvent } from "../src/internal/events/model.js";
import {
  AccessLevelFlag,
  DataType,
  StatusCodes,
  TimestampsToReturn,
  Variant,
  type ClientSubscription,
} from "@effect-opcua/client/node-opcua";
import type { OpcuaStructureRuntime } from "../src/internal/structures/runtime.js";
import { makeSubscription } from "../src/OpcuaSubscription.js";
import { makeLiveTestContext } from "./live.js";
import {
  GlobalCommandSubmitRequest,
  MachineConfigurePayload,
  demoNodeId,
} from "./support/demo-model.js";

const { runLive } = makeLiveTestContext("monitoring", 3);

const monitorOptions = (
  overrides?: Partial<{
    readonly startup: "strict" | "bestEffort";
    readonly validation: "none" | "access" | "strict";
  }>,
) => ({
  startup: overrides?.startup ?? ("strict" as const),
  validation: overrides?.validation ?? ("strict" as const),
  samplingInterval: Duration.millis(50),
  queueSize: 5,
  discardOldest: true,
  filter: Opcua.MonitorFilter.statusValue(),
  timestamps: "both" as const,
  clientBuffer: Opcua.BufferPolicy.sliding(10),
});

const unitMonitorOptions = (
  overrides?: Partial<
    OpcuaSubscription.MonitorOptions<
      Record<string, OpcuaVariable.ReadableVariableDef>
    >
  >,
): OpcuaSubscription.MonitorOptions<
  Record<string, OpcuaVariable.ReadableVariableDef>
> => ({
  startup: overrides?.startup ?? "strict",
  validation: overrides?.validation ?? "none",
  samplingInterval: overrides?.samplingInterval ?? Duration.millis(50),
  queueSize: overrides?.queueSize ?? 5,
  discardOldest: overrides?.discardOldest ?? true,
  filter: overrides?.filter ?? Opcua.MonitorFilter.statusValue(),
  timestamps: overrides?.timestamps ?? "both",
  clientBuffer: overrides?.clientBuffer ?? Opcua.BufferPolicy.sliding(10),
  overrides: overrides?.overrides,
  create: overrides?.create,
});

class FakeMonitorGroup extends EventEmitter {
  terminated = false;
  monitoredItems: Array<{
    statusCode: (typeof StatusCodes)["Good"];
    result?: unknown;
  }>;
  readonly originalMonitoredItems: FakeMonitorGroup["monitoredItems"];

  constructor(statusCodes: ReadonlyArray<(typeof StatusCodes)["Good"]>) {
    super();
    this.monitoredItems = statusCodes.map((statusCode) => ({
      statusCode,
      result: {
        revisedSamplingInterval: 50,
        revisedQueueSize: 5,
        statusCode,
      },
    }));
    this.originalMonitoredItems = this.monitoredItems;
  }

  async terminate() {
    this.terminated = true;
    this.emit("terminated", new Error("terminated"));
  }

  emitChangedForOriginalIndex(index: number, dataValue: unknown) {
    const item = this.originalMonitoredItems[index];
    this.emit("changed", item, dataValue, this.monitoredItems.indexOf(item!));
  }
}

type FakeMonitorItemsCall = {
  readonly items: ReadonlyArray<unknown>;
  readonly parameters: {
    readonly samplingInterval?: number;
    readonly queueSize?: number;
    readonly discardOldest?: boolean;
    readonly filter?: unknown;
  };
  readonly timestamps: TimestampsToReturn;
};

const fakeStructureRuntime = {
  ensureInitialized: () => Effect.void,
  invalidate: Effect.void,
  encodeStructure: () => Effect.die("unused"),
  encodeStructureArray: () => Effect.die("unused"),
  decodeStructure: () => {
    throw new Error("unused");
  },
  decodeStructureArray: () => {
    throw new Error("unused");
  },
  variantFromStructure: () => Effect.die("unused"),
} as unknown as OpcuaStructureRuntime;

const makeFakeSubscription = (options?: {
  readonly statusForItem?: (input: {
    readonly callIndex: number;
    readonly itemIndex: number;
  }) => (typeof StatusCodes)["Good"];
  readonly monitorDelayMs?: number;
  readonly beforeMonitorResolve?: (input: {
    readonly callIndex: number;
    readonly items: ReadonlyArray<unknown>;
  }) => void | Promise<void>;
  readonly read?: (...args: ReadonlyArray<unknown>) => Promise<unknown>;
  readonly onMonitorItems?: () => void;
  readonly failCall?: (callIndex: number) => boolean;
  readonly validateVariable?: (
    def: OpcuaVariable.ReadableVariableDef,
  ) => Effect.Effect<never>;
}) =>
  Effect.gen(function* () {
    const calls: Array<FakeMonitorItemsCall> = [];
    const groups: Array<FakeMonitorGroup> = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const events =
      yield* PubSub.sliding<OpcuaSubscriptionEvent>(EVENT_BUFFER_SIZE);
    const raw = {
      subscriptionId: 1,
      session: {
        read:
          options?.read ??
          (async () => {
            throw new Error("unexpected metadata read");
          }),
      },
      monitorItems: async (
        items: ReadonlyArray<unknown>,
        parameters: FakeMonitorItemsCall["parameters"],
        timestamps: TimestampsToReturn,
      ) => {
        options?.onMonitorItems?.();
        const callIndex = calls.length;
        calls.push({ items, parameters, timestamps });
        if (options?.failCall?.(callIndex)) {
          throw new Error("monitorItems failed");
        }
        inFlight++;
        try {
          maxInFlight = Math.max(maxInFlight, inFlight);
          if (options?.monitorDelayMs) {
            await new Promise((resolve) =>
              setTimeout(resolve, options.monitorDelayMs),
            );
          }
          await options?.beforeMonitorResolve?.({ callIndex, items });
          const group = new FakeMonitorGroup(
            items.map(
              (_, itemIndex) =>
                options?.statusForItem?.({ callIndex, itemIndex }) ??
                StatusCodes.Good,
            ),
          );
          groups.push(group);
          return group;
        } finally {
          inFlight--;
        }
      },
    } as unknown as ClientSubscription;
    const subscription = makeSubscription(
      raw,
      events,
      fakeStructureRuntime,
      (options?.validateVariable ??
        (() => Effect.die("unexpected strict validation"))) as never,
    );
    return {
      calls,
      groups,
      maxInFlight: () => maxInFlight,
      subscription,
    };
  });

const makeItems = (count: number) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `item${index}`,
      Opcua.variable({ nodeId: `ns=1;s=item${index}` }),
    ]),
  ) as Record<string, OpcuaVariable.ReadableVariableDef>;

const numberDataValue = (value: number) => ({
  statusCode: StatusCodes.Good,
  value: new Variant({
    dataType: DataType.Double,
    value,
  }),
  sourceTimestamp: new Date(0),
  serverTimestamp: new Date(0),
});

const EVENT_BUFFER_SIZE = 16;

describe("monitoring", () => {
  it("builds monitor buffer policies and filters", () => {
    expect(Opcua.BufferPolicy.latest()).toEqual({
      _tag: "Sliding",
      capacity: 1,
    });
    expect(Opcua.MonitorDeadband.absolute(0.5)).toEqual({
      _tag: "Absolute",
      value: 0.5,
    });
    expect(Opcua.MonitorFilter.statusValue()).toEqual({
      _tag: "StatusValue",
      deadband: { _tag: "None" },
    });
  });

  it("batches compatible items into one monitorItems call", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription();
          const monitor = yield* fake.subscription.monitor(
            makeItems(3),
            unitMonitorOptions(),
          );
          return { calls: fake.calls, startup: monitor.startup };
        }),
      ),
    );

    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.items).toHaveLength(3);
    expect(result.startup).toMatchObject({
      ok: true,
      activeCount: 3,
      failedCount: 0,
    });
  });

  it("separates incompatible overrides and rejects unknown override keys", async () => {
    const split = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription();
          const monitor = yield* fake.subscription.monitor(makeItems(2), {
            ...unitMonitorOptions(),
            overrides: {
              item1: { samplingInterval: Duration.millis(100) },
            },
          });
          return { calls: fake.calls, startup: monitor.startup };
        }),
      ),
    );

    expect(split.calls).toHaveLength(2);
    expect(split.startup.activeCount).toBe(2);

    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fake = yield* makeFakeSubscription();
            return yield* fake.subscription.monitor(makeItems(1), {
              ...unitMonitorOptions(),
              overrides: {
                missing: { queueSize: 2 },
              },
            });
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "MonitorConfiguration" },
    });
  });

  it("rejects duplicate monitor NodeIds when the first key is empty", async () => {
    const duplicate = Opcua.variable({ nodeId: "ns=1;s=Monitor.Duplicate" });

    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fake = yield* makeFakeSubscription();
            return yield* fake.subscription.monitor(
              { "": duplicate, later: duplicate } as const,
              unitMonitorOptions(),
            );
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "MonitorConfiguration" },
    });
  });

  it("rejects missing option objects, invalid create options, and invalid deadbands", async () => {
    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fake = yield* makeFakeSubscription();
            return yield* fake.subscription.monitor(
              makeItems(1),
              null as never,
            );
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "MonitorConfiguration" },
    });

    for (const create of [
      null,
      { nope: 1 },
      { maxItemsPerRequest: 0 },
      { maxConcurrentRequests: 0 },
    ]) {
      await expect(
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fake = yield* makeFakeSubscription();
              return yield* fake.subscription.monitor(
                makeItems(1),
                unitMonitorOptions({ create: create as never }),
              );
            }),
          ),
        ),
      ).rejects.toMatchObject({
        _tag: "OpcuaError",
        reason: { _tag: "MonitorConfiguration" },
      });
    }

    for (const filter of [
      Opcua.MonitorFilter.statusValue(Opcua.MonitorDeadband.absolute(-1)),
      Opcua.MonitorFilter.statusValue(Opcua.MonitorDeadband.percent(-1)),
      Opcua.MonitorFilter.statusValue(Opcua.MonitorDeadband.percent(101)),
    ]) {
      await expect(
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const fake = yield* makeFakeSubscription();
              return yield* fake.subscription.monitor(
                makeItems(1),
                unitMonitorOptions({ filter }),
              );
            }),
          ),
        ),
      ).rejects.toMatchObject({
        _tag: "OpcuaError",
        reason: { _tag: "MonitorConfiguration" },
      });
    }
  });

  it("chunks compatible items and respects create concurrency", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription({ monitorDelayMs: 10 });
          const monitor = yield* fake.subscription.monitor(makeItems(4), {
            ...unitMonitorOptions(),
            create: {
              maxItemsPerRequest: 1,
              maxConcurrentRequests: 2,
            },
          });
          return {
            calls: fake.calls,
            maxInFlight: fake.maxInFlight(),
            startup: monitor.startup,
          };
        }),
      ),
    );

    expect(result.calls).toHaveLength(4);
    expect(result.maxInFlight).toBe(2);
    expect(result.startup.activeCount).toBe(4);
  });

  it("uses the default chunk size of 250", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription();
          const monitor = yield* fake.subscription.monitor(
            makeItems(251),
            unitMonitorOptions(),
          );
          return { calls: fake.calls, startup: monitor.startup };
        }),
      ),
    );

    expect(result.calls).toHaveLength(2);
    expect(result.calls[0]?.items).toHaveLength(250);
    expect(result.calls[1]?.items).toHaveLength(1);
    expect(result.startup.activeCount).toBe(251);
  });

  it("best-effort startup reports chunk failures per item", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription({
            failCall: (callIndex) => callIndex === 1,
          });
          const monitor = yield* fake.subscription.monitor(makeItems(3), {
            ...unitMonitorOptions({ startup: "bestEffort" }),
            create: {
              maxItemsPerRequest: 1,
              maxConcurrentRequests: 1,
            },
          });
          return monitor.startup;
        }),
      ),
    );

    expect(result).toMatchObject({
      ok: false,
      requested: 3,
      activeCount: 2,
      failedCount: 1,
    });
    expect(result.failed.has("item1")).toBe(true);
  });

  it("keeps later same-chunk successes after a failed middle item", async () => {
    const samples = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription({
            statusForItem: ({ itemIndex }) =>
              itemIndex === 1 ? StatusCodes.BadNodeIdUnknown : StatusCodes.Good,
          });
          const monitor = yield* fake.subscription.monitor(
            {
              A: Opcua.variable({
                nodeId: "ns=1;s=A",
                codec: Opcua.schema(Schema.Number),
              }),
              B: Opcua.variable({
                nodeId: "ns=1;s=B",
                codec: Opcua.schema(Schema.Number),
              }),
              C: Opcua.variable({
                nodeId: "ns=1;s=C",
                codec: Opcua.schema(Schema.Number),
              }),
            } as const,
            unitMonitorOptions({ startup: "bestEffort" }),
          );

          expect(monitor.startup.active.has("C")).toBe(true);
          expect(monitor.startup.failed.has("B")).toBe(true);
          fake.groups[0]?.emitChangedForOriginalIndex(2, numberDataValue(3));
          return yield* monitor.samples.pipe(
            Stream.take(1),
            Stream.runCollect,
            Effect.timeout(Duration.millis(200)),
          );
        }),
      ),
    );

    expect(samples[0]).toMatchObject({
      _tag: "Value",
      key: "C",
      value: 3,
    });
  });

  it("cleans up successful groups when strict startup later fails", async () => {
    const fake = await Effect.runPromise(
      makeFakeSubscription({
        statusForItem: ({ callIndex }) =>
          callIndex === 1 ? StatusCodes.BadNodeIdUnknown : StatusCodes.Good,
      }),
    );

    await expect(
      Effect.runPromise(
        Effect.scoped(
          fake.subscription.monitor(makeItems(2), {
            ...unitMonitorOptions(),
            create: {
              maxItemsPerRequest: 1,
              maxConcurrentRequests: 1,
            },
          }),
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "MonitorCreate" },
    });

    expect(fake.groups[0]?.terminated).toBe(true);
    expect(fake.groups[1]?.terminated).toBe(true);
  });

  it("terminates created groups if monitor startup is interrupted", async () => {
    let unblockSecond: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => {
      unblockSecond = resolve;
    });
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription({
            beforeMonitorResolve: ({ callIndex }) => {
              if (callIndex !== 1) return undefined;
              unblockSecond?.();
              return new Promise<void>(() => undefined);
            },
          });
          const fiber = yield* Effect.forkScoped(
            fake.subscription.monitor(makeItems(2), {
              ...unitMonitorOptions(),
              create: {
                maxItemsPerRequest: 1,
                maxConcurrentRequests: 1,
              },
            }),
          );

          yield* Effect.tryPromise(() => secondStarted);
          yield* Fiber.interrupt(fiber);
          return fake;
        }),
      ),
    );

    expect(result.groups[0]?.terminated).toBe(true);
    expect(result.groups[0]?.listenerCount("changed")).toBe(0);
  });

  it("does not publish MonitorItemsCreated for failed strict startup", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription({
            statusForItem: ({ callIndex }) =>
              callIndex === 1 ? StatusCodes.BadNodeIdUnknown : StatusCodes.Good,
          });
          const events = yield* Effect.forkScoped(
            fake.subscription.events.pipe(
              Stream.filter((event) => event._tag === "MonitorItemsCreated"),
              Stream.take(1),
              Stream.runCollect,
              Effect.timeoutOption(Duration.millis(50)),
            ),
          );
          const created = yield* Effect.result(
            fake.subscription.monitor(makeItems(2), {
              ...unitMonitorOptions(),
              create: {
                maxItemsPerRequest: 1,
                maxConcurrentRequests: 1,
              },
            }),
          );
          const observed = yield* Fiber.join(events);
          return { created, observed };
        }),
      ),
    );

    expect(Result.isFailure(result.created)).toBe(true);
    expect(Option.isNone(result.observed)).toBe(true);
  });

  it("validation none skips metadata reads and access validation only reads access", async () => {
    let validationCalls = 0;
    let readCalls = 0;
    const none = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription({
            validateVariable: () => {
              validationCalls++;
              return Effect.die("unexpected validation");
            },
          });
          const monitor = yield* fake.subscription.monitor(
            makeItems(1),
            unitMonitorOptions({ validation: "none" }),
          );
          return monitor.startup;
        }),
      ),
    );
    const access = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription({
            read: async () => {
              readCalls++;
              return [
                {
                  statusCode: StatusCodes.Good,
                  value: { value: AccessLevelFlag.CurrentRead },
                },
                { statusCode: StatusCodes.Good, value: { value: undefined } },
              ];
            },
            validateVariable: () => {
              validationCalls++;
              return Effect.die("unexpected validation");
            },
          });
          const monitor = yield* fake.subscription.monitor(
            makeItems(1),
            unitMonitorOptions({ validation: "access" }),
          );
          return monitor.startup;
        }),
      ),
    );

    expect(none.activeCount).toBe(1);
    expect(access.activeCount).toBe(1);
    expect(validationCalls).toBe(0);
    expect(readCalls).toBe(1);
  });

  it("chunks access validation reads with the create request size", async () => {
    const readSizes: Array<number> = [];
    const startup = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription({
            read: async (nodes) => {
              const readNodes = nodes as ReadonlyArray<unknown>;
              readSizes.push(readNodes.length);
              return readNodes.map((_, index) =>
                index % 2 === 0
                  ? {
                      statusCode: StatusCodes.Good,
                      value: { value: AccessLevelFlag.CurrentRead },
                    }
                  : {
                      statusCode: StatusCodes.Good,
                      value: { value: undefined },
                    },
              );
            },
          });
          const monitor = yield* fake.subscription.monitor(
            makeItems(251),
            unitMonitorOptions({ validation: "access" }),
          );
          return monitor.startup;
        }),
      ),
    );

    expect(startup.activeCount).toBe(251);
    expect(readSizes).toEqual([500, 2]);
  });

  it("emits status and decode problems as samples", async () => {
    const samples = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription();
          const monitor = yield* fake.subscription.monitor(
            {
              number: Opcua.variable({
                nodeId: "ns=1;s=number",
                codec: Opcua.schema(Schema.Number),
              }),
            } as const,
            unitMonitorOptions(),
          );
          fake.groups[0]?.emit(
            "changed",
            {},
            {
              statusCode: StatusCodes.BadNodeIdUnknown,
              value: undefined,
              sourceTimestamp: new Date(0),
              serverTimestamp: new Date(0),
            },
            0,
          );
          fake.groups[0]?.emit(
            "changed",
            {},
            {
              statusCode: StatusCodes.Good,
              value: new Variant({
                dataType: DataType.String,
                value: "not a number",
              }),
              sourceTimestamp: new Date(0),
              serverTimestamp: new Date(0),
            },
            0,
          );
          return yield* monitor.samples.pipe(Stream.take(2), Stream.runCollect);
        }),
      ),
    );

    expect(samples.map((sample) => sample._tag)).toEqual([
      "Status",
      "DecodeError",
    ]);
  });

  it("preserves changed notification order", async () => {
    const samples = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSubscription();
          const monitor = yield* fake.subscription.monitor(
            {
              A: Opcua.variable({
                nodeId: "ns=1;s=A",
                codec: Opcua.schema(Schema.Number),
              }),
              B: Opcua.variable({
                nodeId: "ns=1;s=B",
                codec: Opcua.schema(Schema.Number),
              }),
            } as const,
            unitMonitorOptions(),
          );
          fake.groups[0]?.emitChangedForOriginalIndex(0, numberDataValue(1));
          fake.groups[0]?.emitChangedForOriginalIndex(1, numberDataValue(2));
          return yield* monitor.samples.pipe(Stream.take(2), Stream.runCollect);
        }),
      ),
    );

    expect(samples.map((sample) => sample.key)).toEqual(["A", "B"]);
  });

  it("streams typed and dynamic monitored samples from a named item dictionary", async () => {
    const values = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.Session;
        const subscription = yield* session.makeSubscription({
          publishingInterval: Duration.millis(100),
        });
        const monitor = yield* subscription.monitor(
          {
            tankLevel: Opcua.variable({
              nodeId: demoNodeId("Filling.Tank.LevelMl"),
              codec: Opcua.schema(Schema.Number),
            }),
            machineState: Opcua.variable({
              nodeId: demoNodeId("State.MachineState"),
            }),
          } as const,
          monitorOptions(),
        );
        return yield* monitor.samples.pipe(Stream.take(2), Stream.runCollect);
      }),
    );

    expect(values.length).toBe(2);
    expect(values.every((sample) => sample.key)).toBe(true);
    expect(values.every((sample) => sample.nodeId)).toBe(true);
  }, 20_000);

  it("returns a keyed strict startup report for valid variables", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.Session;
        const subscription = yield* session.makeSubscription({
          publishingInterval: Duration.millis(100),
        });
        const monitor = yield* subscription.monitor(
          {
            tankLevel: Opcua.variable({
              nodeId: demoNodeId("Filling.Tank.LevelMl"),
            }),
            machineState: Opcua.variable({
              nodeId: demoNodeId("State.MachineState"),
            }),
          } as const,
          monitorOptions(),
        );
        const sample = yield* monitor.samples.pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        return { startup: monitor.startup, sample };
      }),
    );

    expect(result.startup).toMatchObject({
      ok: true,
      requested: 2,
      activeCount: 2,
      failedCount: 0,
    });
    expect(result.startup.active.has("tankLevel")).toBe(true);
    expect(result.startup.active.has("machineState")).toBe(true);
    expect(result.sample[0]).toMatchObject({
      key: expect.any(String),
      nodeId: expect.any(String),
    });
  }, 20_000);

  it("returns best-effort monitors with active and failed startup entries", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.Session;
        const subscription = yield* session.makeSubscription({
          publishingInterval: Duration.millis(100),
        });
        const monitor = yield* subscription.monitor(
          {
            tankLevel: Opcua.variable({
              nodeId: demoNodeId("Filling.Tank.LevelMl"),
            }),
            missing: Opcua.variable({ nodeId: "ns=1;s=missing" }),
          } as const,
          monitorOptions({ startup: "bestEffort", validation: "strict" }),
        );
        return { startup: monitor.startup };
      }),
    );

    expect(result.startup).toMatchObject({
      ok: false,
      requested: 2,
      activeCount: 1,
      failedCount: 1,
    });
    expect(result.startup.active.has("tankLevel")).toBe(true);
    expect(result.startup.failed.has("missing")).toBe(true);
  }, 20_000);

  it("fails strict startup with the shared keyed startup report", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.Session;
          const subscription = yield* session.makeSubscription({
            publishingInterval: Duration.millis(100),
          });
          return yield* subscription.monitor(
            {
              missing: Opcua.variable({ nodeId: "ns=1;s=missing" }),
            } as const,
            monitorOptions(),
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: {
        _tag: "MonitorCreate",
        startup: {
          ok: false,
          requested: 1,
          activeCount: 0,
          failedCount: 1,
        },
      },
    });
  }, 20_000);

  it("rejects duplicate NodeIds before startup", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.Session;
          const subscription = yield* session.makeSubscription({
            publishingInterval: Duration.millis(100),
          });
          return yield* subscription.monitor(
            {
              tankLevel: Opcua.variable({
                nodeId: demoNodeId("Filling.Tank.LevelMl"),
              }),
              duplicate: Opcua.variable({
                nodeId: demoNodeId("Filling.Tank.LevelMl"),
              }),
            } as const,
            monitorOptions(),
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "MonitorConfiguration" },
    });
  }, 20_000);

  it("streams structure samples through monitor", async () => {
    const SubmitRequest = Opcua.variable({
      nodeId: demoNodeId("Commands.SubmitRequest"),
      codec: GlobalCommandSubmitRequest,
    });
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.Session;
        const subscription = yield* session.makeSubscription({
          publishingInterval: Duration.millis(100),
        });
        const monitor = yield* subscription.monitor(
          { submit: SubmitRequest } as const,
          monitorOptions(),
        );
        return yield* monitor.samples.pipe(
          Stream.filter((sample) => sample._tag === "Value"),
          Stream.take(1),
          Stream.runCollect,
        );
      }),
    );

    expect(result[0]).toMatchObject({
      _tag: "Value",
      key: "submit",
      value: expect.objectContaining({ commandId: expect.any(String) }),
    });
  }, 20_000);

  it("rejects invalid structure specs before creating monitored items", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.Session;
          const subscription = yield* session.makeSubscription({
            publishingInterval: Duration.millis(100),
          });
          return yield* subscription.monitor(
            {
              tankLevel: Opcua.variable({
                nodeId: demoNodeId("Filling.Tank.LevelMl"),
                codec: MachineConfigurePayload,
              }),
            } as const,
            monitorOptions(),
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "MonitorCreate" },
    });
  }, 20_000);
});
