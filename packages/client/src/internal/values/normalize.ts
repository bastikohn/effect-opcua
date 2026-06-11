import {
  coerceNodeId,
  DataType,
  LocalizedText,
  NodeId,
  QualifiedName,
  VariantArrayType,
  type ExpandedNodeId,
  type StatusCode,
  type Variant,
} from "node-opcua";

import {
  extensionObjectBody,
  extensionObjectTypeName,
  isNodeOpcuaExtensionObject,
} from "../structures/adapter.js";
import type {
  OpcuaDynamicValue,
  OpcuaExpandedNodeIdInfo,
  OpcuaLocalizedTextInfo,
  OpcuaNodeIdInfo,
  OpcuaQualifiedNameInfo,
  OpcuaStatusInfo,
  OpcuaVariantInfo,
} from "../../OpcuaVariable.js";
export type {
  OpcuaDynamicValue,
  OpcuaExpandedNodeIdInfo,
  OpcuaLocalizedTextInfo,
  OpcuaNodeIdInfo,
  OpcuaQualifiedNameInfo,
  OpcuaStatusInfo,
  OpcuaVariantInfo,
} from "../../OpcuaVariable.js";

export const normalizeNodeId = (nodeId: NodeId): OpcuaNodeIdInfo => ({
  text: nodeId.toString(),
  namespace: nodeId.namespace,
  value: nodeId.value,
  identifierType: String(nodeId.identifierType),
});

export const normalizeExpandedNodeId = (
  nodeId: ExpandedNodeId,
): OpcuaExpandedNodeIdInfo => {
  const isRemote = Boolean(nodeId.namespaceUri) || Boolean(nodeId.serverIndex);
  return {
    text: nodeId.toString(),
    namespace: nodeId.namespace,
    value: nodeId.value,
    identifierType: String(nodeId.identifierType),
    namespaceUri: nodeId.namespaceUri ?? undefined,
    serverIndex: nodeId.serverIndex || undefined,
    isLocal: !isRemote,
    isRemote,
  };
};

export const normalizeQualifiedName = (name: {
  readonly namespaceIndex?: number;
  readonly name?: string | null;
  readonly toString: () => string;
}): OpcuaQualifiedNameInfo => ({
  namespaceIndex: name.namespaceIndex ?? 0,
  name: name.name ?? "",
  text: name.toString(),
});

export const normalizeLocalizedText = (text: {
  readonly text?: string | null;
  readonly locale?: string | null;
}): OpcuaLocalizedTextInfo => ({
  text: text.text ?? "",
  locale: text.locale ?? undefined,
});

export const normalizeStatusCode = (
  statusCode: StatusCode,
): OpcuaStatusInfo => ({
  text: statusCode.toString(),
  code: statusCode.value,
  isGood: statusCode.isGood(),
  isUncertain: !statusCode.isGood() && !statusCode.isBad(),
  isBad: statusCode.isBad(),
});

export const normalizeVariantInfo = (variant: Variant): OpcuaVariantInfo => ({
  dataType: DataType[variant.dataType] ?? String(variant.dataType),
  arrayType: VariantArrayType[variant.arrayType] as
    | "Scalar"
    | "Array"
    | "Matrix",
  arrayDimensions: variant.dimensions ?? undefined,
});

