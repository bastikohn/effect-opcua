import { Duration, Effect, Layer, Schema, Stream } from "effect";
import { describe, expect, it } from "tstyche";

import {
  Opcua,
  OpcuaClient,
  OpcuaError,
  OpcuaSession,
} from "@effect-opcua/client";
import {
  StatusCodes,
  makeNodeClassMask,
} from "@effect-opcua/client/node-opcua";

const Temperature = Opcua.variable({
  nodeId: "ns=2;s=Machine.Temperature",
  codec: Opcua.schema(Schema.Number),
});

const Setpoint = Opcua.variable({
  nodeId: "ns=2;s=Machine.Setpoint",
  codec: Opcua.schema(Schema.Number),
  access: "readWrite",
});

const Reset = Opcua.method({
  objectId: "ns=2;s=Machine",
  methodId: "ns=2;s=Machine.Reset",
  input: {
    mode: Opcua.arg({
      name: "Mode",
      codec: Opcua.schema(Schema.Literals(["soft", "hard"])),
    }),
  },
  output: {
    ok: Opcua.arg({
      name: "Ok",
      codec: Opcua.schema(Schema.Boolean),
    }),
  },
});

const MainLayer = OpcuaSession.layer({
  batching: {
    readLimits: { maxNodesPerRequest: 250, maxConcurrentRequests: 1 },
    writeLimits: { maxNodesPerRequest: 100, maxConcurrentRequests: 1 },
    callLimits: { maxNodesPerRequest: 50, maxConcurrentRequests: 1 },
  },
}).pipe(
  Layer.provide(
    OpcuaClient.layer({
      endpointUrl: "opc.tcp://localhost:4840",
      clientOptions: { endpointMustExist: false },
    }),
  ),
);

declare const documentedError: unknown;

describe("README public snippets", () => {
  it("checks the documented imports and core operations", () => {
    const program = Effect.gen(function* () {
      const current = yield* OpcuaSession.read(Temperature);
      const written = yield* OpcuaSession.write(Setpoint, 42);
      const reset = yield* OpcuaSession.call(Reset, { mode: "soft" });
      const snapshot = yield* OpcuaSession.readMany(
        {
          temperature: Temperature,
          setpoint: Setpoint,
        },
        { validation: "strict" },
      );
      const writes = yield* OpcuaSession.writeMany({
        setpoint: [Setpoint, 42],
      } as const);
      const calls = yield* OpcuaSession.callMany({
        reset: [Reset, { mode: "soft" }],
      } as const);

      return { current, written, reset, snapshot, writes, calls };
    });

    Effect.scoped(program).pipe(Effect.provide(MainLayer));

    expect(OpcuaSession.read).type.toBeCallableWith(Temperature);
    expect(OpcuaSession.write).type.toBeCallableWith(Setpoint, 42);
    expect(OpcuaSession.write).type.not.toBeCallableWith(Setpoint, "wrong");
    expect(StatusCodes.Good.isGood()).type.toBe<boolean>();
  });

  it("checks browse and monitoring snippets", () => {
    const program = Effect.gen(function* () {
      const children = yield* OpcuaSession.browseChildren("ns=2;s=Machine", {
        nodeClassMask: makeNodeClassMask("Variable"),
      });

      const subscription = yield* OpcuaSession.makeSubscription({
        publishingInterval: Duration.millis(100),
        maxNotificationsPerPublish: 0,
        priority: 0,
      });

      const monitor = yield* subscription.monitor(
        { temperature: Temperature },
        {
          startup: "strict",
          validation: "strict",
          samplingInterval: Duration.millis(250),
          queueSize: 1,
          discardOldest: true,
          filter: Opcua.MonitorFilter.statusValue(),
          timestamps: "source",
          clientBuffer: Opcua.BufferPolicy.latest(),
        },
      );

      yield* monitor.samples.pipe(Stream.take(1), Stream.runDrain);

      return { children, monitor };
    });

    Effect.scoped(program).pipe(Effect.provide(MainLayer));

    expect(OpcuaSession.makeSubscription).type.toBeCallableWith({
      publishingInterval: Duration.millis(100),
      maxNotificationsPerPublish: 0,
      priority: 255,
    });
  });

  it("checks ExtensionObject and error-handling snippets", () => {
    const ScanSettings = Opcua.structure({
      name: "ScanSettings",
      dataTypeId: "ns=1;i=3010",
      schema: Schema.Struct({
        duration: Schema.Number,
        cycles: Schema.Number,
        dataAvailable: Schema.Boolean,
      }),
    });
    const Settings = Opcua.variable({
      nodeId: "ns=1;s=MyMachine.ScanSettings",
      codec: ScanSettings,
      access: "readWrite",
    });
    const settings: Opcua.CodecType<typeof ScanSettings> = {
      duration: 1000,
      cycles: 5,
      dataAvailable: true,
    };

    expect(OpcuaSession.write).type.toBeCallableWith(Settings, settings);
    expect(OpcuaSession.write).type.not.toBeCallableWith(Settings, {
      duration: "wrong",
      cycles: 5,
      dataAvailable: true,
    });

    if (OpcuaError.isOpcuaError(documentedError)) {
      switch (documentedError.reason._tag) {
        case "Connect":
        case "SessionCreate":
        case "Configuration":
        case "Service":
        case "MonitorStartup":
          break;
      }
    }
  });
});
