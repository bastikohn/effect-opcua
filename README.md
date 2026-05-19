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

## Structures

Define OPC-UA `ExtensionObject` structures with `OpcuaStructure`. The schema
direction is:

- `Schema.decode`: OPC-UA POJO body to public app value
- `Schema.encode`: public app value to OPC-UA POJO body

```ts
const ScanSettings = OpcuaStructure.make({
  name: "ScanSettings",
  dataTypeId: "ns=1;i=3010",
  schema: Schema.Struct({
    duration: Schema.Number,
    cycles: Schema.Number,
    dataAvailable: Schema.Boolean,
  }),
});
```

Read and write a scalar structure value:

```ts
const handle =
  yield *
  session.valueHandle({
    nodeId: "ns=1;s=MyMachine.ScanSettings",
    structure: ScanSettings,
    capabilities: Capabilities.readWrite,
  });

const current = yield * handle.read();

yield *
  handle.write({
    duration: 1000,
    cycles: 5,
    dataAvailable: true,
  });
```

Read and write a one-dimensional structure array:

```ts
const queue =
  yield *
  session.valueHandle({
    nodeId: "ns=1;s=MyMachine.ScanSettingsQueue",
    structure: OpcuaStructure.array(ScanSettings),
    capabilities: Capabilities.readWrite,
  });
```

Call a method with mixed structure and scalar arguments:

```ts
const startScan =
  yield *
  session.methodHandle({
    objectId: "ns=1;s=MyMachine",
    methodId: "ns=1;s=MyMachine.StartScan",
    input: {
      Settings: ScanSettings,
      DryRun: Schema.Boolean,
    },
    output: {
      Accepted: Schema.Boolean,
    },
  });

const result =
  yield *
  startScan.call({
    Settings: {
      duration: 1000,
      cycles: 5,
      dataAvailable: true,
    },
    DryRun: false,
  });
```

Rename public method keys with explicit OPC-UA argument selectors:

```ts
const startScan =
  yield *
  session.methodHandle({
    objectId,
    methodId,
    input: {
      settings: {
        opcuaArgumentName: "Settings",
        structure: ScanSettings,
      },
      dryRun: {
        opcuaArgumentName: "DryRun",
        schema: Schema.Boolean,
      },
    },
    output: {
      accepted: {
        opcuaArgumentName: "Accepted",
        schema: Schema.Boolean,
      },
    },
  });
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm build
pnpm test
```
