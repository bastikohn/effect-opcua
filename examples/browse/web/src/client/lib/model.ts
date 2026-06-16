import type {
  BrowseResponse,
  ConnectResponse,
  MonitorSample,
  MonitorRejectedItem,
  ReadNodeResponse,
  WebConfig,
  WebRpcError,
  WritePolicy,
  WriteNodeResponse,
} from "../../shared/rpc.js";
import { nodeFromRead, nodeFromReference } from "./tree.js";
import type { LogRow, MonitorRow, TreeNode } from "../types.js";

export type RequestToken = {
  readonly requestId: number;
  readonly sessionGeneration: number;
};

export type ConnectToken = RequestToken & {
  readonly endpointUrl: string;
  readonly startNodeId: string;
};

export type NodeRequestToken = RequestToken & {
  readonly nodeId: string;
};

export type ReadRequestOptions = {
  readonly value: boolean;
  readonly dataTypeDefinition: boolean;
};

export type ReadRequestToken = NodeRequestToken & {
  readonly options: ReadRequestOptions;
};

export type BrowseRequestToken = NodeRequestToken & {
  readonly mode: "replace" | "append";
  readonly continuationToken?: string;
};

export type MonitorToken = RequestToken & {
  readonly nodeIds: readonly string[];
};

export type ConnectionState =
  | { readonly _tag: "Disconnected" }
  | {
      readonly _tag: "Connecting";
      readonly requestId: number;
      readonly sessionGeneration: number;
      readonly aborting: boolean;
    }
  | { readonly _tag: "Connected"; readonly endpointUrl: string };

export type RuntimeState =
  | { readonly _tag: "Opening" }
  | { readonly _tag: "Ready" }
  | { readonly _tag: "Failed"; readonly message: string };

export type MonitorState =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Starting";
      readonly requestId: number;
      readonly sessionGeneration: number;
      readonly nodeIds: readonly string[];
      readonly samplingIntervalMs: number;
    }
  | {
      readonly _tag: "Running";
      readonly requestId: number;
      readonly sessionGeneration: number;
      readonly nodeIds: readonly string[];
      readonly samplingIntervalMs: number;
      readonly accepted: readonly string[];
      readonly rejected: readonly MonitorRejectedItem[];
    }
  | {
      readonly _tag: "Failed";
      readonly requestId: number;
      readonly sessionGeneration: number;
      readonly nodeIds: readonly string[];
      readonly samplingIntervalMs: number;
      readonly error: string;
    };

export type WriteOperationState =
  | { readonly _tag: "Idle" }
  | {
      readonly _tag: "Running";
      readonly requestId: number;
      readonly sessionGeneration: number;
      readonly nodeId: string;
    }
  | { readonly _tag: "Written"; readonly response: WriteNodeResponse }
  | { readonly _tag: "NonGoodStatus"; readonly response: WriteNodeResponse }
  | {
      readonly _tag: "Failed";
      readonly nodeId: string;
      readonly message: string;
    };

export type HmiWritePolicy = { readonly _tag: "Unknown" } | WritePolicy;

export type HmiState = {
  readonly runtime: RuntimeState;
  readonly connection: ConnectionState;
  readonly sessionGeneration: number;
  readonly nextRequestId: number;
  readonly tree: TreeNode[];
  readonly selected?: ReadNodeResponse;
  readonly selectedNodeId: string;
  readonly activeRead?: NodeRequestToken;
  readonly activeWrite?: NodeRequestToken;
  readonly writePolicy: HmiWritePolicy;
  readonly writeOperation: WriteOperationState;
  readonly monitorRows: MonitorRow[];
  readonly samplingIntervalMs: number;
  readonly monitor: MonitorState;
  readonly logs: LogRow[];
};

export type HmiViewState = {
  readonly connected: boolean;
  readonly connecting: boolean;
  readonly abortingConnect: boolean;
  readonly handleReady: boolean;
  readonly statusText: string;
  readonly statusClass: string;
  readonly isMonitoring: boolean;
};

export const initialHmiState = (selectedNodeId = "i=85"): HmiState => ({
  runtime: { _tag: "Opening" },
  connection: { _tag: "Disconnected" },
  sessionGeneration: 0,
  nextRequestId: 1,
  tree: [],
  selectedNodeId,
  monitorRows: [],
  samplingIntervalMs: 500,
  monitor: { _tag: "Idle" },
  writePolicy: { _tag: "Unknown" },
  writeOperation: { _tag: "Idle" },
  logs: [],
});

