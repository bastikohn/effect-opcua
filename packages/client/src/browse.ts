import { Effect } from "effect";
import {
  BrowseDirection,
  NodeClass,
  resolveNodeId,
  type BrowseDescriptionOptions,
  type BrowseResult,
  type ClientSession,
  type ReferenceDescription,
} from "node-opcua";

import {
  DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
  DEFAULT_BROWSE_DIRECTION,
  DEFAULT_BROWSE_INCLUDE_SUBTYPES,
  DEFAULT_BROWSE_NODE_CLASS_MASK,
  DEFAULT_BROWSE_REFERENCE_TYPE_ID,
  DEFAULT_BROWSE_RESULT_MASK,
} from "./constants.js";
import {
  OpcuaConfigurationError,
  OpcuaNonGoodStatusError,
  OpcuaServiceError,
} from "./errors.js";
import {
  isGood,
  normalizeExpandedNodeId,
  normalizeLocalizedText,
  normalizeQualifiedName,
  normalizeStatusCode,
  type OpcuaExpandedNodeIdInfo,
  type OpcuaLocalizedTextInfo,
  type OpcuaQualifiedNameInfo,
  type OpcuaStatusInfo,
} from "./normalize.js";
import type { NodeIdString } from "./capabilities.js";

export type OpcuaBrowseReference = {
  readonly nodeId: OpcuaExpandedNodeIdInfo;
  readonly referenceTypeId?: NodeIdString;
  readonly isForward?: boolean;
  readonly nodeClass?: string;
  readonly browseName?: OpcuaQualifiedNameInfo;
  readonly displayName?: OpcuaLocalizedTextInfo;
  readonly typeDefinition?: OpcuaExpandedNodeIdInfo;
  readonly raw?: ReferenceDescription;
};

export type OpcuaBrowseContinuation = {
  readonly nodeId: NodeIdString;
  readonly raw: Buffer;
};

export type OpcuaBrowseResult = {
  readonly nodeId: NodeIdString;
  readonly status: OpcuaStatusInfo;
  readonly references: ReadonlyArray<OpcuaBrowseReference>;
  readonly continuation?: OpcuaBrowseContinuation;
  readonly raw?: BrowseResult;
};

export type OpcuaBrowseChildrenResult = {
  readonly nodeId: NodeIdString;
  readonly references: ReadonlyArray<OpcuaBrowseReference>;
  readonly continuation?: OpcuaBrowseContinuation;
};

export type OpcuaBrowseOptions = {
  readonly nodeId: NodeIdString;
  readonly referenceTypeId?: NodeIdString;
  readonly browseDirection?: BrowseDirection;
  readonly includeSubtypes?: boolean;
  readonly nodeClassMask?: number;
  readonly resultMask?: number;
  readonly maxReferencesPerNode?: number;
  readonly includeRaw?: boolean;
};

export type OpcuaBrowseChildrenOptions = {
  readonly mode?: "all" | "page";
  readonly maxReferencesPerNode?: number;
  readonly referenceTypeId?: string;
  readonly includeSubtypes?: boolean;
  readonly nodeClassMask?: number;
  readonly includeRaw?: boolean;
};

export const browseOptionsError = (input: OpcuaBrowseOptions) => {
  if (input.nodeId.trim() === "") {
    return new OpcuaConfigurationError({
      operation: "browse",
      nodeId: input.nodeId,
      cause: "nodeId must not be empty",
    });
  }
  if (
    input.maxReferencesPerNode !== undefined &&
    (!Number.isInteger(input.maxReferencesPerNode) ||
      input.maxReferencesPerNode < 0)
  ) {
    return new OpcuaConfigurationError({
      operation: "browse",
      nodeId: input.nodeId,
      cause: "maxReferencesPerNode must be a non-negative integer",
    });
  }
  return undefined;
};

export const browseContinuationError = (
  operation: string,
  continuation: OpcuaBrowseContinuation,
) => {
  if (continuation.nodeId.trim() === "") {
    return new OpcuaConfigurationError({
      operation,
      nodeId: continuation.nodeId,
      cause: "nodeId must not be empty",
    });
  }
  if (continuation.raw.length === 0) {
    return new OpcuaConfigurationError({
      operation,
      nodeId: continuation.nodeId,
      cause: "continuation raw buffer must not be empty",
    });
  }
  return undefined;
};

export const browseWithMaxReferences = async (
  session: ClientSession,
  nodeToBrowse: BrowseDescriptionOptions,
  maxReferencesPerNode: number,
): Promise<BrowseResult> => {
  const previousMaxReferencesPerNode = session.requestedMaxReferencesPerNode;
  session.requestedMaxReferencesPerNode = maxReferencesPerNode;
  try {
    return await session.browse(nodeToBrowse);
  } finally {
    session.requestedMaxReferencesPerNode = previousMaxReferencesPerNode;
  }
};

export const normalizeBrowseResultOrFail = (
  operation: string,
  nodeId: NodeIdString,
  result: BrowseResult,
  includeRaw: boolean,
): Effect.Effect<OpcuaBrowseResult, OpcuaNonGoodStatusError> => {
  if (!isGood(result.statusCode)) {
    return Effect.fail(
      new OpcuaNonGoodStatusError({
        operation,
        nodeId,
        statusCode: result.statusCode,
      }),
    );
  }

  return Effect.succeed(normalizeBrowseResult(nodeId, result, includeRaw));
};

const normalizeBrowseResult = (
  nodeId: NodeIdString,
  result: BrowseResult,
  includeRaw: boolean,
): OpcuaBrowseResult => ({
  nodeId,
  status: normalizeStatusCode(result.statusCode),
  references:
    result.references?.map((reference) =>
      normalizeBrowseReference(reference, includeRaw),
    ) ?? [],
  continuation:
    result.continuationPoint && result.continuationPoint.length > 0
      ? { nodeId, raw: result.continuationPoint }
      : undefined,
  raw: includeRaw ? result : undefined,
});

export const normalizeBrowseReference = (
  reference: ReferenceDescription,
  includeRaw: boolean,
): OpcuaBrowseReference => ({
  nodeId: normalizeExpandedNodeId(reference.nodeId),
  referenceTypeId: reference.referenceTypeId?.toString(),
  isForward: reference.isForward,
  nodeClass:
    typeof reference.nodeClass === "number"
      ? NodeClass[reference.nodeClass]
      : undefined,
  browseName: reference.browseName
    ? normalizeQualifiedName(reference.browseName)
    : undefined,
  displayName: reference.displayName
    ? normalizeLocalizedText(reference.displayName)
    : undefined,
  typeDefinition: reference.typeDefinition
    ? normalizeExpandedNodeId(reference.typeDefinition)
    : undefined,
  raw: includeRaw ? reference : undefined,
});
