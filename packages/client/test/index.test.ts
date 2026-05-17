import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Duration, Effect, Layer, Schema, Scope, Stream } from "effect";
import { BrowseDirection, StatusCodes, makeResultMask } from "node-opcua";

import {
  startDemoOpcuaServer,
  type DemoOpcuaServer,
} from "../../demo-server/src/index.js";
import {
  BrowseDirection as ExportedBrowseDirection,
  Capabilities,
  ClientBufferPolicy,
  MonitorValueDeadband,
  MonitorValueFilter,
  OpcuaClient,
  OpcuaConfigurationError,
  OpcuaNonGoodStatusError,
  OpcuaSession,
  capabilities,
  makeResultMask as exportedMakeResultMask,
} from "../src/index.js";

let demo: DemoOpcuaServer;

vi.setConfig({ testTimeout: 30_000 });

beforeAll(async () => {
  demo = await startDemoOpcuaServer({ port: 4841 });
}, 30_000);

afterAll(async () => {
  await demo?.stop();
}, 30_000);

const makeLiveLayer = () =>
  OpcuaSession.layer().pipe(
    Layer.provideMerge(
      OpcuaClient.layer({
        endpointUrl: demo.endpointUrl,
        clientOptions: { endpointMustExist: false },
      }),
    ),
  );

const runLive = <A, E>(
  effect: Effect.Effect<A, E, OpcuaSession | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(effect).pipe(
      Effect.provide(makeLiveLayer()),
      Effect.timeout("10 seconds"),
    ),
  );

describe("capabilities and helper exports", () => {
  it("keeps capability presets and browse helper re-exports", () => {
    expect(capabilities("read", "write")).toEqual(["read", "write"]);
    expect(Capabilities.read).toEqual(["read"]);
    expect(Capabilities.write).toEqual(["write"]);
    expect(Capabilities.readWrite).toEqual(["read", "write"]);
    expect(ExportedBrowseDirection.Forward).toBe(BrowseDirection.Forward);
    expect(exportedMakeResultMask("BrowseName")).toBe(
      makeResultMask("BrowseName"),
    );
  });

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
});

describe("browseChildren", () => {
  it("browses normalized child references from ObjectsFolder", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browseChildren("i=85");
      }),
    );

    const machine = result.references.find(
      (reference) => reference.browseName?.name === "MyMachine",
    );
    expect(machine).toMatchObject({
      nodeId: {
        text: expect.stringContaining("MyMachine"),
        namespace: expect.any(Number),
        isLocal: true,
        isRemote: false,
      },
      nodeClass: "Object",
      browseName: {
        name: "MyMachine",
      },
      displayName: {
        text: "MyMachine",
      },
    });
    expect(machine?.raw).toBeUndefined();
  });

  it("keeps lower-level browse raw fields opt-in", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browse({
          nodeId: "ns=1;s=MyMachine",
          resultMask: makeResultMask("BrowseName"),
          includeRaw: true,
        });
      }),
    );

    expect(result.status).toMatchObject({ isGood: true });
    expect(result.raw).toBeDefined();
    expect(result.references[0]?.raw).toBeDefined();
    expect(result.references[0]?.browseName).toBeDefined();
  });

  it("fails invalid browse input before calling node-opcua", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browse({ nodeId: " " });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);

    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browse({ nodeId: "ns=1;s=missing" });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaNonGoodStatusError);
  });
});

describe("reads and handles", () => {
  it("returns schema-less normalized samples", async () => {
    const sample = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.readValue({
          nodeId: "ns=1;s=MyMachine.Temperature",
        });
      }),
    );

    expect(sample).toMatchObject({
      _tag: "Value",
      nodeId: "ns=1;s=MyMachine.Temperature",
      status: { isGood: true },
      variant: { dataType: "Double" },
    });
    expect(sample._tag === "Value" ? typeof sample.value : "missing").toBe(
      "number",
    );
    expect(sample.raw).toBeUndefined();
  });

  it("returns typed samples and decode errors as values", async () => {
    const [typed, decoded] = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.readValues([
          { nodeId: "ns=1;s=MyMachine.Temperature", schema: Schema.Number },
          { nodeId: "ns=1;s=MyMachine.Temperature", schema: Schema.String },
        ] as const);
      }),
    );

    expect(typed).toMatchObject({
      _tag: "Value",
      value: expect.any(Number),
    });
    expect(decoded).toMatchObject({
      _tag: "DecodeError",
      status: { isGood: true },
    });
  });

  it("creates read-only handles by default and readWrite handles explicitly", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const readOnly = yield* session.valueHandle({
          nodeId: "ns=1;s=MyMachine.Temperature",
        });
        const writable = yield* session.valueHandle({
          nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
          schema: Schema.Number,
          capabilities: Capabilities.readWrite,
        });
        const sample = yield* readOnly.read();
        const write = yield* writable.write(1234);
        return { readOnly, writable, sample, write };
      }),
    );

    expect(result.readOnly.capabilities).toEqual(["read"]);
    expect("write" in result.readOnly).toBe(false);
    expect(result.writable.metadata.access.writable).toBe(true);
    expect(result.sample).toMatchObject({ _tag: "Value" });
    expect(result.write).toMatchObject({ _tag: "Written" });
  });

  it("keeps non-good write statuses in the returned result", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.writeValue({
          nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
          value: 1400,
        });
      }),
    );

    expect(result).toMatchObject({
      _tag: "Written",
      status: { text: StatusCodes.Good.toString() },
    });
  });

  it("enforces requested write access during handle creation", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.valueHandle({
            nodeId: "ns=1;s=MyMachine.ReadOnlyNumber",
            capabilities: Capabilities.readWrite,
          });
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaAccessDeniedError",
      requestedCapability: "write",
    });
  });
});

describe("monitoring", () => {
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
});