export const hmiViewState = (state: HmiState): HmiViewState => {
  const connected = state.connection._tag === "Connected";
  const connecting = state.connection._tag === "Connecting";
  const abortingConnect =
    state.connection._tag === "Connecting" && state.connection.aborting;
  const handleReady = state.runtime._tag === "Ready";
  return {
    connected,
    connecting,
    abortingConnect,
    handleReady,
    statusText: connected
      ? "Connected"
      : connecting
        ? abortingConnect
          ? "Aborting"
          : "Connecting"
        : handleReady
          ? "Ready"
          : state.runtime._tag === "Failed"
            ? "RPC failed"
            : "Opening RPC",
    statusClass: connected
      ? "fill-emerald-500 text-emerald-500"
      : connecting
        ? "fill-amber-500 text-amber-500"
        : state.runtime._tag === "Failed"
          ? "fill-red-500 text-red-500"
          : "fill-neutral-600 text-neutral-600",
    isMonitoring:
      state.monitor._tag === "Starting" || state.monitor._tag === "Running",
  };
};

export const applyConfig = (state: HmiState, config: WebConfig): HmiState => ({
  ...state,
  writePolicy: config.writePolicy,
});

export const runtimeReady = (state: HmiState): HmiState => ({
  ...state,
  runtime: { _tag: "Ready" },
});

export const runtimeFailed = (state: HmiState, message: string): HmiState => ({
  ...state,
  runtime: { _tag: "Failed", message },
});

export const appendLog = (
  state: HmiState,
  level: LogRow["level"],
  message: string,
  id: number,
  time: string,
): HmiState => ({
  ...state,
  logs: [{ id, time, level, message }, ...state.logs].slice(0, 80),
});

export const beginConnect = (
  state: HmiState,
  input: { readonly endpointUrl: string; readonly startNodeId?: string },
): { readonly state: HmiState; readonly token: ConnectToken } => {
  const requestId = state.nextRequestId;
  const sessionGeneration = state.sessionGeneration + 1;
  const startNodeId = input.startNodeId ?? "i=85";
  return {
    state: {
      ...state,
      connection: {
        _tag: "Connecting",
        requestId,
        sessionGeneration,
        aborting: false,
      },
      sessionGeneration,
      nextRequestId: requestId + 1,
      tree: [],
      selected: undefined,
      selectedNodeId: startNodeId,
      activeRead: undefined,
      activeWrite: undefined,
      writeOperation: { _tag: "Idle" },
      monitorRows: [],
      monitor: { _tag: "Idle" },
    },
    token: {
      requestId,
      sessionGeneration,
      endpointUrl: input.endpointUrl,
      startNodeId,
    },
  };
};

export const markConnectAborting = (state: HmiState): HmiState =>
  state.connection._tag === "Connecting"
    ? {
        ...state,
        connection: { ...state.connection, aborting: true },
      }
    : state;

export const isConnectCurrent = (
  state: HmiState,
  token: RequestToken,
): boolean =>
  state.connection._tag === "Connecting" &&
  state.connection.requestId === token.requestId &&
  state.connection.sessionGeneration === token.sessionGeneration &&
  state.sessionGeneration === token.sessionGeneration;

export const finishConnectSuccess = (
  state: HmiState,
  token: ConnectToken,
  response: ConnectResponse,
): HmiState => {
  if (!isConnectCurrent(state, token)) return state;
  return {
    ...state,
    connection: { _tag: "Connected", endpointUrl: response.endpointUrl },
    selectedNodeId: token.startNodeId,
  };
};

export const finishConnectFailure = (
  state: HmiState,
  token: RequestToken,
): HmiState =>
  isConnectCurrent(state, token)
    ? {
        ...state,
        connection: { _tag: "Disconnected" },
        selected: undefined,
        tree: [],
        activeRead: undefined,
        activeWrite: undefined,
        monitorRows: [],
        monitor: { _tag: "Idle" },
        writeOperation: { _tag: "Idle" },
      }
    : state;

export const disconnectLocal = (
  state: HmiState,
  resetNodeId = "i=85",
): HmiState => ({
  ...state,
  connection: { _tag: "Disconnected" },
  sessionGeneration: state.sessionGeneration + 1,
  tree: [],
  selected: undefined,
  selectedNodeId: resetNodeId,
  activeRead: undefined,
  activeWrite: undefined,
  writeOperation: { _tag: "Idle" },
  monitorRows: [],
  monitor: { _tag: "Idle" },
});

