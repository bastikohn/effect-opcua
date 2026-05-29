# Core concepts

## Definitions

The public API centers on definitions:

- `Opcua.variable(...)` describes a variable node.
- `Opcua.method(...)` describes a method node.
- `Opcua.arg(...)` describes method input and output arguments.
- `Opcua.structure(...)` and `Opcua.structureArray(...)` describe
  `ExtensionObject` payloads.

Definitions are immutable data. The session API accepts them directly:

```ts
const program = Effect.gen(function* () {
  const result = yield* OpcuaSession.read(Temperature);
  const write = yield* OpcuaSession.write(Setpoint, 42);
  const call = yield* OpcuaSession.call(Reset, { mode: "soft" });

  return { result, write, call };
});
```

## Codecs

Codecs translate between node-opcua `Variant` values and application values.

- `Opcua.dynamic()` uses normalized dynamic OPC UA values. It is the default.
- `Opcua.schema(schema)` runs synchronous Effect `Schema` encode/decode.
- `Opcua.structure(...)` reads and writes scalar `ExtensionObject` structures.
- `Opcua.structureArray(...)` reads and writes one-dimensional structure arrays.

Use schema codecs when the server contract is known:

```ts
const Speed = Opcua.variable({
  nodeId: "ns=2;s=Machine.Speed",
  codec: Opcua.schema(Schema.Number),
});
```

Use dynamic codecs while exploring an address space or when a value has no fixed
application model yet.

## Access

Variables are read-only unless `access` is set:

```ts
const ReadOnly = Opcua.variable({
  nodeId: "ns=2;s=Machine.ReadOnly",
  codec: Opcua.schema(Schema.Number),
});

const Writable = Opcua.variable({
  nodeId: "ns=2;s=Machine.Setpoint",
  codec: Opcua.schema(Schema.Number),
  access: "readWrite",
});
```

The TypeScript API rejects writes to read-only definitions. At runtime the
session also validates OPC UA access metadata before writes.

## Layers and services

The client and session are Effect services:

```ts
const MainLayer = OpcuaSession.layer({
  batching: {
    read: { maxNodesPerRead: 250, maxConcurrentRequests: 1 },
  },
}).pipe(
  Layer.provide(
    OpcuaClient.layer({
      endpointUrl: "opc.tcp://localhost:4840",
    }),
  ),
);
```

Use module-level helpers when a program should read from the Effect environment:

```ts
const program = Effect.gen(function* () {
  const current = yield* OpcuaSession.read(Temperature);
  return current;
});
```

Use the session service directly when several operations should share the same
session value:

```ts
const program = Effect.gen(function* () {
  const session = yield* OpcuaSession.OpcuaSession;
  const current = yield* session.read(Temperature);
  return current;
});
```

## Result shapes

Reads return one of:

- `Value`: decoded value and a good status.
- `NonGoodStatus`: OPC UA returned a non-good status.
- `DecodeError`: transport and status were usable, but the codec could not
  decode the value.

Writes return one of:

- `Written`: OPC UA returned a good write status.
- `NonGoodStatus`: OPC UA returned a non-good write status.

Method calls return one of:

- `Called`: method status was good and outputs decoded.
- `NonGoodStatus`: method status was non-good.
- `DecodeError`: method status was good but output decoding failed.

## Raw access

Raw node-opcua objects are opt-in:

- Service values expose `unsafeRaw`.
- Some operations support `includeRaw`.
- node-opcua types and constants are exported from
  `@effect-opcua/client/node-opcua`.

```ts
import { DataType, StatusCodes } from "@effect-opcua/client/node-opcua";
```

Prefer the typed API first. Use raw access only when an OPC UA capability has not
been wrapped yet.
