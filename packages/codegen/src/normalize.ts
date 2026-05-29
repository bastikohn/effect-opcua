import { Effect } from "effect";

import { diagnostic, sortDiagnostics } from "./diagnostics.js";
import { codegenError } from "./errors.js";
import type {
  CodecExpression,
  CodegenDiagnostic,
  CodegenIr,
  DiscoveredAddressSpace,
  DiscoveredNode,
  NodeIdDefinition,
  NormalizedCodegenConfig,
  VariableDefinition,
} from "./types.js";

const numericDataTypeNodeIds = new Set([
  "i=2",
  "i=3",
  "i=4",
  "i=5",
  "i=6",
  "i=7",
  "i=8",
  "i=9",
  "i=10",
  "i=11",
  "i=26",
  "i=27",
  "i=28",
  "i=29",
]);

export const normalizeToIr = (
  config: NormalizedCodegenConfig,
  discovered: DiscoveredAddressSpace,
): Effect.Effect<CodegenIr, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    const diagnostics: CodegenDiagnostic[] = [...discovered.diagnostics];
    const surfaceNodes = [...discovered.nodes.values()]
      .filter((node) => relativePath(config, discovered, node).length > 0)
      .sort((left, right) => left.browsePath.localeCompare(right.browsePath));

    const variables: VariableDefinition[] = [];
    for (const node of surfaceNodes) {
      if (node.nodeClass !== "Variable") continue;
      const access = variableAccess(node);
      if (access === "writeOnly") {
        diagnostics.push(
          diagnostic("variable.writeOnlySkipped", {
            message: `Skipped write-only variable ${node.browsePath}`,
            browsePath: node.browsePath,
            nodeId: node.nodeId,
          }),
        );
        continue;
      }
      const codec = inferCodec(node);
      if (codec.diagnostic) diagnostics.push(codec.diagnostic);
      variables.push({
        exportName: pascalIdentifier(relativePath(config, discovered, node)),
        nodeIdPath: relativePath(config, discovered, node),
        browsePath: node.browsePath,
        nodeId: node.nodeId,
        codec: codec.codec,
        access,
      });
    }
    const variableCollision = firstExportCollision(variables);
    if (variableCollision) {
      return yield* Effect.fail(
        codegenError({
          _tag: "ExportNameCollision",
          exportName: variableCollision.exportName,
          candidates: variableCollision.candidates,
        }),
      );
    }
    const nodeIds = variables.map((variable) => ({
      nodeId: variable.nodeId,
      browsePath: variable.browsePath,
      browsePathSegments: variable.nodeIdPath,
    }));
    const nodeIdCollision = firstPathCollision(nodeIds);
    if (nodeIdCollision) {
      return yield* Effect.fail(
        codegenError({
          _tag: "ExportNameCollision",
          exportName: nodeIdCollision.exportName,
          candidates: nodeIdCollision.candidates,
        }),
      );
    }

    return {
      nodeIds,
      variables: variables.sort((left, right) =>
        left.browsePath.localeCompare(right.browsePath),
      ),
      methods: [],
      enums: [],
      structures: [],
      diagnostics: sortDiagnostics(diagnostics),
    };
  });

const relativePath = (
  config: NormalizedCodegenConfig,
  discovered: DiscoveredAddressSpace,
  node: DiscoveredNode,
) => {
  if (!config.naming.rootStripping)
    return normalizeSegments(node.browsePathSegments);
  const root = discovered.roots.find(
    (item) => item.rootIndex === node.rootIndex,
  );
  if (!root) return normalizeSegments(node.browsePathSegments);
  const stripped = node.browsePathSegments.slice(
    root.browsePathSegments.length,
  );
  return normalizeSegments(
    root.exportPrefix ? [root.exportPrefix, ...stripped] : stripped,
  );
};

const normalizeSegments = (segments: readonly string[]) =>
  segments.map(identifierSegment);

const identifierSegment = (segment: string) => {
  const words = segment.match(/[A-Za-z0-9]+/g) ?? ["Value"];
  const joined = words.map(capitalize).join("");
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
};

const pascalIdentifier = (segments: readonly string[]) =>
  identifierSegment(segments.join(" "));

const capitalize = (word: string) =>
  word.length === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const variableAccess = (
  node: DiscoveredNode,
): "read" | "readWrite" | "writeOnly" => {
  const effective = node.userAccessLevel ?? node.accessLevel;
  if (effective?.writable && !effective.readable) return "writeOnly";
  if (node.userAccessLevel?.writable) return "readWrite";
  if (node.accessLevel?.writable) return "readWrite";
  return "read";
};

const inferCodec = (
  node: DiscoveredNode,
): {
  readonly codec: CodecExpression;
  readonly diagnostic?: CodegenDiagnostic;
} => {
  const scalar = scalarSchema(node.dataTypeNodeId);
  const isArray = node.valueRank !== undefined && node.valueRank >= 0;
  if (isArray && node.valueRank !== 1) {
    return {
      codec: { _tag: "Dynamic" },
      diagnostic: diagnostic("codec.unsupportedArrayRank", {
        message: `Variable ${node.browsePath} has unsupported array rank ${node.valueRank}`,
        browsePath: node.browsePath,
        nodeId: node.nodeId,
      }),
    };
  }
  if (isArray && scalar) {
    return { codec: { _tag: "SchemaArray", element: scalar } };
  }
  if (!isArray && scalar) {
    return { codec: { _tag: "Schema", schema: scalar } };
  }
  return {
    codec: { _tag: "Dynamic" },
    diagnostic: diagnostic("codec.dynamicFallback", {
      message: `Variable ${node.browsePath} uses dynamic codec fallback`,
      browsePath: node.browsePath,
      nodeId: node.nodeId,
    }),
  };
};

const scalarSchema = (
  dataTypeNodeId: string | undefined,
): "Boolean" | "Number" | "String" | "Date" | undefined => {
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

const normalizeNamespaceZeroNodeId = (nodeId: string | undefined) =>
  nodeId?.startsWith("ns=0;") ? nodeId.slice("ns=0;".length) : nodeId;

const firstPathCollision = (nodeIds: readonly NodeIdDefinition[]) => {
  const groups = new Map<string, string[]>();
  for (const nodeId of nodeIds) {
    const key = nodeId.browsePathSegments.join(".");
    groups.set(key, [...(groups.get(key) ?? []), nodeId.browsePath]);
  }
  for (const [exportName, candidates] of groups) {
    if (candidates.length > 1) return { exportName, candidates };
  }
  return undefined;
};

const firstExportCollision = (variables: readonly VariableDefinition[]) => {
  const groups = new Map<string, string[]>();
  for (const variable of variables) {
    groups.set(variable.exportName, [
      ...(groups.get(variable.exportName) ?? []),
      variable.browsePath,
    ]);
  }
  for (const [exportName, candidates] of groups) {
    if (candidates.length > 1) return { exportName, candidates };
  }
  return undefined;
};