export const beginRead = (
  state: HmiState,
  nodeId: string,
  options: ReadRequestOptions = { value: false, dataTypeDefinition: false },
): { readonly state: HmiState; readonly token?: ReadRequestToken } => {
  if (state.connection._tag !== "Connected") return { state };
  const requestId = state.nextRequestId;
  const token = {
    requestId,
    sessionGeneration: state.sessionGeneration,
    nodeId,
    options,
  };
  return {
    state: {
      ...state,
      nextRequestId: requestId + 1,
      selectedNodeId: nodeId,
      activeRead: token,
    },
    token,
  };
};

export const finishReadSuccess = (
  state: HmiState,
  token: ReadRequestToken,
  response: ReadNodeResponse,
): HmiState =>
  isNodeRequestCurrent(state, state.activeRead, token) &&
  state.selectedNodeId === token.nodeId
    ? {
        ...state,
        selected: mergeReadResponse(state.selected, token.options, response),
        selectedNodeId: response.nodeId,
        activeRead: undefined,
        tree: state.tree.length === 0 ? [nodeFromRead(response)] : state.tree,
      }
    : state;

const mergeReadResponse = (
  previous: ReadNodeResponse | undefined,
  options: ReadRequestOptions,
  response: ReadNodeResponse,
): ReadNodeResponse =>
  previous?.nodeId === response.nodeId
    ? {
        ...response,
        value: options.value ? response.value : previous.value,
        valueError: options.value ? response.valueError : previous.valueError,
        dataTypeDefinition: options.dataTypeDefinition
          ? response.dataTypeDefinition
          : previous.dataTypeDefinition,
      }
    : response;

export const finishReadFailure = (
  state: HmiState,
  token: NodeRequestToken,
): HmiState =>
  isNodeRequestCurrent(state, state.activeRead, token)
    ? { ...state, activeRead: undefined }
    : state;

export const beginWrite = (
  state: HmiState,
  nodeId: string,
): { readonly state: HmiState; readonly token?: NodeRequestToken } => {
  if (state.connection._tag !== "Connected") return { state };
  const requestId = state.nextRequestId;
  const token = {
    requestId,
    sessionGeneration: state.sessionGeneration,
    nodeId,
  };
  return {
    state: {
      ...state,
      nextRequestId: requestId + 1,
      activeWrite: token,
      writeOperation: {
        _tag: "Running",
        requestId,
        sessionGeneration: state.sessionGeneration,
        nodeId,
      },
    },
    token,
  };
};

export const finishWriteSuccess = (
  state: HmiState,
  token: NodeRequestToken,
  response: WriteNodeResponse,
): HmiState => {
  if (!isNodeRequestCurrent(state, state.activeWrite, token)) return state;
  return {
    ...state,
    activeWrite: undefined,
    writeOperation:
      response.write._tag === "Written"
        ? { _tag: "Written", response }
        : { _tag: "NonGoodStatus", response },
    selected:
      state.selectedNodeId === token.nodeId
        ? state.selected?.nodeId === response.refreshed.nodeId
          ? {
              ...response.refreshed,
              dataTypeDefinition:
                response.refreshed.dataTypeDefinition ??
                state.selected.dataTypeDefinition,
            }
          : response.refreshed
        : state.selected,
  };
};

export const finishWriteFailure = (
  state: HmiState,
  token: NodeRequestToken,
  error?: WebRpcError | string,
): HmiState =>
  isNodeRequestCurrent(state, state.activeWrite, token)
    ? {
        ...state,
        activeWrite: undefined,
        writeOperation: {
          _tag: "Failed",
          nodeId: token.nodeId,
          message:
            typeof error === "string"
              ? error
              : (error?.message ?? "Write failed"),
        },
      }
    : state;

export const toggleTreeNode = (
  state: HmiState,
  nodeId: string,
): {
  readonly state: HmiState;
  readonly shouldLoad: boolean;
  readonly discardContinuationToken?: string;
} => {
  const node = findTreeNode(state.tree, nodeId);
  if (!node) return { state, shouldLoad: false };
  const expanded = !node.expanded;
  return {
    state: {
      ...state,
      tree: updateTreeNode(state.tree, nodeId, (current) => ({
        ...current,
        expanded,
        continuationToken: expanded ? current.continuationToken : undefined,
      })),
    },
    shouldLoad: expanded && !node.loaded,
    discardContinuationToken: expanded ? undefined : node.continuationToken,
  };
};

