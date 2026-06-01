# @effect-opcua/demo-server

`@effect-opcua/demo-server` is the OPC UA simulation server for the
`DemoFillingCell` demo machine.

For the machine-level behavior, lifecycle, commands, counters, faults, and
scenario definitions, see the [demo machine README](../README.md). For the
backend/HMI SDK that consumes this server, see the
[demo client README](../client/README.md).

## Server Role

The server simulates exactly one `DemoFillingCell` and exposes it as an OPC UA
address space rooted at `DemoFillingCell`.

The public surface includes:

- `State` for lifecycle, operating mode, and cycle phase.
- `Commands` for the command catalog, atomic `SubmitRequest`, and structured
  command status history.
- `Motion`, `Filling`, `PartHandling`, `Inspection`, `Safety`,
  `OperatorFeedback`, `Production`, and `Diagnostics` branches for telemetry.
- `Telemetry.Revision`, which clients can monitor before reading a coherent
  telemetry snapshot.

The HMI/client submits intent-level requests. The simulated PLC/server owns
sequencing, interlocks, command acceptance, command completion, faults, and
safety behavior.

## Runtime API

```ts
import { startDemoOpcuaServer } from "@effect-opcua/demo-server";

const demo = await startDemoOpcuaServer({
  port: 4840,
  scenario: "Default",
  simulationSpeed: 1,
});

console.log(demo.endpointUrl);

await demo.stop();
```

Options:

- `port`: OPC UA server port. Defaults to `4840`.
- `resourcePath`: OPC UA resource path. Defaults to
  `/UA/effect-opcua-demo`.
- `certificateRootFolder`: certificate/PKI storage root. Defaults to a temp
  directory.
- `scenario`: deterministic simulation scenario. Defaults to `Default`.
- `simulationSpeed`: time acceleration factor. Defaults to `1`.
- `commandStatusCapacity`: number of command status entries retained. Defaults
  to `8`.

## CLI

After building the package, run the server with:

```sh
pnpm --filter @effect-opcua/demo-server build
pnpm --filter @effect-opcua/demo-server start
```

The CLI reads `OPCUA_DEMO_PORT`; otherwise it listens on port `4840`.
