# Errors and events

## Error shape

All library failures use `OpcuaError`:

```ts
export class OpcuaError extends Data.TaggedError("OpcuaError")<{
  readonly reason: OpcuaErrorReason;
}> {}
```

The `reason._tag` identifies the failure category.

Important categories:

- `Configuration`
- `Service`
- `Connect`
- `Disconnect`
- `SessionCreate`
- `SessionClose`
- `SubscriptionCreate`
- `AccessDenied`
- `Encode`
- `Decode`
- `MethodInput`
- `MethodNotExecutable`
- `MonitorConfiguration`
- `MonitorCreate`
- `MonitorStartup`
- `MonitorRuntime`

Use `OpcuaError.isOpcuaError` when code receives unknown errors.

## Results as data

The library distinguishes OPC UA operation statuses from Effect failures.

Returned as data:

- read `NonGoodStatus`
- write `NonGoodStatus`
- method `NonGoodStatus`
- browse `NonGoodStatus`
- read/method/monitor decode failures after a successful service response

Failed as Effects:

- invalid local options or definitions
- invalid NodeIds during preflight
- access denied discovered by metadata validation
- encode failures before writes or calls
- service transport failures
- connection, session, or subscription lifecycle failures
- monitor startup failures in strict mode
- monitor runtime group failures

This lets users handle expected OPC UA statuses in normal result branches while
still using Effect error handling for failures that interrupt the operation.

## includeRaw and unsafeRaw

Raw node-opcua values are deliberately explicit:

- services expose `unsafeRaw`
- variables and methods can opt into raw result fields
- calls can override `includeRaw` per call
- browse can opt into raw browse results and references
- node-opcua symbols are re-exported from `@effect-opcua/client/node-opcua`

Do not add raw data to public results by default. Raw values can be large,
mutable, and tied to node-opcua implementation details.

## Events

The client, session, and subscription services expose event streams.

Client event tags:

- `Connected`
- `ConnectionFailed`
- `Backoff`
- `StartReconnection`
- `AfterReconnection`
- `ConnectionLost`
- `ConnectionReestablished`
- `Disconnected`

Session event tags:

- `KeepAlive`
- `KeepAliveFailure`
- `SessionClosed`
- `SessionRestored`

Subscription event tags:

- `Started`
- `Terminated`
- `KeepAlive`
- `InternalError`
- `StatusChanged`
- `ClientBufferDropped`
- `MonitorItemsCreated`
- `MonitorItemsTerminated`

Events are diagnostic and lifecycle-oriented. Do not require users to consume
events for normal operations to work.

Relevant tests:

- `packages/client/test/monitoring.test.ts`
- `packages/client/test/browse.test.ts`
- `packages/client/test/methods.test.ts`
- `packages/client/test/values.test.ts`
