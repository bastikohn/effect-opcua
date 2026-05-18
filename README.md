# effect-opcua

Local-first workspace for an Effect v4 OPC-UA client wrapper around node-opcua.

## Packages

- `@effect-opcua/client`

## Examples

- `@effect-opcua/demo-server`
- `@effect-opcua/tui`

## Method Calls

Use `browseChildren` to discover Method nodes on an object, then create a
`methodHandle` to read method-specific metadata such as `InputArguments`,
`OutputArguments`, `Executable`, and `UserExecutable`.

```ts
const children = yield * session.browseChildren(objectId);
const methodRef = children.references.find(
  (reference) => reference.nodeClass === "Method",
);

const method =
  yield *
  session.methodHandle({
    objectId,
    methodId: methodRef.nodeId.text,
  });
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```
