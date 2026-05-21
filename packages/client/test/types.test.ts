import { Config, Duration, Effect, Schema, Stream } from "effect";
import { expect, it } from "vitest";

import {
  Opcua,
  OpcuaClient,
  type MethodHandle,
  type OpcuaSession,
  type VariableHandle,
  type WritableVariableHandle,
} from "../src/index.js";

const expectVariableHandleTypes = (
  session: OpcuaSession,
  writable: WritableVariableHandle<number>,
  readOnly: VariableHandle<string, number, "read">,
) => {
  writable.write(123);

  // @ts-expect-error value must match the handle codec type
  writable.write("wrong");

  // @ts-expect-error read-only handles do not expose write
  readOnly.write(123);

  session.handle(
    Opcua.variable({
      nodeId: "ns=1;s=Number",
      codec: Opcua.schema(Schema.Number),
    }),
  );
};

void expectVariableHandleTypes;

const expectBatchTypes = (
  numberHandle: WritableVariableHandle<number>,
  booleanHandle: WritableVariableHandle<boolean>,
) => {
  Opcua.writeAll([
    { handle: numberHandle, value: 123 },
    { handle: booleanHandle, value: false },
  ] as const);

  Opcua.writeAll([
    {
      handle: numberHandle,
      // @ts-expect-error write values must match their handle type
      value: "wrong",
    },
  ] as const);
};

void expectBatchTypes;

const expectMethodTypes = (session: OpcuaSession) => {
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

  session.handle(start);
};

void expectMethodTypes;

const expectCallAllTypes = (
  handle: MethodHandle<
    { readonly Value: number },
    { readonly Accepted: boolean },
    "ns=1;s=Object",
    "ns=1;s=Method"
  >,
) => {
  Opcua.callAll([{ handle, input: { Value: 1 } }] as const);

  Opcua.callAll([
    {
      handle,
      // @ts-expect-error input values must match their method handle type
      input: { Value: "wrong" },
    },
  ] as const);
};

void expectCallAllTypes;

const expectMonitorTypes = (
  session: OpcuaSession,
  readOnly: VariableHandle<string, number, "read">,
) => {
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
    const subscription = yield* session.subscription({
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

    // @ts-expect-error handles are not accepted as monitor inputs
    yield* subscription.monitor({ temperature: readOnly }, options);

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

    yield* subscription.monitor(
      { temperature: Temperature } as const,
      // @ts-expect-error server-load options are required
      {
        startup: "strict" as const,
        validation: "strict" as const,
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
