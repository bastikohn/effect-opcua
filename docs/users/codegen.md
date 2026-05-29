# Code generation

`@effect-opcua/codegen` connects to an OPC UA server, browses selected roots,
reads reachable custom type metadata, and writes a small typed client surface.

Generated output is intentionally narrow:

- `nodeIds.ts`: hierarchical NodeId constants, plus `DataTypes` for generated
  enum and structure type NodeIds.
- `enums.ts`: enum value objects, value union types, and Effect schemas.
- `structures.ts`: structure schemas and OPC UA structure codecs.
- `variables.ts`: hierarchical `Opcua.variable` definitions.
- `index.ts`: namespace exports for the generated modules.

## Config

Use segment paths for roots and excludes. A browse name containing dots stays one
segment, so PLC names such as `PLC_Info.ApplicationChkSum` are not split at the
dot.

```ts
import { defineConfig } from "@effect-opcua/codegen";

export default defineConfig({
  connection: {
    endpointUrl: "opc.tcp://localhost:4840",
    clientOptions: { endpointMustExist: false },
    // Optional, for servers that require a session login.
    // userIdentity: { type: 1, userName: "user", password: "secret" },
  },
  outputDir: "src/generated",
  roots: [{ path: ["DemoFillingCell"] }],
  exclude: [
    {
      path: ["DemoFillingCell", "Commands", "Catalog"],
      mode: "prune",
    },
    {
      pathPattern: ["DemoFillingCell", "**", /^InterfaceVersion/],
      mode: "omit",
    },
  ],
});
```

`mode: "prune"` removes a node and its children. `mode: "omit"` removes the
matched node from output but still allows browsing through it.

Legacy `browsePath: "A.B.C"` strings are still accepted, but new configs should
use `path: ["A", "B", "C"]` so each OPC UA browse-name segment is explicit.

## Run

```sh
pnpm exec effect-opcua-codegen --config effect-opcua.codegen.ts
pnpm exec effect-opcua-codegen --config effect-opcua.codegen.ts --check
```

The program refuses to overwrite files that do not contain the generated-file
header. Use `--check` in CI to fail when generated output is stale.

The API is available for custom tooling:

```ts
import { Effect } from "effect";
import { check, generate } from "@effect-opcua/codegen";

await Effect.runPromise(Effect.scoped(generate(config)));
await Effect.runPromise(Effect.scoped(check(config)));
```

## Naming

Generated TypeScript keys use PascalCase per browse-path segment. Non
alphanumeric separators are removed, so `Axis_ManualControl1` becomes
`AxisManualControl1`. Leading digits are prefixed with `_`.

If two siblings generate the same key, codegen fails with a diagnostic instead
of silently choosing one. If a variable references a custom data type without a
usable definition, codegen emits a warning and falls back to a dynamic or scalar
codec where possible.

## Enum And Structure Scope

Structures are generated from OPC UA `DataTypeDefinition` attributes reachable
from emitted variables, including transitive structure fields. Enums are
generated from `DataTypeDefinition` when available, with a narrow fallback to
standard `EnumValues` / `EnumStrings` properties for servers that expose enum
metadata there. Codegen does not dump every DataType under `Types`.

If a server does not expose supported metadata for a referenced type, codegen
does not infer it from sample values, encoding nodes, or legacy
DataTypeDictionary nodes. Unsupported structure fields become `Schema.Unknown`.
Unsupported variable types use `Opcua.dynamic()`. Unions are reported and use the
same broad fallbacks.

Methods, manual codec overrides, namespace-URI-stable NodeId emission, and
manifest-backed output ownership are intentionally deferred.
