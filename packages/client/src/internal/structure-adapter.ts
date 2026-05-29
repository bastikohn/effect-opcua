import { ExtensionObject } from "node-opcua";

import { isPlainRecord } from "./predicates.js";

export type StructureBody = Readonly<Record<string, unknown>>;

export const isNodeOpcuaExtensionObject = (
  value: unknown,
): value is ExtensionObject => value instanceof ExtensionObject;

export const extensionObjectTypeName = (
  value: ExtensionObject,
): string | undefined => {
  const name = value.constructor?.name;
  return name && name !== "ExtensionObject" ? name : undefined;
};

export const structureBodyFromExtensionObject = (
  value: unknown,
): StructureBody => {
  if (!isNodeOpcuaExtensionObject(value)) {
    throw new TypeError("Expected node-opcua ExtensionObject");
  }
  return extensionObjectBody(value);
};

export const extensionObjectBody = (value: ExtensionObject): StructureBody => {
  const json = extensionObjectJson(value);
  const entries = Object.entries(
    value as unknown as Record<string, unknown>,
  ).filter(([key]) => isStructureDataKey(key));

  if (json && (Object.keys(json).length > 0 || entries.length === 0)) {
    return json;
  }
  if (entries.length > 0) return Object.fromEntries(entries);

  throw new TypeError(
    `Could not extract ExtensionObject body${extensionObjectNameSuffix(value)}`,
  );
};

const extensionObjectJson = (
  value: ExtensionObject,
): StructureBody | undefined => {
  const toJSON = (value as { readonly toJSON?: unknown }).toJSON;
  if (typeof toJSON !== "function") return undefined;

  const json = toJSON.call(value);
  if (json === undefined || json === null) return undefined;
  if (isPlainRecord(json)) return json;

  throw new TypeError(
    `ExtensionObject toJSON() must return a plain object${extensionObjectNameSuffix(value)}`,
  );
};

const extensionObjectNameSuffix = (value: ExtensionObject) => {
  const name = extensionObjectTypeName(value);
  return name ? ` for ${name}` : "";
};

const isStructureDataKey = (key: string) =>
  !key.startsWith("_") &&
  key !== "schema" &&
  key !== "encode" &&
  key !== "decode" &&
  key !== "binaryStoreSize" &&
  key !== "constructor";
