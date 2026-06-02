import type {
  AccessBits,
  BrowseReference,
  ReadNodeResponse,
} from "../../shared/rpc.js";
import type { TreeNode } from "../types.js";

export function nodeFromRead(response: ReadNodeResponse): TreeNode {
  return {
    nodeId: response.nodeId,
    label:
      response.metadata.displayName ??
      response.metadata.browseName ??
      response.nodeId,
    nodeClass: response.metadata.nodeClass,
    metadata: response.metadata,
    expanded: true,
    loading: false,
    loaded: false,
    children: [],
  };
}

export function nodeFromReference(reference: BrowseReference): TreeNode {
  return {
    nodeId: reference.nodeId,
    label:
      reference.metadata?.displayName ??
      reference.displayName ??
      reference.metadata?.browseName ??
      reference.browseName ??
      reference.nodeId,
    nodeClass: reference.metadata?.nodeClass ?? reference.nodeClass,
    metadata: reference.metadata,
    expanded: false,
    loading: false,
    loaded: false,
    children: [],
  };
}

export function accessText(access: AccessBits | undefined) {
  if (!access) return "";
  if (access.readable && access.writable) return "read/write";
  if (access.readable) return "read";
  if (access.writable) return "write";
  return "none";
}
