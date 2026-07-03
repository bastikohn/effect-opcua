# @effect-opcua/codegen

## 0.1.0-alpha.2

### Patch Changes

- b366148: Republish with dependency specifiers correctly resolved to concrete versions.

  The previous alpha release shipped unresolved pnpm-only protocol specifiers
  (`effect: "catalog:"`, `@effect/platform-node: "catalog:"`,
  `@effect-opcua/client: "workspace:*"`) because the publish script used raw
  `npm publish`, which ships `package.json` verbatim. The script now packs with
  `pnpm pack` — rewriting those protocols to concrete versions — before handing
  the tarball to `npm publish`, so installed manifests resolve correctly.

- Updated dependencies [b366148]
  - @effect-opcua/client@0.1.0-alpha.3

## 0.1.0-alpha.1

### Patch Changes

- 207c139: Bump the required `effect` peer dependency to `4.0.0-beta.92` (from `beta.79`).
  `@effect-opcua/codegen` also moves its `@effect/platform-node` dependency to
  `4.0.0-beta.92`. Effect versions are now managed through a pnpm catalog.
- Updated dependencies [207c139]
  - @effect-opcua/client@0.1.0-alpha.2

## 0.1.0-alpha.0

### Minor Changes

- 7353ea9: Publish the codegen package.

### Patch Changes

- Updated dependencies [11e5a42]
- Updated dependencies [f1064d3]
  - @effect-opcua/client@0.1.0-alpha.1
