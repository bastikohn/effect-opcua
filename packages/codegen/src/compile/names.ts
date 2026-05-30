import { errorIssue } from "../diagnostics.js";
import type {
  CodegenIssue,
  DiscoveredNode,
  DiscoveryModel,
  GeneratedPath,
} from "../types.js";

export type SurfaceNode = GeneratedPath & {
  readonly node: DiscoveredNode;
};

export const surfaceNodes = (
  discovery: DiscoveryModel,
): readonly SurfaceNode[] =>
  [...discovery.nodes.values()]
    .map((node) => ({ node, ...relativeGeneratedPath(discovery, node) }))
    .filter((item) => item.path.length > 0)
    .sort((left, right) =>
      pathKey(left.path).localeCompare(pathKey(right.path)),
    );

export const pathIssues = (
  items: readonly SurfaceNode[],
): readonly CodegenIssue[] => {
  const issues: CodegenIssue[] = [];
  for (const item of items) {
    const index = item.generatedPath.findIndex((segment) => segment === "");
    if (index >= 0) {
      issues.push(
        errorIssue("path.emptyGeneratedKey", {
          message: "BrowseName segment does not produce a TypeScript key",
          path: item.path,
          generatedPath: item.generatedPath,
          nodeId: item.node.nodeId,
          cause: { segment: item.path[index] },
        }),
      );
    }
  }
  for (const [, siblings] of groupByParent(items)) {
    const groups = new Map<string, string[]>();
    for (const item of siblings) {
      const key = item.generatedPath.at(-1);
      const original = item.path.at(-1);
      if (!key || !original) continue;
      groups.set(key, [...(groups.get(key) ?? []), original]);
    }
    for (const [generatedKey, candidates] of groups) {
      if (new Set(candidates).size > 1) {
        issues.push(
          errorIssue("path.generatedKeyCollision", {
            message:
              "Two sibling BrowseName segments generate the same TypeScript key",
            path: siblings[0]?.path.slice(0, -1),
            generatedPath: siblings[0]?.generatedPath.slice(0, -1),
            cause: { generatedKey, candidates },
          }),
        );
      }
    }
  }
  return issues;
};

export const sanitizePascal = (value: string): string | undefined => {
  const parts = value.match(/[A-Za-z0-9]+/g) ?? [];
  if (parts.length === 0) return undefined;
  const joined = parts.map(capitalize).join("");
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
};

export const sanitizeCamel = (value: string): string | undefined => {
  const parts = identifierWords(value);
  if (parts.length === 0) return undefined;
  const joined = parts
    .map((part, index) =>
      index === 0 ? part.toLowerCase() : capitalize(part.toLowerCase()),
    )
    .join("");
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
};

export const nodeOpcuaFieldName = (value: string): string => {
  if (value.length >= 2 && isAllUpperAlpha(value)) return value;
  if (value.includes("_"))
    return value.split("_").map(nodeOpcuaFieldName).join("_");
  let result = `${value.charAt(0).toLowerCase()}${value.slice(1)}`;
  if (result.length > 3 && isUpper(value[1] ?? "") && isUpper(value[2] ?? "")) {
    result = `${value.slice(0, 2).toLowerCase()}${value.slice(2)}`;
  }
  return result;
};

export const pathKey = (path: readonly string[]) => path.join(".");

export const displayPath = (path: readonly string[]) => path.join(" / ");

const relativeGeneratedPath = (
  discovery: DiscoveryModel,
  node: DiscoveredNode,
): GeneratedPath => {
  const root = discovery.roots.find(
    (item) => item.rootIndex === node.rootIndex,
  );
  if (!root) return generatedPath(node.path);
  const stripped = node.path.slice(root.path.length);
  return generatedPath(
    root.exportPrefix ? [root.exportPrefix, ...stripped] : stripped,
  );
};

const generatedPath = (path: readonly string[]): GeneratedPath => ({
  path,
  generatedPath: path.map((segment) => sanitizePascal(segment) ?? ""),
});

const groupByParent = (items: readonly SurfaceNode[]) => {
  const groups = new Map<string, readonly SurfaceNode[]>();
  for (const item of items) {
    const key = item.path.slice(0, -1).join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
};

const capitalize = (word: string) =>
  word.length === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const identifierWords = (value: string): readonly string[] =>
  (value.match(/[A-Za-z0-9]+/g) ?? []).flatMap(splitIdentifierPart);

const splitIdentifierPart = (part: string): readonly string[] =>
  part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").match(/[A-Za-z0-9]+/g) ?? [];

const isAllUpperAlpha = (value: string) => {
  let alpha = 0;
  for (const char of value) {
    if (isLower(char)) return false;
    if (isUpper(char)) alpha++;
  }
  return alpha > 0;
};

const isLower = (char: string) => char >= "a" && char <= "z";
const isUpper = (char: string) => char >= "A" && char <= "Z";
