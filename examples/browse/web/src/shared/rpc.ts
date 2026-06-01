import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const JsonValueSchema: Schema.Codec<unknown> = Schema.suspend(
  (): Schema.Codec<unknown> =>
    Schema.Union([
      Schema.Null,
      Schema.Boolean,
      Schema.Finite,
      Schema.String,
      Schema.Array(JsonValueSchema),
      Schema.Record(Schema.String, JsonValueSchema),
    ]),
);

export class WebRpcError extends Schema.ErrorClass<WebRpcError>(
  "WebRpcError",
)({
  _tag: Schema.tag("WebRpcError"),
  message: Schema.String,
  operation: Schema.String,
  nodeId: Schema.optional(Schema.String),
  cause: Schema.optional(JsonValueSchema),
}) {}

export const AuthSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Anonymous"),
  }),
  Schema.Struct({
    _tag: Schema.Literal("UserPassword"),
    username: Schema.String,
    password: Schema.String,
  }),
]);
export type Auth = typeof AuthSchema.Type;

export const ConnectRequestSchema = Schema.Struct({
  endpointUrl: Schema.String,
  startNodeId: Schema.optional(Schema.String),
  auth: AuthSchema,
});
export type ConnectRequest = typeof ConnectRequestSchema.Type;

export const AccessBitsSchema = Schema.Struct({
  readable: Schema.Boolean,
  writable: Schema.Boolean,
});
export type AccessBits = typeof AccessBitsSchema.Type;

export const NodeMetadataSchema = Schema.Struct({
  nodeId: Schema.String,
  nodeClass: Schema.optional(Schema.String),
  browseName: Schema.optional(Schema.String),
  browseNameNamespaceIndex: Schema.optional(Schema.Number),
  displayName: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  dataType: Schema.optional(Schema.String),
  valueRank: Schema.optional(Schema.Number),
  arrayDimensions: Schema.optional(Schema.Array(Schema.Number)),
  accessLevel: Schema.optional(AccessBitsSchema),
  userAccessLevel: Schema.optional(AccessBitsSchema),
  namespaceIndex: Schema.optional(Schema.Number),
  namespaceUri: Schema.optional(Schema.String),
});
export type NodeMetadata = typeof NodeMetadataSchema.Type;

export const MetadataFailureSchema = Schema.Struct({
  nodeId: Schema.String,
  message: Schema.String,
  attribute: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
});
export type MetadataFailure = typeof MetadataFailureSchema.Type;

export const StatusInfoSchema = Schema.Struct({
  text: Schema.String,
  code: Schema.Number,
  isGood: Schema.Boolean,
  isUncertain: Schema.Boolean,
  isBad: Schema.Boolean,
});
export type StatusInfo = typeof StatusInfoSchema.Type;

export const VariantInfoSchema = Schema.Struct({
  dataType: Schema.String,
  arrayType: Schema.Literals(["Scalar", "Array", "Matrix"]),
  valueRank: Schema.optional(Schema.Number),
  arrayDimensions: Schema.optional(Schema.Array(Schema.Number)),
});
export type VariantInfo = typeof VariantInfoSchema.Type;

export const ReadValueSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Value"),
    nodeId: Schema.String,
    value: JsonValueSchema,
    status: StatusInfoSchema,
    sourceTimestamp: Schema.optional(Schema.String),
    serverTimestamp: Schema.optional(Schema.String),
    variant: Schema.optional(VariantInfoSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("NonGoodStatus"),
    nodeId: Schema.String,
    status: StatusInfoSchema,
    sourceTimestamp: Schema.optional(Schema.String),
    serverTimestamp: Schema.optional(Schema.String),
    variant: Schema.optional(VariantInfoSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("DecodeError"),
    nodeId: Schema.String,
    error: JsonValueSchema,
    status: StatusInfoSchema,
    sourceTimestamp: Schema.optional(Schema.String),
    serverTimestamp: Schema.optional(Schema.String),
    variant: Schema.optional(VariantInfoSchema),
  }),
]);
export type ReadValue = typeof ReadValueSchema.Type;

export const DataTypeFieldSchema = Schema.Struct({
  name: Schema.String,
  dataTypeNodeId: Schema.String,
  valueRank: Schema.optional(Schema.Number),
  arrayDimensions: Schema.optional(Schema.Array(Schema.Number)),
  isOptional: Schema.optional(Schema.Boolean),
  description: Schema.optional(Schema.String),
});

export const EnumFieldSchema = Schema.Struct({
  name: Schema.String,
  value: Schema.Number,
  description: Schema.optional(Schema.String),
});

