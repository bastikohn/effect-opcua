import { Effect } from "effect";
import { OpcuaSession } from "@effect-opcua/client";
import type { OpcuaError } from "@effect-opcua/client/OpcuaError";
import type { OpcuaNodeMetadata } from "@effect-opcua/client/OpcuaSession";

import { errorIssue, issue, sortIssues } from "./diagnostics.js";
import { codegenError } from "./errors.js";
import type {
  CodegenIssue,
  DiscoveredNode,
  DiscoveredReference,
  DiscoveredRoot,
  DiscoveryModel,
  NodeKey,
  NormalizedCodegenConfig,
  NormalizedExcludeRule,
  NormalizedRootConfig,
} from "./types.js";

type TraversalItem = {
  readonly nodeId: string;
  readonly parentNodeId?: string;
  readonly rootIndex: number;
  readonly rootSegmentCount: number;
  readonly path: readonly string[];
};

type NodeDraft = Omit<DiscoveredNode, "path" | "allPaths"> & {
  path: readonly string[];
  allPaths: readonly (readonly string[])[];
  rootSegmentCount: number;
};

const objectsFolderNodeId = "i=85";
const allowedReferenceTypes = new Set(["i=35", "i=46", "i=47", "i=49"]);
const metadataPropertyNames = new Set([
  "InputArguments",
  "OutputArguments",
  "EnumStrings",
  "EnumValues",
  "DataTypeVersion",
  "DictionaryFragment",
  "NodeVersion",
]);

export const discover = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  DiscoveryModel,
  import("./errors.js").CodegenError | OpcuaError,
  OpcuaSession.OpcuaSession
> =>
  Effect.gen(function* () {
    const session = yield* OpcuaSession.OpcuaSession;
    const issues: CodegenIssue[] = [];
    const references: DiscoveredReference[] = [];
    const nodes = new Map<NodeKey, NodeDraft>();
    const roots: DiscoveredRoot[] = [];

    for (let rootIndex = 0; rootIndex < config.roots.length; rootIndex++) {
      const rootConfig = config.roots[rootIndex]!;
      const root = yield* resolveRoot(session, rootConfig, rootIndex);
      roots.push({ ...root, exportPrefix: rootConfig.exportPrefix });
      const rootMetadata = yield* session.readNodeMetadata(root.nodeId);
      addOrUpdateNode(nodes, {
        metadata: rootMetadata,
        path: root.path,
        parentNodeId: undefined,
        rootIndex,
        rootSegmentCount: root.path.length,
      });
    }

    const queue: TraversalItem[] = roots.map((root) => ({
      nodeId: root.nodeId,
      rootIndex: root.rootIndex,
      rootSegmentCount: root.path.length,
      path: root.path,
    }));
    const visitedPaths = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const visitKey = `${current.nodeId}\u0000${current.path.join("\u0000")}`;
      if (visitedPaths.has(visitKey)) continue;
      visitedPaths.add(visitKey);

      const result = yield* session.browseChildren(current.nodeId);
      if (result._tag === "NonGoodStatus") {
        const browseIssue = issue("browse.failure", {
          message: `Could not browse ${current.nodeId}`,
          nodeId: current.nodeId,
          path: current.path,
          cause: result.status,
          severity:
            config.discovery.onBrowseFailure === "fail" ? "error" : undefined,
        });
        if (browseIssue.severity === "error") {
          return yield* Effect.fail(
            codegenError({ _tag: "DiscoveryFailed" }, [browseIssue]),
          );
        }
        issues.push(browseIssue);
        continue;
      }

      const children = selectedChildReferences(result.references);
      const duplicate = duplicateBrowseName(children);
      if (duplicate) {
        return yield* Effect.fail(
          codegenError({ _tag: "DiscoveryFailed" }, [
            errorIssue("browse.ambiguousPath", {
              message: "Multiple children have the same BrowseName segment",
              path: [...current.path, duplicate.name],
              cause: { candidates: duplicate.candidates },
            }),
          ]),
        );
      }
      const metadataByNodeId = yield* readChildMetadata(
        session,
        children,
        config.exclude,
        current.path,
      );

      for (const child of children) {
        const browseName = child.browseName?.name;
        const targetNodeId = child.nodeId.text;
        if (!browseName || !targetNodeId) continue;
        const referenceType = normalizeNamespaceZeroNodeId(
          child.referenceTypeId ?? "",
        );
        if (referenceType === "i=46" && metadataPropertyNames.has(browseName)) {
          continue;
        }
        const childPath = [...current.path, browseName];
        references.push({
          sourceNodeId: current.nodeId,
          targetNodeId,
          referenceType,
          isForward: child.isForward ?? true,
          browseName,
        });

        const exclude = matchingExclude(config.exclude, childPath);
        if (exclude?.mode === "prune") {
          issues.push(
            issue("branch.pruned", {
              message: `Pruned ${displayPath(childPath)}`,
              path: childPath,
              nodeId: targetNodeId,
            }),
          );
          continue;
        }

        if (exclude?.mode !== "omit") {
          const metadata = metadataByNodeId.get(targetNodeId);
          if (!metadata) continue;
          addOrUpdateNode(nodes, {
            metadata,
            path: childPath,
            parentNodeId: current.nodeId,
            rootIndex: current.rootIndex,
            rootSegmentCount: current.rootSegmentCount,
          });
        } else {
          issues.push(
            issue("node.omitted", {
              message: `Omitted ${displayPath(childPath)}`,
              path: childPath,
              nodeId: targetNodeId,
            }),
          );
        }

        if (shouldBrowseChildren(child.nodeClass)) {
          queue.push({
            nodeId: targetNodeId,
            parentNodeId: current.nodeId,
            rootIndex: current.rootIndex,
            rootSegmentCount: current.rootSegmentCount,
            path: childPath,
          });
        }
      }
    }

    for (const node of nodes.values()) {
      if (node.allPaths.length > 1) {
        issues.push(
          issue("node.multiPath", {
            message: `Node ${node.nodeId} was reached through multiple paths`,
            path: node.path,
            nodeId: node.nodeId,
          }),
        );
      }
    }

    const finalizedNodes = finalizeNodes(nodes);
    const dataTypeDefinitions = yield* discoverDataTypeDefinitions(
      session,
      finalizedNodes,
    );

    return {
      roots,
      nodes: finalizedNodes,
      references: sortReferences(references),
      dataTypeDefinitions,
      issues: sortIssues(issues),
    };
  });

