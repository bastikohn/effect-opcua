import { Config, Duration, Effect, Schema, Stream } from "effect";
import { expect, it } from "vitest";

import * as Opcua from "../src/Opcua.js";
import * as OpcuaClient from "../src/OpcuaClient.js";
import * as OpcuaSession from "../src/OpcuaSession.js";

const expectVariableDefinitionTypes = (session: OpcuaSession.OpcuaSession) => {
  const writable = Opcua.variable({
    nodeId: "ns=1;s=Number",
    codec: Opcua.schema(Schema.Number),
    access: "readWrite",
  });
  const readOnly = Opcua.variable({
    nodeId: "ns=1;s=ReadOnly",
    codec: Opcua.schema(Schema.Number),
  });

  session.read(readOnly);
  session.write(writable, 123);

  // @ts-expect-error value must match the definition codec type
  session.write(writable, "wrong");

  // @ts-expect-error read-only definitions are not writable
  session.write(readOnly, 123);

  OpcuaSession.read(readOnly);
  OpcuaSession.write(writable, 123);
};

void expectVariableDefinitionTypes;

const expectKeyedBatchTypes = () => {
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
      const value: number = snapshot.temperature.value;
      void value;
    }

    yield* OpcuaSession.writeMany({
      speedSetpoint: [SpeedSetpoint, 123],
    } as const);

    yield* OpcuaSession.writeMany({
      // @ts-expect-error write values must match the definition codec type
      speedSetpoint: [SpeedSetpoint, "wrong"],
    } as const);

    yield* OpcuaSession.writeMany({
      // @ts-expect-error read-only definitions are not writable
      readOnly: [ReadOnly, 1],
    } as const);
  });
};

void expectKeyedBatchTypes;

const expectMethodTypes = (session: OpcuaSession.OpcuaSession) => {
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

  session.call(start, { StartSpeed: 1, Force: true });

  // @ts-expect-error input values must match the method definition
  session.call(start, { StartSpeed: "wrong", Force: true });
};

void expectMethodTypes;

const expectCallManyTypes = () => {
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

  OpcuaSession.callMany({ reset: [Reset, {}] } as const);

  OpcuaSession.callMany({
    // @ts-expect-error no-input methods require explicit {}
    reset: [Reset],
  } as const);

  OpcuaSession.callMany({
    echo: [Echo, { Value: 1 }],
  } as const);

  OpcuaSession.callMany({
    echo: [
      Echo,
      // @ts-expect-error input values must match the method definition
      { Value: "wrong" },
    ],
  } as const);
};

void expectCallManyTypes;

const expectMonitorTypes = (session: OpcuaSession.OpcuaSession) => {
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
          const key: "temperature" | "pressure" = sample.key;
          void key;
          if (sample._tag === "Value" && sample.key === "temperature") {
            const value: number = sample.value;
            void value;
          }
          if (sample._tag === "Value" && sample.key === "pressure") {
            const value: boolean = sample.value;
            void value;
          }
        }),
      ),
    );

    yield* subscription.monitor({ temperature: Temperature } as const, {
      ...options,
      overrides: {
        // @ts-expect-error override keys must exist in the item dictionary
        missing: { queueSize: 2 },
      },
    });

    yield* subscription.monitor(
      { temperature: Temperature } as const,
      // @ts-expect-error startup is required
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

    yield* subscription.monitor(
      { temperature: Temperature } as const,
      // @ts-expect-error validation is required
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
};

void expectMonitorTypes;

const expectLayerConfigTypes = () => {
  OpcuaClient.layerConfig({
    endpointUrl: Config.string("OPCUA_ENDPOINT_URL"),
  });

  OpcuaClient.layerConfig({
    endpointUrl: Config.string("OPCUA_ENDPOINT_URL"),
    clientOptions: {},
  });

  OpcuaClient.layerConfig({
    endpointUrl: Config.string("OPCUA_ENDPOINT_URL"),
    clientOptions: Config.succeed({}),
  });

  // @ts-expect-error endpointUrl must be a Config value
  OpcuaClient.layerConfig({ endpointUrl: "opc.tcp://localhost:4840" });
};

void expectLayerConfigTypes;

it("keeps compile-time API checks", () => {
  expect(true).toBe(true);
});
