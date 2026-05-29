# Monitoring

Monitoring is exposed through subscriptions:

```ts
const program = Effect.gen(function* () {
  const subscription = yield* OpcuaSession.makeSubscription({
    publishingInterval: Duration.millis(100),
  });

  const monitor = yield* subscription.monitor(items, options);
  return monitor;
});
```

The monitor input is a named dictionary of readable variable definitions. Samples
are emitted by the same keys.

## Subscription lifecycle

`makeSubscription` creates a node-opcua `ClientSubscription`, wires subscription
events, and terminates the subscription during scope finalization.

Subscription options map to node-opcua requested subscription options:

- `publishingInterval`
- `lifetimeCount`
- `maxKeepAliveCount`
- `maxNotificationsPerPublish`
- `publishingEnabled`
- `priority`

Defaults come from `internal/constants.ts`.

## Monitor option validation

Monitor items must be a non-empty plain record of readable definitions.
Duplicate NodeIds are rejected locally.

Required monitor options:

- `startup`: `"strict"` or `"bestEffort"`
- `validation`: `"none"`, `"access"`, or `"strict"`
- `samplingInterval`: Effect `Duration`
- `queueSize`: positive integer
- `discardOldest`: boolean
- `filter`: `MonitorFilter`
- `timestamps`: `"none"`, `"source"`, `"server"`, or `"both"`
- `clientBuffer`: `BufferPolicy`

`overrides` must be keyed by an existing item name. Overrides can change
sampling interval, queue size, discard policy, filter, and timestamps per item.

`create` controls monitor item request chunking and concurrency. Defaults are
`maxItemsPerRequest: 250` and `maxConcurrentRequests: 1`.

## Validation modes

- `none`: skip metadata/access prevalidation and attempt monitor creation.
- `access`: batch-read `AccessLevel` and `UserAccessLevel` using the create
  chunk size, then reject unreadable or non-readable items.
- `strict`: validate each variable with the session metadata service, including
  access and codec metadata.

Validation failures become startup failures, not runtime sample failures.

## Startup modes

`strict` startup fails the Effect if any item fails validation or creation. Any
monitor groups already created are terminated before the failure is returned.

`bestEffort` startup returns an active monitor with a startup report. Accepted
items are active; rejected items appear in `monitor.startup.failed`.

The startup report includes:

- `ok`
- `requested`
- `activeCount`
- `failedCount`
- `active`
- `failed`

## Creation and cleanup

Items with compatible effective monitor options are grouped into one
`monitorItems` service call. Groups are chunked by `create.maxItemsPerRequest`
and run with `create.maxConcurrentRequests`.

If a group is created but every item inside it fails, the group is terminated.
If monitor startup is interrupted or later fails in strict mode, created groups
are cleaned up.

When the monitor scope closes, listeners are removed, monitor groups are
terminated, and the client queue is shut down.

## Samples and buffering

Client buffering uses Effect queues:

- `BufferPolicy.sliding(capacity)`
- `BufferPolicy.dropping(capacity)`
- `BufferPolicy.latest()`

A dropped or overwritten notification publishes a `ClientBufferDropped`
subscription event.

Sample tags:

- `Value`: good status and successful decode
- `Status`: non-good status
- `DecodeError`: good status but decode failed

Timestamps are included only when requested by `timestamps`.

Relevant tests:

- `packages/client/test/monitoring.test.ts`
- `packages/client/test/values.test.ts`
- `packages/client/test/types.tst.ts`