const resolveRoot = (
  session: OpcuaSession.OpcuaSession,
  root: NormalizedRootConfig,
  rootIndex: number,
) =>
  root.nodeId !== undefined
    ? resolveNodeIdRoot(
        session,
        root as Extract<NormalizedRootConfig, { readonly nodeId: string }>,
        rootIndex,
      )
    : resolvePathRoot(
        session,
        root as Extract<
          NormalizedRootConfig,
          { readonly path: readonly string[] }
        >,
        rootIndex,
      );

const resolveNodeIdRoot = (
  session: OpcuaSession.OpcuaSession,
  root: Extract<NormalizedRootConfig, { readonly nodeId: string }>,
  rootIndex: number,
) =>
  Effect.gen(function* () {
    const metadata = yield* session.readNodeMetadata(root.nodeId);
    const browseName = metadata.browseName ?? root.nodeId;
    return {
      rootIndex,
      nodeId: root.nodeId,
      path: [browseName],
      exportPrefix: root.exportPrefix,
    } satisfies DiscoveredRoot;
  });

const resolvePathRoot = (
  session: OpcuaSession.OpcuaSession,
  root: Extract<NormalizedRootConfig, { readonly path: readonly string[] }>,
  rootIndex: number,
) =>
  Effect.gen(function* () {
    let currentNodeId = objectsFolderNodeId;
    const resolvedSegments: string[] = [];
    for (const segment of root.path) {
      const result = yield* session.browseChildren(currentNodeId);
      if (result._tag === "NonGoodStatus") {
        return yield* Effect.fail(
          codegenError({ _tag: "DiscoveryFailed" }, [
            errorIssue("root.resolutionFailed", {
              message: `Could not browse ${currentNodeId} while resolving ${displayPath(root.path)}`,
              path: root.path,
              nodeId: currentNodeId,
              cause: result.status,
            }),
          ]),
        );
      }
      const matches = selectedChildReferences(result.references).filter(
        (reference) => reference.browseName?.name === segment,
      );
      if (matches.length === 0) {
        return yield* Effect.fail(
          codegenError({ _tag: "DiscoveryFailed" }, [
            errorIssue("root.resolutionFailed", {
              message: `Missing root path segment ${segment}`,
              path: [...resolvedSegments, segment],
            }),
          ]),
        );
      }
      if (matches.length > 1) {
        return yield* Effect.fail(
          codegenError({ _tag: "DiscoveryFailed" }, [
            errorIssue("browse.ambiguousPath", {
              message: "Multiple children match the root path segment",
              path: [...resolvedSegments, segment],
              cause: { candidates: matches.map((match) => match.nodeId.text) },
            }),
          ]),
        );
      }
      currentNodeId = matches[0]!.nodeId.text;
      resolvedSegments.push(segment);
    }
    return {
      rootIndex,
      nodeId: currentNodeId,
      path: resolvedSegments,
      exportPrefix: root.exportPrefix,
    } satisfies DiscoveredRoot;
  });

