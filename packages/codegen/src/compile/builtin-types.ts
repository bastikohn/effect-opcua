import type { ScalarSchema } from "../internal/types.js";

const numericDataTypeNodeIds = new Set([
  "i=2",
  "i=3",
  "i=4",
  "i=5",
  "i=6",
  "i=7",
  "i=10",
  "i=11",
  "i=26",
  "i=27",
  "i=28",
  "i=29",
]);

const dynamicScalarDataTypeNodeIds = new Set(["i=8", "i=9"]);

export const scalarSchema = (
  dataTypeNodeId: string | undefined,
): ScalarSchema | undefined => {
  const normalized = normalizeNamespaceZeroNodeId(dataTypeNodeId);
  switch (normalized) {
    case "i=1":
      return "Boolean";
    case "i=12":
    case "i=21":
      return "String";
    case "i=13":
      return "Date";
    default:
      return normalized && numericDataTypeNodeIds.has(normalized)
        ? "Number"
        : undefined;
  }
};

export const isDynamicScalarDataType = (
  dataTypeNodeId: string | undefined,
): boolean => {
  const normalized = normalizeNamespaceZeroNodeId(dataTypeNodeId);
  return normalized ? dynamicScalarDataTypeNodeIds.has(normalized) : false;
};

export const requiresDataTypeDefinition = (
  dataTypeNodeId: string | undefined,
): dataTypeNodeId is string =>
  !!dataTypeNodeId &&
  !isNamespaceZeroNodeId(dataTypeNodeId) &&
  !scalarSchema(dataTypeNodeId) &&
  !isDynamicScalarDataType(dataTypeNodeId);

export const isUnsupportedArrayRank = (valueRank: number | undefined) =>
  valueRank !== undefined && valueRank >= 0 && valueRank !== 1;

const normalizeNamespaceZeroNodeId = (nodeId: string | undefined) =>
  nodeId?.startsWith("ns=0;") ? nodeId.slice("ns=0;".length) : nodeId;

const isNamespaceZeroNodeId = (nodeId: string) =>
  /^i=\d+$/.test(nodeId) || /^ns=0;i=\d+$/.test(nodeId);
