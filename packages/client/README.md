# @effect-opcua/client

Effect-native OPC UA client wrapper for `node-opcua`.

This is a first alpha package. The public API is intentionally small and is not
1.0-stable yet. Breaking changes are expected when they improve correctness,
ergonomics, performance, or the package boundary.

## Requirements

- Node.js 22 or newer.
- ESM projects.
- `effect` v4 beta as a peer dependency.

```sh
pnpm add @effect-opcua/client effect
```

## Public import paths

Use only:

- `@effect-opcua/client`
- `@effect-opcua/client/node-opcua`

Do not import source-module subpaths such as:

- `@effect-opcua/client/Opcua`
- `@effect-opcua/client/OpcuaClient`
- `@effect-opcua/client/OpcuaError`
- `@effect-opcua/client/internal/*`

Those paths are intentionally not public.

```ts
import {
  Opcua,
  OpcuaClient,
  OpcuaError,
  OpcuaSession,
} from "@effect-opcua/client";

import {
  DataType,
  StatusCodes,
  Variant,
} from "@effect-opcua/client/node-opcua";
```

The root package is the normal user API. The `node-opcua` subpath is the raw
escape hatch for OPC UA constants and values that are not wrapped yet.

## Quickstart

```ts
import { Effect, Layer, Schema } from "effect";
import { Opcua, OpcuaClient, OpcuaSession } from "@effect-opcua/client";

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

const program = Effect.gen(function* () {
  const current = yield* OpcuaSession.read(Temperature);
  const written = yield* OpcuaSession.write(Setpoint, 42);
  const reset = yield* OpcuaSession.call(Reset, { mode: "soft" });

  return { current, written, reset };
});

const MainLayer = OpcuaSession.layer().pipe(
  Layer.provide(
    OpcuaClient.layer({
      endpointUrl: "opc.tcp://localhost:4840",
      clientOptions: { endpointMustExist: false },
    }),
  ),
);

await Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(MainLayer)));
```

`OpcuaClient.layer` owns the TCP connection. `OpcuaSession.layer` owns the OPC
UA session. Use `Effect.scoped` so client, session, subscription, and monitor
finalizers run on exit or interruption.

## Connection Profiles

A connection profile is usually just a small layer factory:

```ts
import { Layer } from "effect";
import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";

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

Pass `userIdentity` to `OpcuaSession.layer(...)` when the server requires
session authentication. Pass raw `OPCUAClientOptions` through
`OpcuaClient.layer({ clientOptions })` for node-opcua connection settings.

## Read, Write, And Call

Reads, writes, and method calls return OPC UA statuses as data. A good read is a
`Value`; a non-good server status is a `NonGoodStatus`.

```ts
const program = Effect.gen(function* () {
  const sample = yield* OpcuaSession.read(Temperature);

  if (sample._tag === "Value") {
    console.log(sample.value);
  }

  const written = yield* OpcuaSession.write(Setpoint, 42);
  const reset = yield* OpcuaSession.call(Reset, { mode: "soft" });

  return { written, reset };
});
```

## Batches

Use keyed batches when several nodes or methods should keep typed result keys:

```ts
const program = Effect.gen(function* () {
  const snapshot = yield* OpcuaSession.readMany(
    {
      temperature: Temperature,
      setpoint: Setpoint,
    },
    { validation: "strict" },
  );

  const writes = yield* OpcuaSession.writeMany({
    setpoint: [Setpoint, 42],
  });

  const calls = yield* OpcuaSession.callMany({
    reset: [Reset, { mode: "soft" }],
  });

  return { snapshot, writes, calls };
});
```

Per-call service options can override the batching defaults supplied to
`OpcuaSession.layer(...)`.

## Browse

```ts
import { makeNodeClassMask } from "@effect-opcua/client/node-opcua";

const program = Effect.gen(function* () {
  const children = yield* OpcuaSession.browseChildren("ns=2;s=Machine", {
    nodeClassMask: makeNodeClassMask("Variable"),
  });

  if (children._tag === "Browsed") {
    for (const reference of children.references) {
      console.log(reference.nodeId, reference.browseName);
    }
  }

  return children;
});
```

Use `OpcuaSession.browse`, `OpcuaSession.browseNext`, and
`OpcuaSession.releaseBrowseContinuation` directly when you need explicit
pagination control. `includeRaw: true` opts into raw node-opcua browse values.

## Inspect nodes

`OpcuaSession.inspectNode` reads node metadata and, only when requested, the
current value and the data type definition:

```ts
const program = Effect.gen(function* () {
  // Metadata only — safe for address-space navigation.
  const node = yield* OpcuaSession.inspectNode("ns=2;s=Machine.State");

  // Opt into the expensive parts on demand.
  const details = yield* OpcuaSession.inspectNode("ns=2;s=Machine.State", {
    value: true,
    dataTypeDefinition: true,
  });

  return { node, details };
});
```

Keep `value` off while browsing: reading the value of a custom-structure
(`ExtensionObject`) variable forces node-opcua to populate its session-wide
data type manager on first use, which can take many seconds on large or slow
servers. With `value: true`, an unreadable node yields
`{ _tag: "NotReadable" }` and a failed read yields `{ _tag: "ReadFailed" }`
instead of failing the whole inspection.

## Monitoring

Subscriptions and monitors are scoped resources. Closing or interrupting the
scope terminates created monitored item groups, shuts down client queues, and
removes listeners.

```ts
import { Duration, Effect, Stream } from "effect";
import { Opcua, OpcuaSession } from "@effect-opcua/client";

const program = Effect.gen(function* () {
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
`startup: "bestEffort"` when an HMI should start with accepted items and inspect
rejections through `monitor.startup.failed`. Client buffering uses
`Opcua.BufferPolicy.sliding(...)`, `dropping(...)`, or `latest()`.

## ExtensionObject Structures

Use `Opcua.structure(...)` for scalar OPC UA `ExtensionObject` payloads and
`Opcua.structureArray(...)` for one-dimensional arrays.

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

Structure codecs need server metadata for the declared data type. The runtime
uses `session.extractNamespaceDataType()` and `session.constructExtensionObject`
through node-opcua. Scalar structures and one-dimensional arrays are supported;
structure matrices, missing metadata, and opaque dynamic structures are not
encoded by explicit structure codecs. Use generated structures when possible,
or `Opcua.dynamic()` while exploring.

## Errors

Failed Effects represent local configuration errors, transport/service failures,
access validation failures, encode/decode failures, lifecycle failures, and
monitor startup/runtime failures. OPC UA service statuses that complete normally
are returned as result data.

```ts
try {
  await Effect.runPromise(
    Effect.scoped(program).pipe(Effect.provide(MainLayer)),
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

## Raw Access

Prefer the typed API first. Use raw access only for OPC UA capabilities that are
not wrapped yet:

- import constants and constructors from `@effect-opcua/client/node-opcua`;
- read service `unsafeRaw` fields when you intentionally need raw node-opcua
  objects;
- pass `includeRaw: true` on operations that document raw result access.

## More Documentation

- [Workspace docs](https://github.com/bastikohn/effect-opcua/tree/main/docs)
- [Getting started](https://github.com/bastikohn/effect-opcua/blob/main/docs/users/getting-started.md)
- [Core concepts](https://github.com/bastikohn/effect-opcua/blob/main/docs/users/core-concepts.md)
- [Recipes](https://github.com/bastikohn/effect-opcua/blob/main/docs/users/recipes.md)
- [Code generation](https://github.com/bastikohn/effect-opcua/blob/main/docs/users/codegen.md)
