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

Subscriptions expose one primitive, `monitor`; `watch` is a scoped stream
wrapper over it.

`monitor.add` is best-effort and returns per-node startup results as data.
`watch` requires every initial item to start cleanly and fails the stream with
`OpcuaMonitorCreateError` when it cannot.

```ts
const subscription =
  yield *
  session.subscription({
    publishingInterval: Duration.millis(100),
  });

const samples = subscription.watch([Temperature] as const, {
  samplingInterval: Duration.millis(50),
  queueSize: 5,
  discardOldest: true,
  clientBuffer: Opcua.BufferPolicy.latest(),
  filter: Opcua.MonitorFilter.statusValue(),
});
```

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