export const normalizeDynamicValue = (
  value: unknown,
  variant?: Variant,
): OpcuaDynamicValue => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDynamicValue(item));
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {
      _tag: "ByteString",
      base64: Buffer.from(value).toString("base64"),
    };
  }
  if (value instanceof Date) {
    return { _tag: "DateTime", iso: value.toISOString() };
  }
  if (value instanceof NodeId) {
    return { _tag: "NodeId", ...normalizeNodeId(value) };
  }
  if (typeof value === "bigint") {
    return variant?.dataType === DataType.UInt64
      ? { _tag: "UInt64", text: value.toString() }
      : { _tag: "Int64", text: value.toString() };
  }
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    if (variant?.dataType === DataType.Int64) {
      return { _tag: "Int64", text: String(value) };
    }
    if (variant?.dataType === DataType.UInt64) {
      return { _tag: "UInt64", text: String(value) };
    }
    return value;
  }
  if (value instanceof LocalizedText) {
    return {
      _tag: "LocalizedText",
      text: value.text ?? "",
      locale: value.locale ?? undefined,
    };
  }
  if (value instanceof QualifiedName) {
    return {
      _tag: "QualifiedName",
      namespaceIndex: value.namespaceIndex ?? 0,
      name: value.name ?? "",
      text: value.toString(),
    };
  }
  if (isNodeOpcuaExtensionObject(value)) {
    return {
      _tag: "ExtensionObject",
      typeName: extensionObjectTypeName(value),
      value: normalizePlainObject(extensionObjectBody(value)),
    };
  }
  if (typeof value === "object") {
    return {
      _tag: "Object",
      typeName: objectTypeName(value),
      value: normalizePlainObject(value as Record<string, unknown>),
    };
  }
  return String(value);
};

export type OpcuaDynamicValueMetadata = {
  readonly raw: {
    readonly dataType: DataType;
  };
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
};

const normalizePlainObject = (record: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, value]) => [key, normalizeDynamicValue(value)]),
  );

export const denormalizeDynamicValue = (
  value: unknown,
  metadata?: OpcuaDynamicValueMetadata,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => denormalizeDynamicValue(item, metadata));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const tagged = value as { readonly _tag?: string };
  switch (tagged._tag) {
    case "DateTime":
      assertDynamicDataType(value, metadata, DataType.DateTime);
      return new Date((value as { readonly iso: string }).iso);
    case "ByteString":
      assertDynamicDataType(value, metadata, DataType.ByteString);
      return Buffer.from(
        (value as { readonly base64: string }).base64,
        "base64",
      );
    case "Int64":
      assertDynamicDataType(value, metadata, DataType.Int64);
      return (value as { readonly text: string }).text;
    case "UInt64":
      assertDynamicDataType(value, metadata, DataType.UInt64);
      return (value as { readonly text: string }).text;
    case "NodeId":
      assertDynamicDataType(value, metadata, DataType.NodeId);
      return coerceNodeId((value as { readonly text: string }).text);
    case "LocalizedText": {
      assertDynamicDataType(value, metadata, DataType.LocalizedText);
      const text = value as { readonly text: string; readonly locale?: string };
      return new LocalizedText({ text: text.text, locale: text.locale });
    }
    case "QualifiedName": {
      assertDynamicDataType(value, metadata, DataType.QualifiedName);
      const name = value as {
        readonly namespaceIndex: number;
        readonly name: string;
      };
      return new QualifiedName({
        namespaceIndex: name.namespaceIndex,
        name: name.name,
      });
    }
    case "ExtensionObject":
      throw new TypeError("ExtensionObject dynamic writes require a schema");
    case "Object":
      throw new TypeError("Object dynamic writes require a schema");
    default:
      if (
        metadata?.raw.dataType === DataType.ExtensionObject &&
        value !== null &&
        value !== undefined
      ) {
        throw new TypeError("ExtensionObject dynamic writes require a schema");
      }
      return value;
  }
};

const objectTypeName = (value: object): string | undefined => {
  const name = value.constructor?.name;
  return name && name !== "Object" ? name : undefined;
};

const assertDynamicDataType = (
  value: unknown,
  metadata: OpcuaDynamicValueMetadata | undefined,
  expected: DataType,
) => {
  if (metadata && metadata.raw.dataType !== expected) {
    throw new TypeError(
      `Cannot write ${(value as { readonly _tag?: string })._tag ?? "value"} to DataType.${DataType[metadata.raw.dataType]}`,
    );
  }
};

export const normalizeTimestamp = (timestamp: Date | null | undefined) =>
  timestamp instanceof Date ? timestamp.toISOString() : undefined;
export const isGood = (statusCode: StatusCode) => statusCode.isGood();
export const isArrayRank = (valueRank: number) => valueRank >= 1;
