# Architecture

The workspace is organized around one public client package and grouped examples:

- `packages/client`: `@effect-opcua/client`.
- `examples/demo-machine/server`: simulated OPC UA filling-cell server.
- `examples/demo-machine/client`: typed backend/HMI SDK built on the public client.
- `examples/browse/tui`: terminal UI consuming the demo client and server.
- `examples/browse/web`: web browse UI.

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

## Public package shape

The client package has exactly two code entry points:

```ts
import {
  Opcua,
  OpcuaClient,
  OpcuaError,
  OpcuaSession,
} from "@effect-opcua/client";
import { StatusCodes } from "@effect-opcua/client/node-opcua";
```

`Opcua` is the ergonomic surface for definitions, codecs, filters, and buffer
policies. `OpcuaClient`, `OpcuaSession`, and `OpcuaError` expose the public
service and error APIs. Source modules remain package-local implementation
units, not npm entry points.

`@effect-opcua/client/node-opcua` is the explicit escape hatch for node-opcua
types, constants, and helpers that users still need.

## Internal boundaries

`packages/client/src/internal/*` contains shared implementation code and is not
public API. The package export map blocks `./internal/*`.

Use internal modules for reusable mechanics such as:

- metadata discovery and cache invalidation
- keyed batch normalization
- browse result normalization
- structure runtime initialization
- monitor option normalization
- event wiring

Keep public modules small and definition-oriented. A public module should define
the user-facing types, constructors, and service functions for one feature area.

## Design direction

The library wraps node-opcua rather than hiding it completely:

- Typed definitions and Effect services are the default user experience.
- OPC UA status results are usually represented as data.
- Transport, configuration, access, encode, decode, and lifecycle failures use
  `OpcuaError`.
- Raw node-opcua objects are available only through explicit `unsafeRaw` fields,
  `includeRaw` options, or the `node-opcua` subpath.

The project is new and has no active users, so breaking changes are acceptable
when they make the API clearer or the internals simpler.

## Examples as contract tests

The demo packages should stay independent of client internals. The demo client
targets the public OPC UA address space exposed by the demo server and imports
`@effect-opcua/client` as a normal consumer.

Relevant tests:

- `packages/client/test/exports.test.ts`
- `examples/demo-machine/client/test/demo-client.test.ts`
- `examples/demo-machine/server/test/demo-server.test.ts`
