# effect-opcua

Effect-native OPC UA client wrappers and examples built on top of
`node-opcua`.

This workspace is new and intentionally still flexible. Breaking changes are
acceptable when they improve API quality, ergonomics, or performance.

## Packages

- `@effect-opcua/client`: public client library.
- `@effect-opcua/demo-server`: simulated OPC UA filling-cell server.
- `@effect-opcua/demo-client`: typed backend/HMI SDK example for the demo
  server.
- `@effect-opcua/tui`: terminal UI example.

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/users/getting-started.md)
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
