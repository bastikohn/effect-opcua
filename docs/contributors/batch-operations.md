# Batch operations

The session exposes keyed batch APIs for HMI-style reads, writes, and method
calls:

- `readMany`
- `writeMany`
- `callMany`

All three use the shared keyed batch runner in
`packages/client/src/internal/keyed-batch.ts`.

## Shared behavior

Inputs must be plain keyed records. The public result preserves the input keys
and maps ordered service results back to those keys.

An empty record returns an empty record without a server call.

Options are shape-validated. Unknown option keys fail with `Configuration`.
Service options must be positive integers.

If node-opcua returns a result count that does not match the prepared request
count, the operation fails with a service/configuration error rather than
guessing how to rekey the response.

## Defaults and overrides

Session defaults come from `OpcuaSession.layer({ batching })`.

Per-call `options.service` overrides session defaults for that one operation.
Fallbacks are:

- reads: `maxNodesPerRead: 250`, `maxConcurrentRequests: 1`
- writes: `maxNodesPerWrite: 250`, `maxConcurrentRequests: 1`
- calls: `maxMethodsPerCall: 50`, `maxConcurrentRequests: 1`

## readMany

Input:

```ts
OpcuaSession.readMany({
  temperature: Temperature,
  pressure: Pressure,
});
```

Validation modes:

- `strict` is the default. It validates metadata for every definition before the
  service read.
- `none` skips metadata pre-read and decodes returned values from the service
  response.

Duplicate NodeIds are rejected locally because one keyed read result should map
to one target.

## writeMany

Input:

```ts
OpcuaSession.writeMany({
  setpoint: [Setpoint, 42],
});
```

Each entry must be a `[definition, value]` tuple using a writable variable
definition. The type system checks the value type.

All entries are preflighted before any write service call. This prevents partial
writes caused by local metadata, access, or encoding failures discovered midway
through the batch.

Duplicate NodeIds are rejected locally.

## callMany

Input:

```ts
OpcuaSession.callMany({
  reset: [Reset, { mode: "soft" }],
});
```

Each entry is `[definition, input]` or `[definition, input, options]`.

Methods are resolved and preflighted before service calls. Duplicate method
definitions are allowed because calling the same method with different keys can
be meaningful.

Per-item options currently support `includeRaw`.

Relevant tests:

- `packages/client/test/batch.test.ts`
- `packages/client/test/methods.test.ts`
- `packages/client/test/values.test.ts`
- `packages/client/test/types.tst.ts`
