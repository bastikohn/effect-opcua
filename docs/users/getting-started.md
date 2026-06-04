# Getting started

`@effect-opcua/client` lets you describe OPC UA variables and methods as plain
definitions, then run typed reads, writes, calls, batches, and monitors inside
Effect programs.

The client package is still in alpha. Use the root `@effect-opcua/client`
imports and the documented `@effect-opcua/client/node-opcua` escape hatch; other
source paths are not public API.

## Requirements

- Node.js 22 or newer.
- ESM projects.
- `pnpm` 11 or newer in this workspace.
- `effect` v4 beta as a peer dependency.

For a consuming package, install the client and Effect:

```sh
pnpm add @effect-opcua/client effect
```

In this repository, use the workspace install:

```sh
pnpm install
```

## Define nodes

```ts
import { Schema } from "effect";
import { Opcua } from "@effect-opcua/client";

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
```

Definitions are pure values. They do not connect to a server until a session
operation uses them.

## Run a program

```ts
import { Effect, Layer } from "effect";
import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";

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

`OpcuaClient.layer` owns the TCP client connection. `OpcuaSession.layer` owns the
OPC UA session. Use `Effect.scoped` so both are released when the program exits.

## Read the result tags

Service calls can succeed at the Effect level while returning OPC UA statuses as
data:

```ts
const program = Effect.gen(function* () {
  const sample = yield* OpcuaSession.read(Temperature);

  if (sample._tag === "Value") {
    console.log(sample.value);
  }

  if (sample._tag === "NonGoodStatus") {
    console.log(sample.status.name);
  }
});
```

Failed Effects are reserved for local configuration errors, transport/service
failures, access validation failures, encoding failures, and similar conditions
where the operation cannot produce a normal OPC UA result.
