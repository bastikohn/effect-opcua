import { Cause, Exit } from "effect";

import type { ConnectionRequest } from "../types.js";
import { errorMessage, parseJsonValue } from "../../shared/value.js";
import type { ConnectResponse } from "../../shared/rpc.js";
import {
  addMonitorNode as modelAddMonitorNode,
  applyConfig,
  appendLog,
  beginBrowse,
  beginConnect,
  beginMonitoring,
  beginRead,
  beginWrite,
  disconnectLocal,
  finishBrowseFailure,
  finishBrowseSuccess,
  finishConnectFailure,
  finishConnectSuccess,
  finishMonitorFailure,
  finishReadFailure,
  finishReadSuccess,
  finishWriteFailure,
  finishWriteSuccess,
  isBrowseCurrent,
  isConnectCurrent,
  markConnectAborting,
  recordMonitorSample,
  recordMonitorStarted,
  removeMonitorNode as modelRemoveMonitorNode,
  setSamplingIntervalMs as modelSetSamplingIntervalMs,
  stopMonitoring as modelStopMonitoring,
  toggleTreeNode,
  type BrowseRequestToken,
  type HmiState,
  type MonitorToken,
} from "./model.js";
import type { HmiFiber, HmiRuntime } from "./runtime.js";

const BROWSE_PAGE_SIZE = 100;

export type HmiActions = ReturnType<typeof makeHmiActions>;