const selectedChildReferences = (
  references: readonly OpcuaSession.OpcuaBrowseReference[],
) =>
  references
    .filter((reference) => reference.isForward !== false)
    .filter((reference) =>
      allowedReferenceTypes.has(
        normalizeNamespaceZeroNodeId(reference.referenceTypeId ?? ""),
      ),
    )
    .sort(referenceSort);

const duplicateBrowseName = (
  references: readonly OpcuaSession.OpcuaBrowseReference[],
) => {
  const groups = new Map<string, string[]>();
  for (const reference of references) {
    const name = reference.browseName?.name;
    if (!name) continue;
    const group = groups.get(name) ?? [];
    group.push(reference.nodeId.text);
    groups.set(name, group);
  }
  for (const [name, candidates] of groups) {
    if (candidates.length > 1) return { name, candidates };
  }
  return undefined;
};

const referenceSort = (
  left: OpcuaSession.OpcuaBrowseReference,
  right: OpcuaSession.OpcuaBrowseReference,
) =>
  (left.browseName?.name ?? "").localeCompare(right.browseName?.name ?? "") ||
  (left.nodeClass ?? "").localeCompare(right.nodeClass ?? "") ||
  left.nodeId.text.localeCompare(right.nodeId.text);

const matchingExclude = (
  rules: readonly NormalizedExcludeRule[],
  path: readonly string[],
) =>
  rules.find((rule) =>
    rule._tag === "Path"
      ? samePath(rule.path, path)
      : matchPathPattern(rule.pathPattern, path),
  );

const readChildMetadata = (
  session: OpcuaSession.OpcuaSession,
  children: readonly OpcuaSession.OpcuaBrowseReference[],
  exclude: readonly NormalizedExcludeRule[],
  parentPath: readonly string[],
) =>
  Effect.gen(function* () {
    const metadataTargets = children.flatMap((child) => {
      const browseName = child.browseName?.name;
      const targetNodeId = child.nodeId.text;
      if (!browseName || !targetNodeId) return [];
      const childPath = [...parentPath, browseName];
      return matchingExclude(exclude, childPath)?.mode === "omit"
        ? []
        : [targetNodeId];
    });
    if (metadataTargets.length === 0) {
      return new Map<string, OpcuaNodeMetadata>();
    }

    const results = yield* session.readManyNodeMetadata(metadataTargets);
    const failed = results.find((result) => result._tag === "Failure");
    if (failed?._tag === "Failure") {
      return yield* Effect.fail(
        codegenError({ _tag: "DiscoveryFailed" }, [
          errorIssue("metadata.readFailed", {
            message: `Could not read metadata for ${failed.nodeId}`,
            nodeId: failed.nodeId,
            cause: failed.reason,
          }),
        ]),
      );
    }

    return new Map(
      results.flatMap((result) =>
        result._tag === "Success"
          ? ([[result.nodeId, result.metadata]] as const)
          : [],
      ),
    );
  });

