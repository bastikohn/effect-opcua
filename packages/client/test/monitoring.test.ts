import { describe, expect, it } from "vitest";
import { Duration, Effect, Schema, Stream } from "effect";

import {
  ClientBufferPolicy,
  MonitorValueDeadband,
  MonitorValueFilter,
  OpcuaSession,
  OpcuaStructure,
} from "../src/index.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext(4843);
const ScanSettings = OpcuaStructure.make({
  name: "ScanSettings",
  dataTypeId: "ns=1;i=3010",
  schema: Schema.Struct({
    duration: Schema.Number,
    cycles: Schema.Number,
    dataAvailable: Schema.Boolean,
  }),
});

describe("monitoring", () => {
  it("builds monitor buffer policies and filters", () => {
    expect(ClientBufferPolicy.latest()).toEqual({
      _tag: "Sliding",
      capacity: 1,
    });
    expect(MonitorValueDeadband.absolute(0.5)).toEqual({
      _tag: "Absolute",
      value: 0.5,
    });
    expect(MonitorValueFilter.statusValue()).toEqual({
      _tag: "StatusValue",
      deadband: { _tag: "None" },
    });
  });

  it("streams typed and schema-less monitored samples", async () => {
    const values = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.createSubscription({
          publishingInterval: Duration.millis(100),
        });
        return yield* subscription
          .monitorValues(
            [
              {
                nodeId: "ns=1;s=MyMachine.Temperature",
                schema: Schema.Number,
              },
              { nodeId: "ns=1;s=MyMachine.HighFrequency" },
            ] as const,
            {
              samplingInterval: Duration.millis(50),
              queueSize: 5,
              discardOldest: true,
              clientBuffer: ClientBufferPolicy.sliding(10),
            },
          )
          .pipe(Stream.take(4), Stream.runCollect);
      }),
    );

    expect(values.length).toBe(4);
    expect(values.every((sample) => sample.nodeId)).toBe(true);
  }, 20_000);

  it("supports dynamic valueMonitor add/remove lifecycle", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.createSubscription({
          publishingInterval: Duration.millis(100),
        });
        const monitor = yield* subscription.valueMonitor({
          samplingInterval: Duration.millis(50),
          queueSize: 5,
          discardOldest: true,
          clientBuffer: ClientBufferPolicy.sliding(10),
          filter: MonitorValueFilter.statusValue(),
        });
        const first = yield* monitor.add([
          { nodeId: "ns=1;s=MyMachine.Temperature" },
        ]);
        const duplicate = yield* monitor.add([
          { nodeId: "ns=1;s=MyMachine.Temperature" },
        ]);
        const different = yield* monitor.add([
          {
            nodeId: "ns=1;s=MyMachine.Temperature",
            samplingInterval: Duration.millis(100),
          },
        ]);
        const items = yield* monitor.items;
        const sample = yield* monitor.samples.pipe(
          Stream.take(1),
          Stream.runCollect,
        );
        const removed = yield* monitor.remove(["ns=1;s=MyMachine.Temperature"]);
        const notMonitoring = yield* monitor.remove([
          "ns=1;s=MyMachine.Temperature",
        ]);
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
    expect(result.items.has("ns=1;s=MyMachine.Temperature")).toBe(true);
    expect(result.sample.length).toBe(1);
    expect(result.removed[0]).toMatchObject({ _tag: "Removed" });
    expect(result.notMonitoring[0]).toMatchObject({ _tag: "NotMonitoring" });
  }, 20_000);

  it("streams structure samples from monitorValues and valueMonitor", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.createSubscription({
          publishingInterval: Duration.millis(100),
        });
        const direct = yield* subscription
          .monitorValues(
            [
              {
                nodeId: "ns=1;s=MyMachine.ScanSettings",
                structure: ScanSettings,
              },
            ] as const,
            {
              samplingInterval: Duration.millis(50),
              queueSize: 5,
              discardOldest: true,
              clientBuffer: ClientBufferPolicy.sliding(10),
            },
          )
          .pipe(Stream.take(1), Stream.runCollect);
        const monitor = yield* subscription.valueMonitor({
          samplingInterval: Duration.millis(50),
          queueSize: 5,
          discardOldest: true,
          clientBuffer: ClientBufferPolicy.sliding(10),
        });
        yield* monitor.add([
          {
            nodeId: "ns=1;s=MyMachine.ScanSettings",
            structure: ScanSettings,
          },
        ]);
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
          const subscription = yield* session.createSubscription({
            publishingInterval: Duration.millis(100),
          });
          return yield* subscription
            .monitorValues(
              [
                {
                  nodeId: "ns=1;s=MyMachine.Temperature",
                  structure: ScanSettings,
                },
              ] as const,
              {
                samplingInterval: Duration.millis(50),
                queueSize: 5,
                discardOldest: true,
                clientBuffer: ClientBufferPolicy.sliding(10),
              },
            )
            .pipe(Stream.take(1), Stream.runCollect);
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaConfigurationError",
      operation: "monitorValues.structure",
    });
  }, 20_000);
});
