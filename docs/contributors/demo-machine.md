# Demo machine

The demo machine packages model a simulated two-axis filling and inspection
cell. The goal is to exercise realistic OPC UA client behavior against a known
address space.

## Package roles

`examples/demo-machine/server` owns the simulated PLC/server behavior and address space.

`examples/demo-machine/client` is a typed backend/HMI SDK that consumes the public OPC
UA address space. It must not import demo-server internals.

`examples/browse/tui` is an interactive consumer of the demo client.

## Command model

Commands are submitted through `Commands.SubmitRequest`.

This node is a mailbox, not persistent command state. A submit value contains:

- correlation fields
- command kind
- typed payload fields selected by command kind

The client flow is:

1. write `Commands.SubmitRequest`
2. observe `Commands.Status`

`Commands.Status` is the authoritative command tracking buffer. The demo client
does not duplicate PLC command availability logic and does not implement a
client-side command queue.

Overlapping submit handshakes fail immediately with
`CommandSubmissionInProgress`.

PLC/server rejections are terminal command status entries with `state:
"Rejected"`, `statusCode`, and `statusMessage`. Transport, decode, monitoring,
and timeout failures fail the Effect.

## Demo client services

`DemoMachine.layerLive(options)` provides:

- `DemoMachineCommands`
- `DemoMachineTelemetry`

`DemoMachineCommands` exposes:

- raw `submit`
- `readCommandStatus`
- `watchCommandStatus`
- grouped machine, manual, and maintenance command helpers

`DemoMachineTelemetry` exposes:

- `readSnapshot`
- `watchSnapshot`

Command status belongs to `DemoMachineCommands`. Telemetry snapshots belong to
`DemoMachineTelemetry`.

## Telemetry model

Telemetry remains individual OPC UA variables. The demo client monitors
`Telemetry.Revision`. Each revision change triggers one `readMany` of snapshot
variables and commits a coherent `DemoMachineSnapshot`.

This keeps monitoring lightweight while reading a consistent snapshot through
the batch API.

## Server model

The demo server simulates one `DemoFillingCell` with:

- automatic, manual, and maintenance modes
- configure/home/start/pause/resume/abort/reset/clear-completed commands
- structured command status
- axes, clamp, filling, inspection, safety, operator feedback, counters, and
  deterministic scenarios

The full machine behavior is documented in `examples/demo-machine/server/README.md`.

## Boundaries

The demo packages are examples and contract tests for the client library. They
should not drive abstractions into the core client unless the behavior is
generally useful for OPC UA consumers.

Relevant tests:

- `examples/demo-machine/server/test/demo-server.test.ts`
- `examples/demo-machine/client/test/demo-client.test.ts`
- `examples/demo-machine/client/test/types.tst.ts`