export const beginBrowse = (
  state: HmiState,
  nodeId: string,
  mode: "replace" | "append" = "replace",
): { readonly state: HmiState; readonly token?: BrowseRequestToken } => {
  if (state.connection._tag !== "Connected") return { state };
  const node = findTreeNode(state.tree, nodeId);
  if (!node || node.loading) return { state };
  const continuationToken =
    mode === "append" ? node.continuationToken : undefined;
  if (mode === "append" && !continuationToken) return { state };
  const requestId = state.nextRequestId;
  const token = {
    requestId,
    sessionGeneration: state.sessionGeneration,
    nodeId,
    mode,
    continuationToken,
  };
  return {
    state: {
      ...state,
      nextRequestId: requestId + 1,
      tree: updateTreeNode(state.tree, nodeId, (current) => ({
        ...current,
        loading: true,
        browseStatus: undefined,
        browseRequestId: requestId,
      })),
    },
    token,
  };
};

export const isBrowseCurrent = (
  state: HmiState,
  token: BrowseRequestToken,
): boolean => {
  if (state.sessionGeneration !== token.sessionGeneration) return false;
  const node = findTreeNode(state.tree, token.nodeId);
  return node?.browseRequestId === token.requestId;
};

export const finishBrowseSuccess = (
  state: HmiState,
  token: BrowseRequestToken,
  response: BrowseResponse,
): HmiState => {
  if (!isBrowseCurrent(state, token)) return state;
  return {
    ...state,
    tree: updateTreeNode(state.tree, token.nodeId, (node) => ({
      ...node,
      children:
        response._tag === "Browsed"
          ? token.mode === "append"
            ? [...node.children, ...response.references.map(nodeFromReference)]
            : response.references.map(nodeFromReference)
          : [],
      loaded: true,
      loading: false,
      browseStatus: response.status,
      continuationToken:
        response._tag === "Browsed" ? response.continuationToken : undefined,
      browseRequestId: undefined,
    })),
  };
};

export const finishBrowseFailure = (
  state: HmiState,
  token: BrowseRequestToken,
): HmiState =>
  isBrowseCurrent(state, token)
    ? {
        ...state,
        tree: updateTreeNode(state.tree, token.nodeId, (node) => ({
          ...node,
          loading: false,
          browseRequestId: undefined,
        })),
      }
    : state;

export const clearBrowseContinuation = (
  state: HmiState,
  nodeId: string,
): HmiState => ({
  ...state,
  tree: updateTreeNode(state.tree, nodeId, (node) => ({
    ...node,
    continuationToken: undefined,
  })),
});

export const setSamplingIntervalMs = (
  state: HmiState,
  samplingIntervalMs: number,
): HmiState => ({
  ...state,
  samplingIntervalMs: Number.isFinite(samplingIntervalMs)
    ? Math.max(50, samplingIntervalMs)
    : state.samplingIntervalMs,
});

export const addMonitorNode = (
  state: HmiState,
  nodeId = state.selected?.nodeId,
): HmiState => {
  if (!nodeId || state.monitorRows.some((row) => row.nodeId === nodeId)) {
    return state;
  }
  return {
    ...state,
    monitorRows: [
      ...state.monitorRows,
      {
        nodeId,
        label:
          nodeId === state.selected?.nodeId
            ? (state.selected.metadata.displayName ??
              state.selected.metadata.browseName ??
              nodeId)
            : nodeId,
        monitorStatus: "Desired",
        samples: [],
      },
    ],
  };
};

export const removeMonitorNode = (
  state: HmiState,
  nodeId: string,
): HmiState => {
  const monitorRows = state.monitorRows.filter((row) => row.nodeId !== nodeId);
  return {
    ...state,
    monitorRows,
    monitor: monitorRows.length === 0 ? { _tag: "Idle" } : state.monitor,
  };
};

