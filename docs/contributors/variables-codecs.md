# Variables and codecs

## Variable definitions

`Opcua.variable(...)` creates a `VariableDef`:

- `_tag: "VariableDef"`
- `nodeId`
- `codec`
- `access`
- optional `includeRaw`

Default access is `"read"`. Writable definitions must use `"write"` or
`"readWrite"`.

Type-level access prevents invalid calls at compile time. Runtime access
validation still checks server metadata before direct writes, batch writes, and
strict monitor startup.

## Variable metadata

The metadata service reads these attributes:

- `DataType`
- `ValueRank`
- `ArrayDimensions`
- `AccessLevel`
- `UserAccessLevel`

It resolves the built-in data type from the declared data type and caches the
result. Metadata is invalidated on `session_restored`.

Access validation uses the declared variable access and server metadata to fail
early with `AccessDenied` when the requested capability is unavailable.

## Read and write behavior

Reads:

1. validate variable metadata
2. initialize the structure runtime if the codec needs it
3. read `AttributeIds.Value`
4. return `Value`, `NonGoodStatus`, or `DecodeError`

Writes:

1. validate variable metadata and write access
2. encode the application value to a node-opcua `Variant`
3. write `AttributeIds.Value`
4. return `Written` or `NonGoodStatus`

Service failures fail the Effect. Non-good OPC UA statuses are returned as data
when the operation reached the server and got a normal status response.

## Dynamic codec

`Opcua.dynamic()` is the default codec. It normalizes common node-opcua values
for reads and denormalizes application values for writes using the variable
metadata.

Use it for exploration, escape hatches, and values that should stay close to
OPC UA's native shape.

## Schema codec

`Opcua.schema(schema)` uses synchronous Effect `Schema` encode and decode.

The schema must not require contextual services. Encode failures become
`Encode` errors. Decode failures become `DecodeError` result data for reads,
methods, and monitor samples.

## Structure codecs

`Opcua.structure(...)` describes a scalar `ExtensionObject`:

- `name`: diagnostic name
- `dataTypeId`: exact OPC UA data type NodeId
- `schema`: synchronous Effect `Schema`

`Opcua.structureArray(structure)` describes a one-dimensional array of that
structure.

The structure runtime calls `session.extractNamespaceDataType()` once per
session cache generation. Encoding constructs node-opcua extension objects with
`session.constructExtensionObject`. Decoding strips the extension object wrapper
and runs the schema decoder.

Metadata validation requires:

- built-in type `DataType.ExtensionObject`
- declared data type matching `dataTypeId`
- scalar-compatible value rank for structures
- one-dimensional-array-compatible value rank for structure arrays
- no structure matrices

Relevant tests:

- `packages/client/test/values.test.ts`
- `packages/client/test/structure-runtime.test.ts`
- `packages/client/test/monitoring.test.ts`
- `packages/client/test/types.tst.ts`
