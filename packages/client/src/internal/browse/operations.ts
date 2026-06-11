import {
  NodeClass,
  type BrowseDescriptionOptions,
  type BrowseResult,
  type ClientSession,
  type ReferenceDescription,
} from "node-opcua";

import { configurationError } from "../../OpcuaError.js";
import type {
  OpcuaBrowseContinuation,
  OpcuaBrowseOptions,
  OpcuaBrowseReference,
  OpcuaBrowseResult,
} from "../../OpcuaSession.js";
import {
  isGood,
  normalizeExpandedNodeId,
  normalizeLocalizedText,
  normalizeQualifiedName,
  normalizeStatusCode,
} from "../values/normalize.js";
import type { NodeIdString } from "../common/node-id.js";
import { nonNegativeIntegerOption } from "../common/options.js";
export type {
  OpcuaBrowseChildrenOptions,
  OpcuaBrowseChildrenResult,
  OpcuaBrowseContinuation,
  OpcuaBrowseOptions,
  OpcuaBrowseReference,
  OpcuaBrowseResult,
} from "../../OpcuaSession.js";

export const browseOptionsError = (input: OpcuaBrowseOptions) => {
  if (input.nodeId.trim() === "") {
    return configurationError({
      operation: "browse",
      nodeId: input.nodeId,
      cause: "nodeId must not be empty",
    });
  }
  if (
    input.maxReferencesPerNode !== undefined &&
    !nonNegativeIntegerOption(input.maxReferencesPerNode)
  ) {
    return configurationError({
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
    return configurationError({
      operation,
      nodeId: continuation.nodeId,
      cause: "nodeId must not be empty",
    });
  }
  if (continuation.unsafeRaw.length === 0) {
    return configurationError({
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

export const normalizeBrowseResult = (
  nodeId: NodeIdString,
  result: BrowseResult,
  includeRaw: boolean,
): OpcuaBrowseResult => {
  if (!isGood(result.statusCode)) {
    return {
      _tag: "NonGoodStatus",
      nodeId,
      status: normalizeStatusCode(result.statusCode),
      unsafeRaw: includeRaw ? result : undefined,
    };
  }

  return {
    _tag: "Browsed",
    nodeId,
    status: normalizeStatusCode(result.statusCode),
    references:
      result.references?.map((reference) =>
        normalizeBrowseReference(reference, includeRaw),
      ) ?? [],
    continuation:
      result.continuationPoint && result.continuationPoint.length > 0
        ? { nodeId, unsafeRaw: result.continuationPoint }
        : undefined,
    unsafeRaw: includeRaw ? result : undefined,
  };
};

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
  unsafeRaw: includeRaw ? reference : undefined,
});