export const beginMonitoring = (
  state: HmiState,
): {
  readonly state: HmiState;
  readonly token?: MonitorToken;
} => {
  if (state.connection._tag !== "Connected" || state.monitorRows.length === 0) {
    return { state };
  }
  const requestId = state.nextRequestId;
  const token = {
    requestId,
    sessionGeneration: state.sessionGeneration,
    nodeIds: state.monitorRows.map((row) => row.nodeId),
  };
  return {
    state: {
      ...state,
      nextRequestId: requestId + 1,
      monitor: {
        _tag: "Starting",
        requestId,
        sessionGeneration: token.sessionGeneration,
        nodeIds: token.nodeIds,
        samplingIntervalMs: state.samplingIntervalMs,
      },
    },
    token,
  };
};

export const stopMonitoring = (state: HmiState): HmiState => ({
  ...state,
  monitor: { _tag: "Idle" },
  monitorRows: state.monitorRows.map((row) => ({
    ...row,
    monitorStatus: "Desired",
    rejectionMessage: undefined,
  })),
});

export const isMonitorCurrent = (
  state: HmiState,
  token: MonitorToken,
): boolean =>
  (state.monitor._tag === "Starting" || state.monitor._tag === "Running") &&
  state.monitor.requestId === token.requestId &&
  state.monitor.sessionGeneration === token.sessionGeneration &&
  state.sessionGeneration === token.sessionGeneration;

export const recordMonitorStarted = (
  state: HmiState,
  token: MonitorToken,
  input: {
    readonly accepted: readonly string[];
    readonly rejected: readonly MonitorRejectedItem[];
  },
): HmiState => {
  if (!isMonitorCurrent(state, token)) return state;
  return {
    ...state,
    monitor: {
      _tag: "Running",
      requestId: token.requestId,
      sessionGeneration: token.sessionGeneration,
      nodeIds: token.nodeIds,
      samplingIntervalMs:
        state.monitor._tag === "Idle"
          ? state.samplingIntervalMs
          : state.monitor.samplingIntervalMs,
      accepted: input.accepted,
      rejected: input.rejected,
    },
    monitorRows: state.monitorRows.map((row) => {
      const rejected = input.rejected.find(
        (item) => item.nodeId === row.nodeId,
      );
      if (rejected) {
        return {
          ...row,
          monitorStatus: "Rejected",
          rejectionMessage: rejected.message,
        };
      }
      return input.accepted.includes(row.nodeId)
        ? { ...row, monitorStatus: "Accepted", rejectionMessage: undefined }
        : row;
    }),
  };
};

export const finishMonitorFailure = (
  state: HmiState,
  token: MonitorToken,
  error: string,
): HmiState =>
  isMonitorCurrent(state, token)
    ? {
        ...state,
        monitor: {
          _tag: "Failed",
          requestId: token.requestId,
          sessionGeneration: token.sessionGeneration,
          nodeIds: token.nodeIds,
          samplingIntervalMs:
            state.monitor._tag === "Idle"
              ? state.samplingIntervalMs
              : state.monitor.samplingIntervalMs,
          error,
        },
      }
    : state;

export const recordMonitorSample = (
  state: HmiState,
  token: MonitorToken,
  sample: MonitorSample,
): HmiState => {
  if (!isMonitorCurrent(state, token)) return state;
  const index = state.monitorRows.findIndex(
    (row) => row.nodeId === sample.nodeId,
  );
  if (index === -1) return state;
  const monitorRows = [...state.monitorRows];
  const row = monitorRows[index];
  monitorRows[index] = {
    ...row,
    samples: [...row.samples.slice(-29), sample],
  };
  return { ...state, monitorRows };
};

const isNodeRequestCurrent = (
  state: HmiState,
  current: NodeRequestToken | undefined,
  token: NodeRequestToken,
): boolean =>
  current?.requestId === token.requestId &&
  current.sessionGeneration === token.sessionGeneration &&
  current.nodeId === token.nodeId &&
  state.sessionGeneration === token.sessionGeneration;

const findTreeNode = (
  nodes: readonly TreeNode[],
  nodeId: string,
): TreeNode | undefined => {
  for (const node of nodes) {
    if (node.nodeId === nodeId) return node;
    const child = findTreeNode(node.children, nodeId);
    if (child) return child;
  }
  return undefined;
};

const updateTreeNode = (
  nodes: readonly TreeNode[],
  nodeId: string,
  update: (node: TreeNode) => TreeNode,
): TreeNode[] =>
  nodes.map((node) =>
    node.nodeId === nodeId
      ? update(node)
      : {
          ...node,
          children: updateTreeNode(node.children, nodeId, update),
        },
  );