const matchPathPattern = (
  pattern: readonly import("./types.js").PathPatternSegment[],
  path: readonly string[],
): boolean => {
  const match = (patternIndex: number, pathIndex: number): boolean => {
    if (patternIndex === pattern.length) return pathIndex === path.length;
    const segment = pattern[patternIndex]!;
    if (segment === "**") {
      return (
        match(patternIndex + 1, pathIndex) ||
        (pathIndex < path.length && match(patternIndex, pathIndex + 1))
      );
    }
    if (pathIndex >= path.length) return false;
    return (
      segmentMatches(segment, path[pathIndex]!) &&
      match(patternIndex + 1, pathIndex + 1)
    );
  };
  return match(0, 0);
};

const segmentMatches = (
  pattern: Exclude<import("./types.js").PathPatternSegment, "**">,
  segment: string,
) => (pattern instanceof RegExp ? pattern.test(segment) : pattern === segment);

const samePath = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length &&
  left.every((segment, index) => segment === right[index]);

const addOrUpdateNode = (
  nodes: Map<NodeKey, NodeDraft>,
  input: {
    readonly metadata: OpcuaNodeMetadata;
    readonly path: readonly string[];
    readonly parentNodeId?: string;
    readonly rootIndex: number;
    readonly rootSegmentCount: number;
  },
) => {
  const key = input.metadata.nodeId;
  const existing = nodes.get(key);
  if (existing) {
    const allPaths = uniquePaths([...existing.allPaths, input.path]);
    if (
      comparePathRank(
        {
          rootIndex: input.rootIndex,
          rootSegmentCount: input.rootSegmentCount,
          path: input.path,
          nodeId: key,
        },
        {
          rootIndex: existing.rootIndex ?? Number.MAX_SAFE_INTEGER,
          rootSegmentCount: existing.rootSegmentCount,
          path: existing.path,
          nodeId: existing.nodeId,
        },
      ) < 0
    ) {
      nodes.set(key, {
        ...existing,
        path: input.path,
        allPaths,
        parentNodeId: input.parentNodeId,
        rootIndex: input.rootIndex,
        rootSegmentCount: input.rootSegmentCount,
      });
    } else {
      nodes.set(key, { ...existing, allPaths });
    }
    return;
  }
  const nodeClass = normalizeNodeClass(input.metadata.nodeClass);
  if (!nodeClass) return;
  nodes.set(key, {
    key,
    nodeId: key,
    parsedNodeId: parseNodeId(key, input.metadata.namespaceIndex),
    namespaceIndex:
      input.metadata.namespaceIndex ?? parseNodeId(key).namespaceIndex,
    namespaceUri: input.metadata.namespaceUri,
    browseName: input.metadata.browseName ?? input.path.at(-1) ?? key,
    browseNameNamespaceIndex: input.metadata.browseNameNamespaceIndex,
    path: input.path,
    allPaths: [input.path],
    nodeClass,
    displayName: input.metadata.displayName,
    description: input.metadata.description,
    dataTypeNodeId: input.metadata.dataType,
    valueRank: input.metadata.valueRank,
    arrayDimensions: input.metadata.arrayDimensions,
    accessLevel: input.metadata.accessLevel,
    userAccessLevel: input.metadata.userAccessLevel,
    parentNodeId: input.parentNodeId,
    rootIndex: input.rootIndex,
    rootSegmentCount: input.rootSegmentCount,
  });
};

const normalizeNodeClass = (
  nodeClass: string | undefined,
): DiscoveredNode["nodeClass"] | undefined => {
  switch (nodeClass) {
    case "Object":
    case "Variable":
    case "Method":
    case "DataType":
    case "ObjectType":
    case "VariableType":
    case "ReferenceType":
      return nodeClass;
    default:
      return undefined;
  }
};

const shouldBrowseChildren = (nodeClass: string | undefined) =>
  nodeClass === "Object";

