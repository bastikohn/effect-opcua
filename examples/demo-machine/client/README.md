# @effect-opcua/demo-client

`@effect-opcua/demo-client` is a service-only backend/HMI SDK example for the demo filling-cell OPC UA contract.

It intentionally does not include a CLI, RPC/HTTP backend, or UI. Runtime source targets the public OPC UA address space exposed by `@effect-opcua/demo-server` and does not import demo-server internals.

## Contract Model

Commands are submitted through `Commands.SubmitRequest`, which is a mailbox, not persistent command state. The submit value is one structured OPC UA write containing correlation fields, command kind, and typed payload fields selected by `commandKind`.

The command flow is:

1. Write `Commands.SubmitRequest` once.
2. Observe `Commands.Status`.

`Commands.Status` is the authoritative structured command tracking buffer. The client does not duplicate PLC command-availability logic and does not run a client-side command queue.

Overlapping submit handshakes fail immediately with `CommandSubmissionInProgress`. PLC/server rejections are returned as terminal command status entries with `state = "Rejected"`, `statusCode`, and `statusMessage`. Transport, decode, monitoring, and timeout failures fail the Effect.

Command status belongs to `DemoMachineCommands`: use `readCommandStatus()` and `watchCommandStatus()` there. `DemoMachineTelemetry` only exposes machine snapshots.

Telemetry remains individual OPC UA variables. `DemoMachineTelemetry` monitors `Telemetry.Revision`; each revision change triggers one `readMany` of the snapshot variables and commits that coherent `DemoMachineSnapshot`.

## Backend Runtime Example

```ts
import { ManagedRuntime } from "effect";
import { Layer } from "effect";
import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";
import { DemoMachine } from "@effect-opcua/demo-client";

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

Use `DemoMachineCommands` to submit intent-level commands and observe command status. Use `DemoMachineTelemetry` to read or watch cached snapshots.