export const makeHmiActions = (options: {
  readonly getRuntime: () => HmiRuntime | undefined;
  readonly getState: () => HmiState;
  readonly setState: (state: HmiState) => void;
}) => {
  let connectFiber: HmiFiber<ConnectResponse, unknown> | undefined;
  let monitorFiber: HmiFiber<void, never> | undefined;

  const update = (f: (state: HmiState) => HmiState) => {
    options.setState(f(options.getState()));
  };

  const log = (level: "info" | "error", message: string) => {
    update((state) =>
      appendLog(
        state,
        level,
        message,
        Date.now() + Math.random(),
        new Date().toLocaleTimeString(),
      ),
    );
  };

  const messageOf = (error: unknown) => {
    const message = errorMessage(error);
    return message.length > 0 && message !== "{}" ? message : "Unknown error";
  };

  const stopMonitoring = (writeLog = true) => {
    const runtime = options.getRuntime();
    if (monitorFiber && runtime) runtime.interrupt(monitorFiber);
    const hadMonitor = monitorFiber !== undefined;
    monitorFiber = undefined;
    update(modelStopMonitoring);
    if (hadMonitor && writeLog) log("info", "Monitoring stopped");
  };

  const releaseBrowseContinuation = async (continuationToken: string) => {
    const runtime = options.getRuntime();
    if (!runtime) return;
    const exit = await runtime.runExit(
      runtime.rpc.ReleaseBrowseContinuation({ continuationToken }),
    );
    if (Exit.isFailure(exit)) log("error", messageOf(exit.cause));
  };

  const loadChildren = async (
    nodeId: string,
    mode: "replace" | "append" = "replace",
  ) => {
    const runtime = options.getRuntime();
    if (!runtime) return;
    const started = beginBrowse(options.getState(), nodeId, mode);
    options.setState(started.state);
    if (!started.token) return;
    const token: BrowseRequestToken = started.token;
    const exit = await runtime.runExit(
      runtime.rpc.Browse({
        nodeId,
        maxReferencesPerNode: BROWSE_PAGE_SIZE,
        continuationToken: token.continuationToken,
      }),
    );
    if (Exit.isFailure(exit)) {
      if (isBrowseCurrent(options.getState(), token)) {
        options.setState(finishBrowseFailure(options.getState(), token));
        log("error", messageOf(exit.cause));
      }
      return;
    }
    if (isBrowseCurrent(options.getState(), token)) {
      options.setState(
        finishBrowseSuccess(options.getState(), token, exit.value),
      );
      log(
        exit.value._tag === "Browsed" ? "info" : "error",
        exit.value._tag === "Browsed"
          ? `${mode === "append" ? "Browse more" : "Browse"} ${nodeId}: ${exit.value.references.length}`
          : `Browse ${nodeId}: ${exit.value.status.text}`,
      );
    }
  };

  const readNode = async (
    nodeId: string,
    readOptions: { value?: boolean; dataTypeDefinition?: boolean } = {},
  ) => {
    const runtime = options.getRuntime();
    if (!runtime) return;
    const started = beginRead(options.getState(), nodeId, {
      value: readOptions.value === true,
      dataTypeDefinition: readOptions.dataTypeDefinition === true,
    });
    options.setState(started.state);
    if (!started.token) return;
    const token = started.token;
    const exit = await runtime.runExit(
      runtime.rpc.ReadNode({
        nodeId,
        value: token.options.value,
        dataTypeDefinition: token.options.dataTypeDefinition,
      }),
    );
    if (Exit.isFailure(exit)) {
      options.setState(finishReadFailure(options.getState(), token));
      log("error", messageOf(exit.cause));
      return;
    }
    options.setState(finishReadSuccess(options.getState(), token, exit.value));
    if (options.getState().selected?.nodeId === nodeId) {
      log("info", `Read ${nodeId}`);
    }
  };

  const selectNode = (nodeId: string) => readNode(nodeId);

  const startMonitoring = () => {
    const runtime = options.getRuntime();
    if (!runtime) return;
    stopMonitoring(false);
    const started = beginMonitoring(options.getState());
    options.setState(started.state);
    if (!started.token) return;
    const token: MonitorToken = started.token;
    monitorFiber = runtime.runStream(
      runtime.rpc.MonitorValues({
        nodeIds: [...token.nodeIds],
        samplingIntervalMs: options.getState().samplingIntervalMs,
      }),
      (sample) => {
        options.setState(
          sample._tag === "Started"
            ? recordMonitorStarted(options.getState(), token, sample)
            : recordMonitorSample(options.getState(), token, sample.sample),
        );
      },
      (error) => {
        monitorFiber = undefined;
        update((state) => finishMonitorFailure(state, token, messageOf(error)));
        log("error", messageOf(error));
      },
    );
    log("info", `Monitoring ${token.nodeIds.length} node(s)`);
  };

  return {
    log,
    messageOf,
    loadConfig: async () => {
      const runtime = options.getRuntime();
      if (!runtime) return;
      const exit = await runtime.runExit(runtime.rpc.GetConfig());
      if (Exit.isFailure(exit)) {
        log("error", messageOf(exit.cause));
      } else {
        update((state) => applyConfig(state, exit.value));
      }
    },
    dispose: () => {
      const runtime = options.getRuntime();
      if (connectFiber && runtime) runtime.interrupt(connectFiber);
      connectFiber = undefined;
      stopMonitoring(false);
    },
    connect: async (request: ConnectionRequest) => {
      const runtime = options.getRuntime();
      if (!runtime || connectFiber) return;
      stopMonitoring(false);
      const started = beginConnect(options.getState(), {
        endpointUrl: request.endpointUrl,
        startNodeId: request.startNodeId,
      });
      options.setState(started.state);
      connectFiber = runtime.fork(
        runtime.rpc.Connect({
          endpointUrl: request.endpointUrl,
          startNodeId: request.startNodeId,
          auth: request.auth,
        }),
      );
      const fiber = connectFiber;
      const exit = await runtime.awaitFiber(fiber);
      if (connectFiber === fiber) connectFiber = undefined;
      if (Exit.isFailure(exit)) {
        const interrupted = Cause.hasInterrupts(exit.cause);
        if (isConnectCurrent(options.getState(), started.token)) {
          options.setState(
            finishConnectFailure(options.getState(), started.token),
          );
          log(
            interrupted ? "info" : "error",
            interrupted ? "Connection attempt aborted" : messageOf(exit.cause),
          );
        }
        return;
      }
      if (isConnectCurrent(options.getState(), started.token)) {
        options.setState(
          finishConnectSuccess(options.getState(), started.token, exit.value),
        );
        log("info", `Connected ${request.endpointUrl}`);
        await selectNode(started.token.startNodeId);
        await loadChildren(started.token.startNodeId);
      }
    },
    abortConnect: () => {
      const runtime = options.getRuntime();
      if (!connectFiber || !runtime) return;
      update(markConnectAborting);
      runtime.interrupt(connectFiber);
    },
    disconnect: async (resetNodeId: string) => {
      const runtime = options.getRuntime();
      stopMonitoring(false);
      update((state) => disconnectLocal(state, resetNodeId));
      if (!runtime) return;
      const exit = await runtime.runExit(runtime.rpc.Disconnect());
      if (Exit.isFailure(exit)) {
        log("error", messageOf(exit.cause));
      } else {
        log("info", "Disconnected");
      }
    },
    selectNode: (nodeId: string) => selectNode(nodeId),
    readSelected: () => {
      const state = options.getState();
      const nodeId = state.selected?.nodeId ?? state.selectedNodeId;
      void readNode(nodeId, { value: true });
    },
    loadDataTypeDefinition: () => {
      const state = options.getState();
      const nodeId = state.selected?.nodeId ?? state.selectedNodeId;
      void readNode(nodeId, { dataTypeDefinition: true });
    },
    writeSelected: async (text: string) => {
      const runtime = options.getRuntime();
      const selected = options.getState().selected;
      if (!runtime || !selected) return;
      let value: unknown;
      try {
        value = parseJsonValue(text);
      } catch (error) {
        log("error", messageOf(error));
        return;
      }
      const started = beginWrite(options.getState(), selected.nodeId);
      options.setState(started.state);
      if (!started.token) return;
      const token = started.token;
      const exit = await runtime.runExit(
        runtime.rpc.WriteNode({ nodeId: selected.nodeId, value }),
      );
      if (Exit.isFailure(exit)) {
        options.setState(
          finishWriteFailure(options.getState(), token, messageOf(exit.cause)),
        );
        log("error", messageOf(exit.cause));
        return;
      }
      options.setState(
        finishWriteSuccess(options.getState(), token, exit.value),
      );
      log(
        exit.value.write._tag === "Written" ? "info" : "error",
        `${exit.value.write._tag} ${exit.value.nodeId}: ${exit.value.write.status.text}`,
      );
    },
    toggleNode: async (nodeId: string) => {
      const result = toggleTreeNode(options.getState(), nodeId);
      options.setState(result.state);
      if (result.discardContinuationToken) {
        void releaseBrowseContinuation(result.discardContinuationToken);
      }
      if (result.shouldLoad) await loadChildren(nodeId);
    },
    loadChildren,
    loadMoreChildren: (nodeId: string) => loadChildren(nodeId, "append"),
    addMonitorNode: (nodeId?: string) => {
      update((state) => modelAddMonitorNode(state, nodeId));
    },
    removeMonitorNode: (nodeId: string) => {
      const before = options.getState();
      update((state) => modelRemoveMonitorNode(state, nodeId));
      if (
        before.monitorRows.length > 0 &&
        options.getState().monitorRows.length === 0
      ) {
        stopMonitoring();
      }
    },
    startMonitoring,
    stopMonitoring,
    setSamplingIntervalMs: (value: number) => {
      update((state) => modelSetSamplingIntervalMs(state, value));
    },
  };
};