const discoverDataTypeDefinitions = (
  session: OpcuaSession.OpcuaSession,
  nodes: ReadonlyMap<NodeKey, DiscoveredNode>,
) =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    const queue = [...nodes.values()]
      .filter((node) => node.nodeClass === "Variable")
      .flatMap((node) => (node.dataTypeNodeId ? [node.dataTypeNodeId] : []))
      .filter((nodeId) => !isBuiltInDataType(nodeId));
    const results: import("@effect-opcua/client/OpcuaSession").OpcuaDataTypeDefinitionResult[] =
      [];

    while (queue.length > 0) {
      const batch = [...new Set(queue.splice(0))]
        .filter((nodeId) => !seen.has(nodeId))
        .sort();
      if (batch.length === 0) continue;
      batch.forEach((nodeId) => seen.add(nodeId));
      const batchResults = yield* session.readManyDataTypeDefinitions(batch);
      results.push(...batchResults);
      for (const result of batchResults) {
        if (
          result._tag !== "Success" ||
          result.definition._tag !== "Structure"
        ) {
          continue;
        }
        for (const field of result.definition.fields) {
          if (
            field.dataTypeNodeId &&
            !isBuiltInDataType(field.dataTypeNodeId) &&
            !seen.has(field.dataTypeNodeId)
          ) {
            queue.push(field.dataTypeNodeId);
          }
        }
      }
    }

    return results;
  });

const isBuiltInDataType = (nodeId: string) => {
  const normalized = normalizeNamespaceZeroNodeId(nodeId);
  return /^i=\d+$/.test(normalized);
};

const parseNodeId = (nodeId: string, namespaceIndex?: number) => {
  const match = /^ns=(\d+);(.+)$/.exec(nodeId);
  return {
    namespaceIndex: namespaceIndex ?? (match ? Number(match[1]) : 0),
    identifier: match?.[2] ?? nodeId,
  };
};

const comparePathRank = (
  left: {
    readonly rootIndex: number;
    readonly rootSegmentCount: number;
    readonly path: readonly string[];
    readonly nodeId: string;
  },
  right: {
    readonly rootIndex: number;
    readonly rootSegmentCount: number;
    readonly path: readonly string[];
    readonly nodeId: string;
  },
) =>
  left.rootIndex - right.rootIndex ||
  relativeLength(left) - relativeLength(right) ||
  displayPath(left.path).localeCompare(displayPath(right.path)) ||
  left.nodeId.localeCompare(right.nodeId);

const relativeLength = (item: {
  readonly rootSegmentCount: number;
  readonly path: readonly string[];
}) => item.path.length - item.rootSegmentCount;

const finalizeNodes = (nodes: ReadonlyMap<NodeKey, NodeDraft>) => {
  const entries: Array<readonly [NodeKey, DiscoveredNode]> = [];
  for (const [key, node] of nodes) {
    entries.push([
      key,
      {
        key: node.key,
        nodeId: node.nodeId,
        parsedNodeId: node.parsedNodeId,
        namespaceIndex: node.namespaceIndex,
        namespaceUri: node.namespaceUri,
        browseName: node.browseName,
        browseNameNamespaceIndex: node.browseNameNamespaceIndex,
        path: node.path,
        allPaths: uniquePaths(node.allPaths),
        nodeClass: node.nodeClass,
        displayName: node.displayName,
        description: node.description,
        dataTypeNodeId: node.dataTypeNodeId,
        valueRank: node.valueRank,
        arrayDimensions: node.arrayDimensions,
        accessLevel: node.accessLevel,
        userAccessLevel: node.userAccessLevel,
        parentNodeId: node.parentNodeId,
        rootIndex: node.rootIndex,
      },
    ]);
  }
  return new Map(
    entries.sort((left, right) =>
      displayPath(left[1].path).localeCompare(displayPath(right[1].path)),
    ),
  ) as ReadonlyMap<NodeKey, DiscoveredNode>;
};

const uniquePaths = (paths: readonly (readonly string[])[]) =>
  [
    ...new Map(paths.map((path) => [path.join("\u0000"), [...path]])).values(),
  ].sort((left, right) => displayPath(left).localeCompare(displayPath(right)));

const sortReferences = (references: readonly DiscoveredReference[]) =>
  [...references].sort(
    (left, right) =>
      left.sourceNodeId.localeCompare(right.sourceNodeId) ||
      left.browseName.localeCompare(right.browseName) ||
      left.targetNodeId.localeCompare(right.targetNodeId),
  );

const displayPath = (path: readonly string[]) => path.join(" / ");

const normalizeNamespaceZeroNodeId = (nodeId: string) =>
  nodeId.startsWith("ns=0;") ? nodeId.slice("ns=0;".length) : nodeId;

export const discoverAddressSpace = discover;
