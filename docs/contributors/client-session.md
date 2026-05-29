# Client and session lifecycle

## Client layer

`OpcuaClient.layer(options)` creates a node-opcua `OPCUAClient`, connects it to
`options.endpointUrl`, wires client events, and disconnects it during scope
finalization.

Inputs:

- `endpointUrl`: OPC UA endpoint URL.
- `clientOptions`: optional node-opcua `OPCUAClientOptions`.

Failures:

- Connect failures fail with `OpcuaError.reason._tag === "Connect"`.
- Disconnect failures are ignored during finalization after being converted to
  `Disconnect` errors.

`OpcuaClient.layerConfig(options)` resolves the endpoint and optional client
options from Effect `Config` before creating the same layer.

## Session layer

`OpcuaSession.layer(options)` requires `OpcuaClient`. It creates a node-opcua
session with optional `userIdentity`, wires session events, constructs the
metadata service and structure runtime, and closes the session during scope
finalization.

Options:

- `userIdentity`: passed to `client.unsafeRaw.createSession`.
- `batching.read`: defaults for `readMany`.
- `batching.write`: defaults for `writeMany`.
- `batching.call`: defaults for `callMany`.

Failures:

- Session creation fails with `SessionCreate`.
- Session close failures are ignored during finalization after conversion to
  `SessionClose`.

## Session service API

The service exposes:

- `read`, `write`, `call`
- `readMany`, `writeMany`, `callMany`
- `browse`, `browseNext`, `releaseBrowseContinuation`, `browseChildren`
- `makeSubscription`
- `events`
- `unsafeRaw`

Module-level helpers delegate to the current `OpcuaSession` service in the
Effect environment.

## Metadata and structure runtime

Each session owns:

- a metadata service for variable, method, and built-in data type metadata
- a structure runtime for node-opcua namespace data type extraction

Metadata is cached per session. When node-opcua emits `session_restored`, the
session invalidates both metadata and structure runtime caches. The next
operation repopulates them.

## Event streams

Client events include connection, reconnection, backoff, and disconnect events.
Session events include keepalive, keepalive failure, session closed, and session
restored events.

Events use sliding PubSub buffers. They are diagnostic streams; operations do
not require users to consume them.

Relevant tests:

- `packages/client/test/batch.test.ts`
- `packages/client/test/exports.test.ts`
- `packages/client/test/types.tst.ts`
