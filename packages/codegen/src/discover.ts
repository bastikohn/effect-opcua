import { Effect } from "effect";
import { OpcuaSession } from "@effect-opcua/client";
import type { OpcuaError } from "@effect-opcua/client/OpcuaError";
import type { OpcuaNodeMetadata } from "@effect-opcua/client/OpcuaSession";

import { diagnostic, sortDiagnostics } from "./diagnostics.js";
import { codegenError } from "./errors.js";
import type {
  CodegenDiagnostic,
  DiscoveredAddressSpace,
  DiscoveredNode,
  DiscoveredReference,
  DiscoveredRoot,
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
  readonly browsePathSegments: readonly string[];
};

type NodeDraft = Omit<
  DiscoveredNode,
  "browsePath" | "browsePathSegments" | "allBrowsePaths"
> & {
  browsePath: string;
  browsePathSegments: readonly string[];
  allBrowsePaths: readonly string[];
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

export const discoverAddressSpace = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  DiscoveredAddressSpace,
  import("./errors.js").CodegenError | OpcuaError,
  OpcuaSession.OpcuaSession
> =>
  Effect.gen(function* () {
    const session = yield* OpcuaSession.OpcuaSession;
    const diagnostics: CodegenDiagnostic[] = [];
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
        browsePathSegments: root.browsePathSegments,
        parentNodeId: undefined,
        rootIndex,
        rootSegmentCount: root.browsePathSegments.length,
      });
    }

    const queue: TraversalItem[] = roots.map((root) => ({
      nodeId: root.nodeId,
      rootIndex: root.rootIndex,
      rootSegmentCount: root.browsePathSegments.length,
      browsePathSegments: root.browsePathSegments,
    }));
    const visitedPaths = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift()!;
      const visitKey = `${current.nodeId}\u0000${current.browsePathSegments.join(".")}`;
      if (visitedPaths.has(visitKey)) continue;
      visitedPaths.add(visitKey);

      const result = yield* session.browseChildren(current.nodeId);
      if (result._tag === "NonGoodStatus") continue;

      const children = selectedChildReferences(result.references);
      const duplicate = duplicateBrowseName(children);
      if (duplicate) {
        return yield* Effect.fail(
          codegenError({
            _tag: "AmbiguousBrowsePath",
            browsePath: [...current.browsePathSegments, duplicate.name].join(
              ".",
            ),
            candidates: duplicate.candidates,
          }),
        );
      }

      for (const child of children) {
        const browseName = child.browseName?.name;
        const targetNodeId = child.nodeId.text;
        if (!browseName || !targetNodeId) continue;
        if (browseName.includes(".")) {
          return yield* Effect.fail(
            codegenError({
              _tag: "UnsupportedBrowsePathSegment",
              segment: browseName,
              browsePathSegments: [...current.browsePathSegments, browseName],
            }),
          );
        }
        const referenceType = normalizeNamespaceZeroNodeId(
          child.referenceTypeId ?? "",
        );
        if (referenceType === "i=46" && metadataPropertyNames.has(browseName)) {
          continue;
        }
        const childPathSegments = [...current.browsePathSegments, browseName];
        const childBrowsePath = childPathSegments.join(".");
        references.push({
          sourceNodeId: current.nodeId,
          targetNodeId,
          referenceType,
          isForward: child.isForward ?? true,
          browseName,
        });

        const exclude = matchingExclude(config.exclude, childBrowsePath);
        if (exclude?.mode === "prune") {
          diagnostics.push(
            diagnostic("branch.pruned", {
              message: `Pruned ${childBrowsePath}`,
              browsePath: childBrowsePath,
              nodeId: targetNodeId,
            }),
          );
          continue;
        }

        if (exclude?.mode !== "omit") {
          const metadata = yield* session.readNodeMetadata(targetNodeId);
          addOrUpdateNode(nodes, {
            metadata,
            browsePathSegments: childPathSegments,
            parentNodeId: current.nodeId,
            rootIndex: current.rootIndex,
            rootSegmentCount: current.rootSegmentCount,
          });
        } else {
          diagnostics.push(
            diagnostic("node.omitted", {
              message: `Omitted ${childBrowsePath}`,
              browsePath: childBrowsePath,
              nodeId: targetNodeId,
            }),
          );
        }

        if (
          child.nodeClass === "Object" ||
          child.nodeClass === "Variable" ||
          child.nodeClass === "Method"
        ) {
          queue.push({
            nodeId: targetNodeId,
            parentNodeId: current.nodeId,
            rootIndex: current.rootIndex,
            rootSegmentCount: current.rootSegmentCount,
            browsePathSegments: childPathSegments,
          });
        }
      }
    }

    for (const node of nodes.values()) {
      if (node.allBrowsePaths.length > 1) {
        diagnostics.push(
          diagnostic("node.multiPath", {
            message: `Node ${node.nodeId} was reached through multiple browse paths`,
            browsePath: node.browsePath,
            nodeId: node.nodeId,
          }),
        );
      }
    }

    return {
      roots,
      nodes: finalizeNodes(nodes),
      references: sortReferences(references),
      diagnostics: sortDiagnostics(diagnostics),
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
    : resolveBrowsePathRoot(
        session,
        root as Extract<NormalizedRootConfig, { readonly browsePath: string }>,
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
    if (browseName.includes(".")) {
      return yield* Effect.fail(
        codegenError({
          _tag: "UnsupportedBrowsePathSegment",
          segment: browseName,
          browsePathSegments: [browseName],
        }),
      );
    }
    return {
      rootIndex,
      nodeId: root.nodeId,
      browsePath: browseName,
      browsePathSegments: [browseName],
      exportPrefix: root.exportPrefix,
    } satisfies DiscoveredRoot;
  });

