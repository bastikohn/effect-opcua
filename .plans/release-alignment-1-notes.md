# Release Alignment 1 Notes

## Phase 1 - Freeze the public API boundary

Completed on 2026-06-04.

### Changes

- Replaced the root client barrel with a narrower public surface:
  - kept `Opcua` as the definition namespace;
  - kept `OpcuaClient` and `OpcuaSession` as root service/helper objects;
  - kept `OpcuaError` as the error namespace;
  - removed root `OpcuaMethod`, `OpcuaVariable`, and `OpcuaSubscription` namespaces.
- Removed `Opcua.Codec` from the public definition namespace; the public codec constructors and type helpers remain.
- Removed exported `OpcuaClient.makeOpcuaClient` / `OpcuaClient.make`.
- Removed the package wildcard `./*` export and replaced it with explicit public subpaths for root, `node-opcua`, `Opcua`, `OpcuaClient`, `OpcuaError`, and `package.json`.
- Removed wildcard `@effect-opcua/client/*` TypeScript path aliases in favor of explicit public aliases.
- Added module-level public browse helpers on `OpcuaSession`: `browse`, `browseChildren`, `browseNext`, and `releaseBrowseContinuation`.
- Exported public browse, monitor, variable, batch, metadata, and data-type result types from the root package.
- Updated workspace consumers and codegen to use root public imports instead of removed client subpaths.
- Reworked the export test to import built `dist` files and assert removed package subpaths are blocked.

### Verification

- `pnpm --filter @effect-opcua/client build` - passed.
- `pnpm --filter @effect-opcua/client typecheck` - passed.
- `pnpm --filter @effect-opcua/client test` - passed with local port binding allowed for the live OPC UA harness.
- `pnpm test:types` - passed.
- `pnpm typecheck` - passed.

### Notes

- The source files for `OpcuaVariable`, `OpcuaMethod`, `OpcuaSession`, and `OpcuaSubscription` still build into `dist` because internal modules and declarations reference them. They are no longer package-exported subpaths except where explicitly listed.
- `@effect-opcua/client/OpcuaSession` is intentionally not exported in this phase because that source module still contains raw construction helpers. The root `OpcuaSession` object is the public service/session operation surface.

## Phase 2 - Make the npm package publishable

Completed on 2026-06-04.

### Changes

- Set `@effect-opcua/client` to version `0.1.0-alpha.0`.
- Removed the package `private` flag.
- Added package metadata:
  - `license: "UNLICENSED"`;
  - Node `engines` requirement;
  - repository and bugs links;
  - public npm publish config.
- Cleaned package `files` to publish `README.md`, `dist`, and
  `package.json`; `src` is no longer part of the tarball.
- Added `packages/client/README.md` with alpha status, requirements, public
  imports, quickstart, operation summary, raw `node-opcua` escape hatch, and
  error-handling guidance.
- Added `scripts/client-package-smoke.mjs` and root script
  `pnpm smoke:client-package`.
  - The script builds the client, packs it, installs the tarball into a temp
    consumer project, typechecks a consumer program, checks runtime imports, and
    verifies removed subpaths are blocked.

### Verification

- `pnpm smoke:client-package` - passed with network/dependency checks allowed.
- `pnpm --filter @effect-opcua/client publish --dry-run --access public --no-git-checks` - passed.

### Notes

- There is no existing project license file. To avoid inventing a license grant,
  the package now uses `license: "UNLICENSED"`. Replace this with the intended
  SPDX license and license file before publishing as open source.
- The dry-run publish command needed `--no-git-checks` because the working tree
  contains the in-progress release-alignment changes.

## Phase 3 - Harden lifecycle and runtime validation

Completed on 2026-06-04.

### Changes

- Added explicit runtime validation for public subscription options before
  handing them to `node-opcua`.
  - `publishingInterval` must be an Effect `Duration` and must resolve to a
    finite, non-negative millisecond value.
  - subscription counters are validated as positive integers, except
    `maxNotificationsPerPublish`, which follows OPC UA/node-opcua semantics and
    permits `0`.
  - `publishingEnabled` must be boolean.
  - `priority` is validated as an OPC UA byte, `0..255`.
  - unknown option keys are rejected with a configuration error.
- Moved subscription option defaults/normalization into
  `src/internal/subscription-options.ts` so the session implementation only
  receives normalized values.
- Added public `OpcuaSubscriptionOptions` typing and re-exported it from the
  root package.
- Hardened client and session acquisition against interruption:
  - a late successful client connection after interruption is disconnected;
  - a late successful session creation after interruption is closed.
