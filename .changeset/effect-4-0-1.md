---
"@effect-opcua/client": patch
"@effect-opcua/codegen": patch
---

Bump the required `effect` peer dependency to the stable `4.0.1` release (from
`4.0.0-rc.115`). The pnpm catalog moves `effect`, `@effect/platform-node`, and
`@effect/platform-browser` to `4.0.1`. The codegen CLI adopts the relocated
`effect/cli` module (previously `effect/unstable/cli`) and gives `--verbose`
and `--check` an explicit `false` default, since boolean flags are now required
unless they have one.
