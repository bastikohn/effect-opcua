---
"@effect-opcua/client": patch
"@effect-opcua/codegen": patch
---

Republish with dependency specifiers correctly resolved to concrete versions.

The previous alpha release shipped unresolved pnpm-only protocol specifiers
(`effect: "catalog:"`, `@effect/platform-node: "catalog:"`,
`@effect-opcua/client: "workspace:*"`) because the publish script used raw
`npm publish`, which ships `package.json` verbatim. The script now packs with
`pnpm pack` — rewriting those protocols to concrete versions — before handing
the tarball to `npm publish`, so installed manifests resolve correctly.