const resolveBrowsePathRoot = (
  session: OpcuaSession.OpcuaSession,
  root: Extract<NormalizedRootConfig, { readonly browsePath: string }>,
  rootIndex: number,
) =>
  Effect.gen(function* () {
    let currentNodeId = objectsFolderNodeId;
    const resolvedSegments: string[] = [];
    for (const segment of root.browsePathSegments) {
      const result = yield* session.browseChildren(currentNodeId);
      if (result._tag === "NonGoodStatus") {
        return yield* Effect.fail(
          codegenError({
            _tag: "RootResolutionFailed",
            root,
            message: `Could not browse ${currentNodeId} while resolving ${root.browsePath}`,
          }),
        );
      }
      const matches = selectedChildReferences(result.references).filter(
        (reference) => reference.browseName?.name === segment,
      );
      if (matches.length === 0) {
        return yield* Effect.fail(
          codegenError({
            _tag: "RootResolutionFailed",
            root,
            message: `Missing root browse path segment ${segment}`,
          }),
        );
      }
      if (matches.length > 1) {
        return yield* Effect.fail(
          codegenError({
            _tag: "AmbiguousBrowsePath",
            browsePath: [...resolvedSegments, segment].join("."),
            candidates: matches.map((match) => match.nodeId.text),
          }),
        );
      }
      currentNodeId = matches[0]!.nodeId.text;
      resolvedSegments.push(segment);
    }
    return {
      rootIndex,
      nodeId: currentNodeId,
      browsePath: resolvedSegments.join("."),
      browsePathSegments: resolvedSegments,
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
  browsePath: string,
) =>
  rules.find((rule) =>
    typeof rule.browsePath === "string"
      ? rule.browsePath === browsePath
      : rule.browsePath.test(browsePath),
  );

const addOrUpdateNode = (
  nodes: Map<NodeKey, NodeDraft>,
  input: {
    readonly metadata: OpcuaNodeMetadata;
    readonly browsePathSegments: readonly string[];
    readonly parentNodeId?: string;
    readonly rootIndex: number;
    readonly rootSegmentCount: number;
  },
) => {
  const key = input.metadata.nodeId;
  const existing = nodes.get(key);
  const browsePath = input.browsePathSegments.join(".");
  if (existing) {
    const allBrowsePaths = [
      ...new Set([...existing.allBrowsePaths, browsePath]),
    ].sort();
    if (
      comparePathRank(
        {
          rootIndex: input.rootIndex,
          rootSegmentCount: input.rootSegmentCount,
          browsePath,
          nodeId: key,
        },
        {
          rootIndex: existing.rootIndex ?? Number.MAX_SAFE_INTEGER,
          rootSegmentCount: existing.rootSegmentCount,
          browsePath: existing.browsePath,
          nodeId: existing.nodeId,
        },
      ) < 0
    ) {
      nodes.set(key, {
        ...existing,
        browsePath,
        browsePathSegments: input.browsePathSegments,
        allBrowsePaths,
        parentNodeId: input.parentNodeId,
        rootIndex: input.rootIndex,
        rootSegmentCount: input.rootSegmentCount,
      });
    } else {
      nodes.set(key, { ...existing, allBrowsePaths });
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
    browseName:
      input.metadata.browseName ?? input.browsePathSegments.at(-1) ?? key,
    browseNameNamespaceIndex: input.metadata.browseNameNamespaceIndex,
    browsePath,
    browsePathSegments: input.browsePathSegments,
    allBrowsePaths: [browsePath],
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
    readonly browsePath: string;
    readonly nodeId: string;
  },
  right: {
    readonly rootIndex: number;
    readonly rootSegmentCount: number;
    readonly browsePath: string;
    readonly nodeId: string;
  },
) =>
  left.rootIndex - right.rootIndex ||
  relativeLength(left) - relativeLength(right) ||
  left.browsePath.localeCompare(right.browsePath) ||
  left.nodeId.localeCompare(right.nodeId);

const relativeLength = (item: {
  readonly rootSegmentCount: number;
  readonly browsePath: string;
}) => item.browsePath.split(".").length - item.rootSegmentCount;

const finalizeNodes = (nodes: ReadonlyMap<NodeKey, NodeDraft>) => {
  const entries: Array<readonly [NodeKey, DiscoveredNode]> = [];
  for (const [key, node] of nodes) {
    const { rootSegmentCount: _, ...finalNode } = node;
    entries.push([
      key,
      {
        ...finalNode,
        allBrowsePaths: [...node.allBrowsePaths].sort(),
      },
    ]);
  }
  return new Map(
    entries.sort((left, right) =>
      left[1].browsePath.localeCompare(right[1].browsePath),
    ),
  ) as ReadonlyMap<NodeKey, DiscoveredNode>;
};

const sortReferences = (references: readonly DiscoveredReference[]) =>
  [...references].sort(
    (left, right) =>
      left.sourceNodeId.localeCompare(right.sourceNodeId) ||
      left.browseName.localeCompare(right.browseName) ||
      left.targetNodeId.localeCompare(right.targetNodeId),
  );

const normalizeNamespaceZeroNodeId = (nodeId: string) =>
  nodeId.startsWith("ns=0;") ? nodeId.slice("ns=0;".length) : nodeId;
