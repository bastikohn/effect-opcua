# Recipes

These examples assume:

```ts
import { Duration, Effect, Layer, Schema, Stream } from "effect";
import {
  Opcua,
  OpcuaClient,
  OpcuaError,
  OpcuaSession,
} from "@effect-opcua/client";
import { makeNodeClassMask } from "@effect-opcua/client/node-opcua";

const Temperature = Opcua.variable({
  nodeId: "ns=2;s=Machine.Temperature",
  codec: Opcua.schema(Schema.Number),
});

const Pressure = Opcua.variable({
  nodeId: "ns=2;s=Machine.Pressure",
  codec: Opcua.schema(Schema.Number),
});

const Setpoint = Opcua.variable({
  nodeId: "ns=2;s=Machine.Setpoint",
  codec: Opcua.schema(Schema.Number),
  access: "readWrite",
});
```

## Connect with a profile

Keep connection settings in a layer factory so application programs only depend
on `OpcuaSession`:

```ts
export const makeOpcuaLayer = (endpointUrl: string) =>
  OpcuaSession.layer({
    batching: {
      read: { maxNodesPerRead: 250, maxConcurrentRequests: 1 },
      write: { maxNodesPerWrite: 100, maxConcurrentRequests: 1 },
      call: { maxMethodsPerCall: 50, maxConcurrentRequests: 1 },
    },
  }).pipe(
    Layer.provide(
      OpcuaClient.layer({
        endpointUrl,
        clientOptions: { endpointMustExist: false },
      }),
    ),
  );
```

Use `Effect.scoped(program).pipe(Effect.provide(makeOpcuaLayer(endpointUrl)))`
so client, session, subscription, and monitor finalizers run on exit or
interruption.

## Read one value

```ts
const program = Effect.gen(function* () {
  const sample = yield* OpcuaSession.read(Temperature);

  if (sample._tag === "Value") {
    console.log(sample.value);
  }
});
```

## Write one value

```ts
const program = Effect.gen(function* () {
  const written = yield* OpcuaSession.write(Setpoint, 42);

  if (written._tag !== "Written") {
    console.log(written.status.name);
  }
});
```

## Read and write batches

Keyed batches return results by the same keys:

```ts
const program = Effect.gen(function* () {
  const snapshot = yield* OpcuaSession.readMany(
    {
      temperature: Temperature,
      pressure: Pressure,
    },
    { validation: "strict" },
  );

  const written = yield* OpcuaSession.writeMany({
    setpoint: [Setpoint, 42],
  });

  return { snapshot, written };
});
```

Use per-call service options when one batch needs different chunking or
concurrency:

```ts
const program = Effect.gen(function* () {
  const snapshot = yield* OpcuaSession.readMany(
    { temperature: Temperature, pressure: Pressure },
    {
      service: {
        maxNodesPerRead: 100,
        maxConcurrentRequests: 2,
      },
    },
  );

  return snapshot;
});
```

## Call a method

```ts
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

const program = Effect.gen(function* () {
  const reset = yield* OpcuaSession.call(Reset, { mode: "soft" });
  return reset;
});
```

Use `callMany` for keyed method batches:

```ts
const program = Effect.gen(function* () {
  const called = yield* OpcuaSession.callMany({
    reset: [Reset, { mode: "soft" }],
  });

  return called;
});
```

## Handle errors

OPC UA service statuses are usually returned as result data. Failed Effects are
reserved for configuration, connection/session lifecycle, service call,
access-validation, encode/decode, and monitor failures:

```ts
try {
  await Effect.runPromise(
    Effect.scoped(program).pipe(
      Effect.provide(makeOpcuaLayer("opc.tcp://localhost:4840")),
    ),
  );
} catch (error) {
  if (OpcuaError.isOpcuaError(error)) {
    switch (error.reason._tag) {
      case "Connect":
      case "SessionCreate":
      case "Configuration":
      case "Service":
      case "MonitorStartup":
        console.error(error.reason);
        break;
    }
  }
}
```

## Monitor values

```ts
const program = Effect.gen(function* () {
  const subscription = yield* OpcuaSession.makeSubscription({
    publishingInterval: Duration.millis(100),
  });

  const monitor = yield* subscription.monitor(
    {
      temperature: Temperature,
      pressure: Pressure,
    },
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

  yield* monitor.samples.pipe(
    Stream.runForEach((sample) =>
      Effect.sync(() => {
        console.log(sample.key, sample._tag);
      }),
    ),
  );
});
```

Use `startup: "strict"` when all requested items must be active. Use
`startup: "bestEffort"` when an HMI should start with the items accepted by the
server and inspect rejected items through `monitor.startup.failed`. Monitor
startup cleans up created groups on interruption or strict startup failure.

## Browse children

```ts
const program = Effect.gen(function* () {
  const children = yield* OpcuaSession.browseChildren("ns=2;s=Machine", {
    nodeClassMask: makeNodeClassMask("Variable"),
  });

  return children;
});
```

Use `browse` and `browseNext` directly when you need explicit continuation
control.

## Use ExtensionObject structures

```ts
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

const program = Effect.gen(function* () {
  yield* OpcuaSession.write(Settings, {
    duration: 1000,
    cycles: 5,
    dataAvailable: true,
  });
});
```

The same structure codec can be used for variables, method inputs, method
outputs, and monitored samples.

Structure codecs need server metadata for the declared data type. The runtime
uses `session.extractNamespaceDataType()` and `session.constructExtensionObject`
through node-opcua. Scalar structures and one-dimensional arrays are supported;
structure matrices, missing metadata, and opaque dynamic structures are not
encoded by explicit structure codecs. Use generated structures when possible,
or `Opcua.dynamic()` while exploring.
