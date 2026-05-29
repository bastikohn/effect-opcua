# Recipes

These examples assume:

```ts
import { Duration, Effect, Schema, Stream } from "effect";
import { Opcua, OpcuaSession } from "@effect-opcua/client";
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
      codec: Opcua.schema(Schema.Literal("soft", "hard")),
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

Use `startup: "bestEffort"` when an HMI should start with the items accepted by
the server and inspect rejected items through `monitor.startup.failed`.

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

## Use structures

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
