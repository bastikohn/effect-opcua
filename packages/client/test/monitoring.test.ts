import { describe, expect, it } from "vitest";
import { Duration, Effect, Schema, Stream } from "effect";

import { Opcua, OpcuaSession } from "../src/index.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext(4843);
const ScanSettingsSpec = Opcua.Structure.make({
  name: "ScanSettings",
  dataTypeId: "ns=1;i=3010",
  schema: Schema.Struct({
    duration: Schema.Number,
    cycles: Schema.Number,
    dataAvailable: Schema.Boolean,
  }),
});
const ScanSettings = Opcua.structure(ScanSettingsSpec);

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

  it("streams typed and dynamic monitored samples through watch", async () => {
    const values = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.subscription({
          publishingInterval: Duration.millis(100),
        });
        return yield* subscription
          .watch(
            [
              Opcua.variable({
                nodeId: "ns=1;s=MyMachine.Temperature",
                codec: Opcua.schema(Schema.Number),
              }),
              Opcua.variable({ nodeId: "ns=1;s=MyMachine.HighFrequency" }),
            ] as const,
            {
              samplingInterval: Duration.millis(50),
              queueSize: 5,
              discardOldest: true,
              clientBuffer: Opcua.BufferPolicy.sliding(10),
            },
          )
          .pipe(Stream.take(4), Stream.runCollect);
      }),
    );

    expect(values.length).toBe(4);
    expect(values.every((sample) => sample.nodeId)).toBe(true);
  }, 20_000);

  it("supports dynamic monitor add/remove lifecycle", async () => {
    const Temperature = Opcua.variable({
      nodeId: "ns=1;s=MyMachine.Temperature",
    });
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.subscription({
          publishingInterval: Duration.millis(100),
        });
        const monitor = yield* subscription.monitor({
          samplingInterval: Duration.millis(50),
          queueSize: 5,
          discardOldest: true,
          clientBuffer: Opcua.BufferPolicy.sliding(10),
          filter: Opcua.MonitorFilter.statusValue(),
        });
        const first = yield* monitor.add([Temperature]);
        const duplicate = yield* monitor.add([Temperature]);
        const different = yield* monitor.add([
          {
            ...Temperature,
            samplingInterval: Duration.millis(100),
          },
        ]);
        const items = yield* monitor.items;
        const sample = yield* monitor.samples.pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        const removed = yield* monitor.remove([Temperature.nodeId]);
        const notMonitoring = yield* monitor.remove([Temperature.nodeId]);
        return {
          first,
          duplicate,
          different,
          items,
          sample,
          removed,
          notMonitoring,
        };
      }),
    );

    expect(result.first[0]).toMatchObject({ _tag: "Monitoring" });
    expect(result.duplicate[0]).toMatchObject({ _tag: "AlreadyMonitoring" });
    expect(result.different[0]).toMatchObject({
      _tag: "AlreadyMonitoringWithDifferentOptions",
    });
    expect(result.items.has(Temperature.nodeId)).toBe(true);
    expect(result.sample.length).toBe(1);
    expect(result.removed[0]).toMatchObject({ _tag: "Removed" });
    expect(result.notMonitoring[0]).toMatchObject({ _tag: "NotMonitoring" });
  }, 20_000);

  it("streams structure samples through watch and monitor", async () => {
    const Settings = Opcua.variable({
      nodeId: "ns=1;s=MyMachine.ScanSettings",
      codec: ScanSettings,
    });
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.subscription({
          publishingInterval: Duration.millis(100),
        });
        const direct = yield* subscription
          .watch([Settings] as const, {
            samplingInterval: Duration.millis(50),
            queueSize: 5,
            discardOldest: true,
            clientBuffer: Opcua.BufferPolicy.sliding(10),
          })
          .pipe(Stream.take(1), Stream.runCollect);
        const monitor = yield* subscription.monitor({
          samplingInterval: Duration.millis(50),
          queueSize: 5,
          discardOldest: true,
          clientBuffer: Opcua.BufferPolicy.sliding(10),
        });
        yield* monitor.add([Settings]);
        const dynamic = yield* monitor.samples.pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        return { direct, dynamic };
      }),
    );

    expect(result.direct[0]).toMatchObject({
      _tag: "Value",
      value: expect.objectContaining({ cycles: expect.any(Number) }),
    });
    expect(result.dynamic[0]).toMatchObject({
      _tag: "Value",
      value: expect.objectContaining({ cycles: expect.any(Number) }),
    });
  }, 20_000);

  it("rejects invalid structure specs before creating monitored items", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          const subscription = yield* session.subscription({
            publishingInterval: Duration.millis(100),
          });
          return yield* subscription
            .watch(
              [
                Opcua.variable({
                  nodeId: "ns=1;s=MyMachine.Temperature",
                  codec: ScanSettings,
                }),
              ] as const,
              {
                samplingInterval: Duration.millis(50),
                queueSize: 5,
                discardOldest: true,
                clientBuffer: Opcua.BufferPolicy.sliding(10),
              },
            )
            .pipe(Stream.take(1), Stream.runCollect);
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaConfigurationError",
    });
  }, 20_000);
});
