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
  const pascal = sanitizePascal(value);
  if (!pascal) return undefined;
  return pascal.startsWith("_")
    ? pascal
    : `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
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