export const DataTypeDefinitionSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Structure"),
    dataTypeNodeId: Schema.String,
    name: Schema.String,
    structureType: Schema.Literals([
      "Structure",
      "StructureWithOptionalFields",
      "Union",
      "Unknown",
    ]),
    fields: Schema.Array(DataTypeFieldSchema),
  }),
  Schema.Struct({
    _tag: Schema.Literal("Enum"),
    dataTypeNodeId: Schema.String,
    name: Schema.String,
    fields: Schema.Array(EnumFieldSchema),
  }),
]);
export type DataTypeDefinition = typeof DataTypeDefinitionSchema.Type;

export const DataTypeDefinitionResultSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Success"),
    dataTypeNodeId: Schema.String,
    definition: DataTypeDefinitionSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Missing"),
    dataTypeNodeId: Schema.String,
    reason: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Unsupported"),
    dataTypeNodeId: Schema.String,
    reason: Schema.String,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Failure"),
    dataTypeNodeId: Schema.String,
    reason: Schema.String,
  }),
]);
export type DataTypeDefinitionResult =
  typeof DataTypeDefinitionResultSchema.Type;

export const BrowseReferenceSchema = Schema.Struct({
  nodeId: Schema.String,
  namespaceIndex: Schema.optional(Schema.Number),
  namespaceUri: Schema.optional(Schema.String),
  isRemote: Schema.Boolean,
  referenceTypeId: Schema.optional(Schema.String),
  isForward: Schema.optional(Schema.Boolean),
  nodeClass: Schema.optional(Schema.String),
  browseName: Schema.optional(Schema.String),
  displayName: Schema.optional(Schema.String),
  typeDefinition: Schema.optional(Schema.String),
  metadata: Schema.optional(NodeMetadataSchema),
  metadataFailure: Schema.optional(MetadataFailureSchema),
});
export type BrowseReference = typeof BrowseReferenceSchema.Type;

export const BrowseResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  status: StatusInfoSchema,
  references: Schema.Array(BrowseReferenceSchema),
});
export type BrowseResponse = typeof BrowseResponseSchema.Type;

export const ReadNodeResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  metadata: NodeMetadataSchema,
  value: Schema.optional(ReadValueSchema),
  valueError: Schema.optional(WebRpcError),
  dataTypeDefinition: Schema.optional(DataTypeDefinitionResultSchema),
});
export type ReadNodeResponse = typeof ReadNodeResponseSchema.Type;

export const WriteStatusSchema = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal("Written"),
    nodeId: Schema.String,
    status: StatusInfoSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("NonGoodStatus"),
    nodeId: Schema.String,
    status: StatusInfoSchema,
  }),
  Schema.Struct({
    _tag: Schema.Literal("Failed"),
    nodeId: Schema.String,
    message: Schema.String,
  }),
]);
export type WriteStatus = typeof WriteStatusSchema.Type;

export const WriteNodeResponseSchema = Schema.Struct({
  nodeId: Schema.String,
  write: WriteStatusSchema,
  refreshed: ReadNodeResponseSchema,
});
export type WriteNodeResponse = typeof WriteNodeResponseSchema.Type;

export const MonitorSampleSchema = Schema.Struct({
  nodeId: Schema.String,
  metadata: Schema.optional(NodeMetadataSchema),
  sample: ReadValueSchema,
});
export type MonitorSample = typeof MonitorSampleSchema.Type;

export const UaBrowserRpcs = RpcGroup.make(
  Rpc.make("Connect", {
    payload: ConnectRequestSchema,
    success: ReadNodeResponseSchema,
    error: WebRpcError,
  }),
  Rpc.make("Disconnect", {
    success: Schema.Struct({ disconnected: Schema.Boolean }),
    error: WebRpcError,
  }),
  Rpc.make("Browse", {
    payload: { nodeId: Schema.String },
    success: BrowseResponseSchema,
    error: WebRpcError,
  }),
  Rpc.make("ReadNode", {
    payload: { nodeId: Schema.String },
    success: ReadNodeResponseSchema,
    error: WebRpcError,
  }),
  Rpc.make("WriteNode", {
    payload: {
      nodeId: Schema.String,
      value: JsonValueSchema,
    },
    success: WriteNodeResponseSchema,
    error: WebRpcError,
  }),
  Rpc.make("MonitorValues", {
    payload: {
      nodeIds: Schema.Array(Schema.String),
      samplingIntervalMs: Schema.Number,
    },
    success: MonitorSampleSchema,
    error: WebRpcError,
    stream: true,
  }),
);

export type UaBrowserRpcs = typeof UaBrowserRpcs;
