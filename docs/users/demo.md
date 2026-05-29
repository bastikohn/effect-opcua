# Demo

The workspace includes a demo OPC UA server, a typed demo client package, and a
terminal UI.

## Build first

The root `dev:server` and `dev:tui` scripts execute built `dist` files, so build
the workspace first:

```sh
pnpm install
pnpm build
```

## Run the demo server

```sh
pnpm dev:server
```

The server starts one simulated filling cell. It exposes machine telemetry,
structured command submission, and command status data.

## Run the TUI

In another terminal:

```sh
pnpm dev:tui
```

The TUI connects to the demo server and uses the public client library. It is a
consumer example, not part of the core client API.

## Use the demo client package

`@effect-opcua/demo-client` is a backend/HMI SDK example. It provides typed
services over the demo server contract:

```ts
import { Effect, Layer, ManagedRuntime } from "effect";
import { DemoMachine } from "@effect-opcua/demo-client";
import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";

const MainLayer = DemoMachine.layerLive({
  clientId: "backend-1",
}).pipe(
  Layer.provide(
    OpcuaSession.layer().pipe(
      Layer.provide(
        OpcuaClient.layer({
          endpointUrl: "opc.tcp://localhost:4840",
          clientOptions: { endpointMustExist: false },
        }),
      ),
    ),
  ),
);

const runtime = ManagedRuntime.make(MainLayer);
```

Use `DemoMachineCommands` to submit intent-level commands and observe command
status. Use `DemoMachineTelemetry` to read or watch machine snapshots.

## Demo boundaries

The demo server is a realistic contract exercise, not a production PLC. It is
useful for examples, integration tests, and validating client behavior against a
known address space.