- Added focused tests for subscription option validation, scope finalizers, event
  stream shutdown, and interrupted client/session acquisition.

### Verification

- `pnpm --filter @effect-opcua/client typecheck` - passed.
- `pnpm --filter @effect-opcua/client test` - passed with local port binding
  allowed for the live OPC UA harness.
- `pnpm --filter @effect-opcua/client build` - passed.
- `pnpm test:types` - passed.
- `pnpm typecheck` - passed.

### Notes

- Checked `node-opcua` source for subscription option semantics before
  validating `maxNotificationsPerPublish` and `priority`.
- Checked Effect source/docs for `tryPromise` cancellation behavior. The tests
  model interruption as an in-flight cancellation request and then release the
  fake async operation, matching the behavior of non-cancellable underlying
  promises.

## Phase 4 - Complete package-level docs and examples

Completed on 2026-06-04.

### Changes

- Expanded `packages/client/README.md` into an npm-facing usage guide covering:
  - public imports and alpha stability;
  - quickstart connection/session lifecycle;
  - connection profile layer factory;
  - read, write, method call, and keyed batch examples;
  - browse and continuation guidance;
  - subscription/monitoring recipe with scoped cleanup, startup modes, and
    buffer policy;
  - ExtensionObject structure usage and limitations;
  - error handling and raw node-opcua access.
- Updated user docs to state the alpha public API boundary and ESM/effect v4
  beta requirements.
- Added connection-profile, scoped-cleanup, error-handling, monitoring cleanup,
  and ExtensionObject limitation notes to `docs/users/recipes.md`.
- Fixed multi-literal schema examples to use the repository's
  `Schema.Literals([...])` pattern.
- Added `packages/client/test/readme-smoke.tst.ts` to type-check the documented
  README imports and public API examples.

### Verification

- `pnpm test:types` - passed.
- `pnpm typecheck` - passed.

### Notes

- The README now links to repository docs by GitHub URL because package-local
  docs are not included in the npm tarball.
- The README smoke test is intentionally type-level only. Runtime examples still
  depend on a real OPC UA endpoint.

## Phase 5 - Gate generated-code compatibility

Completed on 2026-06-04.

### Changes

- Expanded `packages/codegen/test/public-api.tst.ts` so generated-style
  structures are checked against the trimmed root client API for:
  - generated write-only variables;
  - structure read/write and batch usage;
  - ExtensionObject method inputs/outputs;
  - structure monitor startup and typed monitor samples.
- Hardened the demo generated-output test so emitted generated files must not
  import `@effect-opcua/client/*` subpaths or `/internal/` paths.
- Removed the wildcard `@effect-opcua/client/*` TypeScript path from the demo
  generated-output temp project. Generated demo output now typechecks with only
  the root `@effect-opcua/client` alias exposed.

### Verification

- `pnpm test:types` - passed.
- `pnpm --filter @effect-opcua/codegen test` - passed with local port binding
  allowed for the demo OPC UA server.
- `pnpm --filter @effect-opcua/demo-client typecheck` - passed.

### Notes

- The generated emitter already uses root public imports for variables and
  structures, so this phase mainly added gates instead of changing generated
  output.
- Codegen package source still imports the public `OpcuaError` subpath where it
  needs error types; generated code does not.

## Phase 6 - Add one release command

Completed on 2026-06-04.

### Changes

- Added root `pnpm check:release`.
- The release gate runs:
  - `pnpm lint`;
  - `pnpm format`;
  - `pnpm build`;
  - `pnpm typecheck`;
  - `pnpm test:types`;
  - `pnpm test`;
  - `pnpm smoke:client-package`;
  - `pnpm --filter @effect-opcua/client publish --dry-run --access public --no-git-checks`.
- Documented the release gate in `docs/contributors/testing.md`.
- Fixed lint findings that the new release gate surfaced:
  - removed an unused `Rpc` import in the browse web server handlers;
  - changed empty exported service interfaces in the client root barrel to type
    aliases;
  - replaced a bare expression in the README smoke type test.
- Applied Prettier to files reported by `pnpm format` so the release gate can
  pass.
- Updated `.gitignore` so this notes file is visible as a deliverable while the
  rest of `.plans` remains ignored.

### Verification

- `pnpm check:release` - passed with local port binding and packed-package
  dependency install allowed.
- `pnpm check:release` - passed again after the notes-file ignore rule was
  fixed.

### Notes

- The dry-run publish step uses `--no-git-checks` so the gate can run against
  this in-progress working tree. The actual release process should still review
  the worktree and intended git state before publishing.
- `pnpm check:release` is intentionally long; it is the one command that covers
  the release-alignment checks from the plan.
