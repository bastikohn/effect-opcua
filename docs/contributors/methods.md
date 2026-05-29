# Methods

## Method definitions

`Opcua.method(...)` creates a `MethodDef`:

- `objectId`
- `methodId`
- optional `input`
- optional `output`
- optional `includeRaw`

Inputs and outputs are records of `Opcua.arg(...)`.

```ts
const Reset = Opcua.method({
  objectId: "ns=2;s=Machine",
  methodId: "ns=2;s=Machine.Reset",
  input: {
    mode: Opcua.arg({
      name: "Mode",
      codec: Opcua.schema(Schema.Literal("soft", "hard")),
    }),
  },
});
```

## Metadata discovery

Method metadata reads:

- executable flags from the method node
- user executable flags when available
- `InputArguments`
- `OutputArguments`
- argument data types and built-in data types

Non-executable methods fail before call preflight with
`MethodNotExecutable`.

## Argument mapping

Every OPC UA argument must be declared explicitly in v1.

Each public key maps to one OPC UA argument by:

- `name`, if `Opcua.arg({ name })` is provided
- `index`, if `Opcua.arg({ index })` is provided
- the public key as an OPC UA argument name by default

Mapping fails if:

- a selector does not resolve
- a selector resolves more than once
- two public keys target the same OPC UA argument
- the definition does not cover every OPC UA argument
- `name` and `index` are both provided

Codec metadata validation runs against every mapped argument.

## Call preflight

Before a service call, the implementation:

1. validates `includeRaw` options
2. initializes the structure runtime if input or output codecs need it
3. checks that input is an object
4. rejects missing and unknown input keys
5. encodes input values to node-opcua `Variant` values

Input key errors use `MethodInput` with phases such as `MissingInputKey`,
`UnknownInputKey`, `ArgumentMapping`, and `Encoding`.

## Result handling

The service response becomes:

- `Called` when method status is good and outputs decode
- `NonGoodStatus` when method status is non-good
- `DecodeError` when status is good but output decoding fails

Input argument status results are normalized and included when present.

Raw request and result data are included only when `includeRaw` is enabled on
the method definition or the specific call.

Relevant tests:

- `packages/client/test/methods.test.ts`
- `packages/client/test/batch.test.ts`
- `packages/client/test/types.tst.ts`
