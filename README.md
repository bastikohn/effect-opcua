# effect-opcua

Local-first workspace for an Effect v4 OPC-UA client wrapper around node-opcua.

## Packages

- `@effect-opcua/client`

## Examples

- `@effect-opcua/demo-server`
- `@effect-opcua/tui`

## Definitions And Direct Operations

Declare OPC-UA nodes as pure definitions. The session API takes those
definitions directly.

```ts
import { Effect, Schema } from "effect";
import { Opcua } from "@effect-opcua/client";
import { OpcuaSession } from "@effect-opcua/client/OpcuaSession";

const Temperature = Opcua.variable({
  nodeId: "ns=2;s=Machine.Temperature",
  codec: Opcua.schema(Schema.Number),
});

const Pressure = Opcua.variable({
  nodeId: "ns=2;s=Machine.Pressure",
  codec: Opcua.schema(Schema.Number),
});

const Speed = Opcua.variable({
  nodeId: "ns=2;s=Machine.Speed",
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
  const session = yield* OpcuaSession;

  const current = yield* session.read(Temperature);
  const written = yield* session.write(Setpoint, 42);
  const resetResult = yield* session.call(Reset, { mode: "soft" });

  return { current, written, resetResult };
});
```

Provide `OpcuaSession.layer()` with an `OpcuaClient.layer(...)` to connect the
program to an endpoint:

```ts
import { Effect, Layer } from "effect";
import { OpcuaClient } from "@effect-opcua/client";
import * as OpcuaSession from "@effect-opcua/client/OpcuaSession";

const MainLayer = OpcuaSession.layer({
  batching: {
    read: { maxNodesPerRead: 250, maxConcurrentRequests: 1 },
    write: { maxNodesPerWrite: 250, maxConcurrentRequests: 1 },
    call: { maxMethodsPerCall: 50, maxConcurrentRequests: 1 },
  },
}).pipe(
  Layer.provideMerge(
    OpcuaClient.layer({
      endpointUrl: "opc.tcp://localhost:4840",
      clientOptions: { endpointMustExist: false },
    }),
  ),
);

await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(MainLayer)));
```

The module-level helpers are the same operations lifted into the Effect
environment:

```ts
const helperProgram = Effect.gen(function* () {
  const current = yield* OpcuaSession.read(Temperature);
  const written = yield* OpcuaSession.write(Setpoint, 42);
  const resetResult = yield* OpcuaSession.call(Reset, { mode: "soft" });

  return { current, written, resetResult };
});
```

Keyed batch APIs are the primary HMI surface. They are available on the session
and as module-level helpers, accept definition dictionaries, issue OPC-UA batch
service calls, and return results by key:

```ts
const batchProgram = Effect.gen(function* () {
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

  const called = yield* OpcuaSession.callMany({
    reset: [Reset, { mode: "soft" }],
  });

  return { snapshot, written, called };
});
```

Per-call `service` options remain available when one batch needs a smaller
chunk size or a different concurrency level than the session default.

## Structures

Define OPC-UA structures backed by `ExtensionObject` values, then use the same
codec for variables, method arguments, and monitoring.

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

const ScanSettingsQueue = Opcua.structureArray(ScanSettings);
```

```ts
const Settings = Opcua.variable({
  nodeId: "ns=1;s=MyMachine.ScanSettings",
  codec: ScanSettings,
  access: "readWrite",
});

const structureProgram = Effect.gen(function* () {
  yield* OpcuaSession.write(Settings, {
    duration: 1000,
    cycles: 5,
    dataAvailable: true,
  });

  const sample = yield* OpcuaSession.read(Settings);

  return sample;
});
```

```ts
const ApplyScanSettings = Opcua.method({
  objectId: "ns=1;s=MyMachine",
  methodId: "ns=1;s=MyMachine.ApplyScanSettings",
  input: {
    Settings: Opcua.arg({ codec: ScanSettings }),
    Queue: Opcua.arg({ codec: ScanSettingsQueue }),
  },
});
```

## Monitoring

Subscriptions expose one scoped, static `monitor(items, options)` primitive.
Inputs are named variable-definition dictionaries, startup behavior is explicit,
and samples are keyed by item name.

```ts
import { Duration, Effect, Stream } from "effect";
import { Opcua } from "@effect-opcua/client";
import { OpcuaSession } from "@effect-opcua/client/OpcuaSession";

const monitorProgram = Effect.gen(function* () {
  const session = yield* OpcuaSession;

  const subscription = yield* session.makeSubscription({
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

      samplingInterval: Duration.millis(50),
      queueSize: 5,
      discardOldest: true,
      filter: Opcua.MonitorFilter.statusValue(),
      timestamps: "source",

      clientBuffer: Opcua.BufferPolicy.latest(),
    },
  );

  yield* monitor.samples.pipe(
    Stream.runForEach((sample) =>
      Effect.sync(() => {
        console.log(sample.key, sample.nodeId, sample._tag);
      }),
    ),
  );
});
```

Use `startup: "bestEffort"` when an HMI should come up with the tags the server
accepted and inspect `monitor.startup.failed` for rejected items:

```ts
const bestEffortMonitorProgram = Effect.gen(function* () {
  const session = yield* OpcuaSession;
  const subscription = yield* session.makeSubscription({
    publishingInterval: Duration.millis(100),
  });

  const monitor = yield* subscription.monitor(
    {
      temperature: Temperature,
      pressure: Pressure,
      speed: Speed,
    },
    {
      startup: "bestEffort",
      validation: "none",

      samplingInterval: Duration.millis(250),
      queueSize: 1,
      discardOldest: true,
      filter: Opcua.MonitorFilter.statusValue(),
      timestamps: "source",

      clientBuffer: Opcua.BufferPolicy.latest(),
      overrides: {
        speed: {
          samplingInterval: Duration.millis(50),
        },
      },
      create: {
        maxItemsPerRequest: 250,
        maxConcurrentRequests: 1,
      },
    },
  );

  return monitor.startup;
});
```

Duplicate NodeIds inside one monitor are rejected locally with an `OpcuaError`
whose `reason._tag` is `"MonitorConfiguration"`. `validation: "none"` skips
metadata pre-reads and lets server create results plus runtime decode events
report per-tag problems. `validation: "access"` batches metadata reads using
`create.maxItemsPerRequest`; `validation: "strict"` validates one item at a time
and may be slow for large tag sets.

## Browsing

Browsing stays on the session service because it is not definition-based:

```ts
import { Effect } from "effect";
import { OpcuaSession } from "@effect-opcua/client/OpcuaSession";
import { makeNodeClassMask } from "@effect-opcua/client/node-opcua";

const browseProgram = Effect.gen(function* () {
  const session = yield* OpcuaSession;

  const children = yield* session.browseChildren("ns=1;s=MyMachine", {
    nodeClassMask: makeNodeClassMask("Variable"),
  });

  const page = yield* session.browse({
    nodeId: "ns=1;s=MyMachine",
    includeRaw: true,
  });

  return { children, page };
});
```

## Unsafe Access

Raw node-opcua objects are exposed only through `unsafeRaw` fields and
`includeRaw` options. Node-opcua types/constants are available from the explicit
subpath:

```ts
import { DataType, StatusCodes } from "@effect-opcua/client/node-opcua";
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```
