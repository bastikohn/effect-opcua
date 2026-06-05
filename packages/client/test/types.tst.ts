import { Config, Duration, Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "tstyche";

import { Opcua, OpcuaClient, OpcuaSession } from "@effect-opcua/client";

declare const session: OpcuaSession.OpcuaSessionService;

describe("Opcua", () => {
  it("checks variable definition types", () => {
    const writable = Opcua.variable({
      nodeId: "ns=1;s=Number",
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    });
    const readOnly = Opcua.variable({
      nodeId: "ns=1;s=ReadOnly",
      codec: Opcua.schema(Schema.Number),
    });

    expect(session.read).type.toBeCallableWith(readOnly);
    expect(session.write).type.toBeCallableWith(writable, 123);
    expect(session.write).type.not.toBeCallableWith(writable, "wrong");
    expect(session.write).type.not.toBeCallableWith(readOnly, 123);

    expect(OpcuaSession.read).type.toBeCallableWith(readOnly);
    expect(OpcuaSession.write).type.toBeCallableWith(writable, 123);
  });

  it("checks structure definition types", () => {
    const ScanSettings = Opcua.structure({
      name: "ScanSettings",
      dataTypeId: "ns=1;i=3010",
      schema: Schema.Struct({
        duration: Schema.Number,
        cycles: Schema.Number,
        dataAvailable: Schema.Boolean,
      }),
    });
    const ScanSettingsQueue = Opcua.structureArray(ScanSettings);
    const Settings = Opcua.variable({
      nodeId: "ns=1;s=ScanSettings",
      codec: ScanSettings,
      access: "readWrite",
    });
    const Queue = Opcua.variable({
      nodeId: "ns=1;s=ScanSettingsQueue",
      codec: ScanSettingsQueue,
      access: "readWrite",
    });
    const Echo = Opcua.method({
      objectId: "ns=1;s=MyMachine",
      methodId: "ns=1;s=MyMachine.EchoScan",
      input: {
        Settings: Opcua.arg({ codec: ScanSettings }),
        Queue: Opcua.arg({ codec: ScanSettingsQueue }),
      },
    });

    const settings: Opcua.CodecType<typeof ScanSettings> = {
      duration: 1,
      cycles: 2,
      dataAvailable: true,
    };
    const queue: Opcua.CodecType<typeof ScanSettingsQueue> = [settings];

    expect(session.write).type.toBeCallableWith(Settings, settings);
    expect(session.write).type.toBeCallableWith(Queue, queue);
    expect(session.call).type.toBeCallableWith(Echo, {
      Settings: settings,
      Queue: queue,
    });

    expect(session.write).type.not.toBeCallableWith(Settings, {
      duration: "wrong",
      cycles: 2,
      dataAvailable: true,
    });
    expect(session.write).type.not.toBeCallableWith(Queue, settings);
    expect(Opcua.structureArray).type.not.toBeCallableWith(ScanSettingsQueue);
  });

  it("checks keyed batch types", () => {
    const Temperature = Opcua.variable({
      nodeId: "ns=1;s=Temperature",
      codec: Opcua.schema(Schema.Number),
    });
    const SpeedSetpoint = Opcua.variable({
      nodeId: "ns=1;s=SpeedSetpoint",
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    });
    const ReadOnly = Opcua.variable({
      nodeId: "ns=1;s=ReadOnly",
      codec: Opcua.schema(Schema.Number),
    });

    Effect.gen(function* () {
      const snapshot = yield* OpcuaSession.readMany({
        temperature: Temperature,
      } as const);
      if (snapshot.temperature._tag === "Value") {
        expect(snapshot.temperature.value).type.toBe<number>();
      }

      yield* OpcuaSession.writeMany({
        speedSetpoint: [SpeedSetpoint, 123],
      } as const);
    });

    expect(OpcuaSession.writeMany).type.not.toBeCallableWith({
      speedSetpoint: [SpeedSetpoint, "wrong"],
    } as const);
    expect(OpcuaSession.writeMany).type.not.toBeCallableWith({
      readOnly: [ReadOnly, 1],
    } as const);
  });

  it("checks method types", () => {
    const start = Opcua.method({
      objectId: "ns=1;s=MyMachine",
      methodId: "ns=1;s=MyMachine.Start",
      input: {
        StartSpeed: Opcua.arg({ codec: Opcua.schema(Schema.Number) }),
        Force: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
      },
      output: {
        Accepted: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
      },
    });

    expect(session.call).type.toBeCallableWith(start, {
      StartSpeed: 1,
      Force: true,
    });
    expect(session.call).type.not.toBeCallableWith(start, {
      StartSpeed: "wrong",
      Force: true,
    });
  });

  it("checks callMany types", () => {
    const Reset = Opcua.method({
      objectId: "ns=1;s=Object",
      methodId: "ns=1;s=Reset",
    });
    const Echo = Opcua.method({
      objectId: "ns=1;s=Object",
      methodId: "ns=1;s=Echo",
      input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
      output: { Accepted: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }) },
    });

    expect(OpcuaSession.callMany).type.toBeCallableWith({
      reset: [Reset, {}],
    } as const);
    expect(OpcuaSession.callMany).type.not.toBeCallableWith({
      reset: [Reset],
    } as const);
    expect(OpcuaSession.callMany).type.toBeCallableWith({
      echo: [Echo, { Value: 1 }],
    } as const);
    expect(OpcuaSession.callMany).type.not.toBeCallableWith({
      echo: [Echo, { Value: "wrong" }],
    } as const);
  });

  it("checks monitor types", () => {
    const Temperature = Opcua.variable({
      nodeId: "ns=1;s=Temperature",
      codec: Opcua.schema(Schema.Number),
    });
    const Pressure = Opcua.variable({
      nodeId: "ns=1;s=Pressure",
      codec: Opcua.schema(Schema.Boolean),
    });
    const options = {
      startup: "strict" as const,
      validation: "strict" as const,
      samplingInterval: Duration.millis(250),
      queueSize: 1,
      discardOldest: true,
      filter: Opcua.MonitorFilter.statusValue(),
      timestamps: "source" as const,
      clientBuffer: Opcua.BufferPolicy.latest(),
    };

    Effect.gen(function* () {
      const subscription = yield* session.makeSubscription({
        publishingInterval: Duration.millis(100),
      });

      expect(subscription.monitor).type.toBeCallableWith(
        { temperature: Temperature, pressure: Pressure } as const,
        {
          ...options,
          overrides: {
            pressure: { samplingInterval: Duration.millis(50) },
          },
        },
      );

      const monitor = yield* subscription.monitor(
        { temperature: Temperature, pressure: Pressure } as const,
        {
          ...options,
          overrides: {
            pressure: { samplingInterval: Duration.millis(50) },
          },
        },
      );

      yield* monitor.samples.pipe(
        Stream.runForEach((sample) =>
          Effect.sync(() => {
            expect(sample.key).type.toBe<"temperature" | "pressure">();
            if (sample._tag === "Value" && sample.key === "temperature") {
              expect(sample.value).type.toBe<number>();
            }
            if (sample._tag === "Value" && sample.key === "pressure") {
              expect(sample.value).type.toBe<boolean>();
            }
          }),
        ),
      );

      expect(subscription.monitor).type.not.toBeCallableWith(
        { temperature: Temperature } as const,
        {
          ...options,
          overrides: {
            missing: { queueSize: 2 },
          },
        },
      );
      expect(subscription.monitor).type.not.toBeCallableWith(
        { temperature: Temperature } as const,
        {
          validation: "strict" as const,
          samplingInterval: Duration.millis(250),
          queueSize: 1,
          discardOldest: true,
          filter: Opcua.MonitorFilter.statusValue(),
          timestamps: "source" as const,
          clientBuffer: Opcua.BufferPolicy.latest(),
        },
      );
      expect(subscription.monitor).type.not.toBeCallableWith(
        { temperature: Temperature } as const,
        {
          startup: "strict" as const,
          samplingInterval: Duration.millis(250),
          queueSize: 1,
          discardOldest: true,
          filter: Opcua.MonitorFilter.statusValue(),
          timestamps: "source" as const,
          clientBuffer: Opcua.BufferPolicy.latest(),
        },
      );
    });
  });

  it("checks layer config types", () => {
    expect(OpcuaClient.layerConfig).type.toBeCallableWith(
      Config.all({
        endpointUrl: Config.string("OPCUA_ENDPOINT_URL"),
      }),
    );
    expect(OpcuaClient.layerConfig).type.toBeCallableWith(
      Config.all({
        endpointUrl: Config.string("OPCUA_ENDPOINT_URL"),
        clientOptions: Config.succeed({}),
      }),
    );
    expect(OpcuaClient.layerConfig).type.not.toBeCallableWith({
      endpointUrl: Config.string("OPCUA_ENDPOINT_URL"),
    });
    expect(OpcuaClient.layerConfig).type.not.toBeCallableWith({
      endpointUrl: "opc.tcp://localhost:4840",
    });
  });
});
