# effect-opcua

[![CI](https://github.com/bastikohn/effect-opcua/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/bastikohn/effect-opcua/actions/workflows/ci.yml)
[![npm @effect-opcua/client](https://img.shields.io/npm/v/%40effect-opcua%2Fclient?label=%40effect-opcua%2Fclient)](https://www.npmjs.com/package/@effect-opcua/client)
[![npm @effect-opcua/codegen](https://img.shields.io/npm/v/%40effect-opcua%2Fcodegen?label=%40effect-opcua%2Fcodegen)](https://www.npmjs.com/package/@effect-opcua/codegen)

Effect-native OPC UA client wrappers and examples built on top of
`node-opcua`.

This workspace is new and intentionally still flexible. Breaking changes are
acceptable when they improve API quality, ergonomics, or performance.

## Packages

- `@effect-opcua/client`: public client library.
- `@effect-opcua/codegen`: generates typed NodeIds, variables, enums, and
  structures from an OPC UA server.
- `@effect-opcua/demo-server`: simulated OPC UA filling-cell server.
- `@effect-opcua/demo-client`: typed backend/HMI SDK example for the demo
  server.
- `@effect-opcua/tui`: terminal UI example.

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/users/getting-started.md)
- [Code generation](docs/users/codegen.md)
- [Core concepts](docs/users/core-concepts.md)
- [Recipes](docs/users/recipes.md)
- [Contributor architecture](docs/contributors/architecture.md)
- [Contributor testing guide](docs/contributors/testing.md)

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

The public contributor commands intentionally stay on `pnpm`. Some scripts use
Vite+ internally for linting, formatting, and workspace task orchestration.

## Releases

Releases are managed with Changesets. Add a changeset for user-visible changes
to published packages, then merge the generated `Version packages` PR.

Publishing runs from `.github/workflows/release.yml` with npm provenance
enabled (which requires this repository to stay public). The first releases
authenticate with an `NPM_TOKEN` repository secret (an npm automation token).
Once `@effect-opcua/client` and `@effect-opcua/codegen` exist on npm, configure
npm trusted publishing for them against this repository and workflow, then drop
the `NODE_AUTH_TOKEN` env from the publish job to publish token-free via OIDC.
