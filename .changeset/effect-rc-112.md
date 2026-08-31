---
"@effect-opcua/client": patch
"@effect-opcua/codegen": patch
---

Bump the required `effect` peer dependency to `4.0.0-rc.112` (from `beta.92`).
The pnpm catalog moves `effect`, `@effect/platform-node`, and
`@effect/platform-browser` to `4.0.0-rc.112`. The renamed schema error
constructors are adopted where used (`Schema.TaggedErrorClass` →
`Schema.TaggedError`, `Schema.ErrorClass` → `Schema.Error`).
