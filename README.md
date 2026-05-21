# effect-opcua

Local-first workspace for an Effect v4 OPC-UA client wrapper around node-opcua.

## Packages

- `@effect-opcua/client`

## Examples

- `@effect-opcua/demo-server`
- `@effect-opcua/tui`

## Definitions And Handles

Declare OPC-UA nodes as pure definitions, then ask the session for handles.

```ts
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

const temperature = yield * session.handle(Temperature);
const setpoint = yield * session.handle(Setpoint);
const reset = yield * session.handle(Reset);

const current = yield * temperature.read();
const written = yield * setpoint.write(42);
const resetResult = yield * reset.call({ mode: "soft" });
```

Batch helpers operate on handles:

```ts
const [temperature, pressure] =
  yield * session.handleAll([Temperature, Pressure] as const);

const samples = yield * Opcua.readAll([temperature, pressure] as const);
```

## Structures

Define OPC-UA `ExtensionObject` structures, wrap them in the shared codec, and
use the same codec for variables, method arguments, and monitoring.

```ts
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
const ScanSettingsQueue = Opcua.structureArray(
  Opcua.Structure.array(ScanSettingsSpec),
);
```

```ts
const settings =
  yield *
  session.handle(
    Opcua.variable({
      nodeId: "ns=1;s=MyMachine.ScanSettings",
      codec: ScanSettings,
      access: "readWrite",
    }),
  );

yield *
  settings.write({
    duration: 1000,
    cycles: 5,
    dataAvailable: true,
  });
```

## Monitoring

Subscriptions expose one scoped, static `monitor(items, options)` primitive.
Inputs are named variable-definition dictionaries, startup behavior is explicit,
and samples are keyed by item name.

```ts
const subscription =
  yield *
  session.subscription({
    publishingInterval: Duration.millis(100),
  });

const monitor =
  yield *
  subscription.monitor(
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

yield *
  monitor.samples.pipe(
    Stream.runForEach((sample) =>
      Effect.sync(() => {
        console.log(sample.key, sample.nodeId, sample._tag);
      }),
    ),
  );
```

Use `startup: "bestEffort"` when an HMI should come up with the tags the server
accepted and inspect `monitor.startup.failed` for rejected items:

```ts
const monitor =
  yield *
  subscription.monitor(
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
```

Duplicate NodeIds inside one monitor are rejected locally with
`OpcuaMonitorConfigurationError`. `validation: "none"` skips metadata pre-reads
and lets server create results plus runtime decode events report per-tag
problems.

## Unsafe Access

Raw node-opcua objects are exposed only through `unsafeRaw`, and node-opcua
types/constants are available from the explicit subpath:

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
