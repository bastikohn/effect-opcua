# Testing

## Root commands

```sh
pnpm typecheck
pnpm build
pnpm test
pnpm test:types
pnpm lint
pnpm format
pnpm check:release
```

`pnpm test` runs package tests serially across `@effect-opcua/*` packages.
`pnpm test:types` runs Tstyche type tests.

`pnpm check:release` runs the alpha release gate: lint, format, build,
workspace typecheck, Tstyche tests, workspace tests, packed client package
smoke test, and an npm publish dry-run for `@effect-opcua/client`.

## Feature-to-test map

Client exports and public surface:

- `packages/client/test/exports.test.ts`
- `packages/client/test/types.tst.ts`

Variables, codecs, structures, reads, and writes:

- `packages/client/test/values.test.ts`
- `packages/client/test/structure-runtime.test.ts`
- `packages/client/test/types.tst.ts`

Batch APIs:

- `packages/client/test/batch.test.ts`
- `packages/client/test/values.test.ts`
- `packages/client/test/methods.test.ts`
- `packages/client/test/types.tst.ts`

Methods:

- `packages/client/test/methods.test.ts`
- `packages/client/test/types.tst.ts`

Monitoring:

- `packages/client/test/monitoring.test.ts`
- `packages/client/test/types.tst.ts`

Browsing:

- `packages/client/test/browse.test.ts`

Demo server and demo client:

- `examples/demo-machine/server/test/demo-server.test.ts`
- `examples/demo-machine/client/test/demo-client.test.ts`
- `examples/demo-machine/client/test/types.tst.ts`

## Type tests

Type tests are important for this library because much of the public API value
comes from typed definitions:

- variable access controls writeability
- codecs determine read/write value types
- method argument definitions determine input and output objects
- keyed batches preserve result keys and value types
- monitor samples preserve item key and value relationships

When changing public types, update or add Tstyche coverage before relying on
runtime tests.

## Runtime tests

Runtime tests use fake sessions where possible and demo server integration where
needed. Prefer focused tests around behavior and result shape:

- local validation failures
- non-good OPC UA statuses returned as data
- service failures returned as `OpcuaError`
- cache invalidation
- cleanup on interruption or startup failure
- typed wrappers preserving key order

## Live harnesses

`test/live.ts` files are manual harnesses for real endpoints or long-running
local checks. They are not part of the default root test script.

Use them only when behavior depends on a real OPC UA server implementation and
cannot be covered with the fake session or demo server tests.
