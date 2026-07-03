import { describe, expect, it } from "vitest";

import type {
  BrowseReference,
  BrowseResponse,
  MonitorSample,
  ReadNodeResponse,
} from "../src/shared/rpc.js";
import {
  addMonitorNode,
  applyConfig,
  beginBrowse,
  beginConnect,
  beginMonitoring,
  beginRead,
  beginWrite,
  disconnectLocal,
  finishBrowseSuccess,
  finishConnectSuccess,
  finishMonitorFailure,
  finishReadSuccess,
  finishWriteFailure,
  finishWriteSuccess,
  initialHmiState,
  recordMonitorStarted,
  recordMonitorSample,
  runtimeReady,
  stopMonitoring,
} from "../src/client/lib/model.js";
import { WebRpcError } from "../src/shared/rpc.js";

describe("HMI model", () => {
  it("ignores stale read results after a newer selection", () => {
    let state = connectedState();

    const first = beginRead(state, "ns=1;s=Temperature");
    state = first.state;
    expect(first.token).toBeDefined();

    const second = beginRead(state, "ns=1;s=Pressure");
    state = second.state;
    expect(second.token).toBeDefined();

    state = finishReadSuccess(
      state,
      first.token!,
      readResponse("ns=1;s=Temperature", "Temperature"),
    );
    expect(state.selected?.nodeId).toBe("i=85");
    expect(state.selectedNodeId).toBe("ns=1;s=Pressure");

    state = finishReadSuccess(
      state,
      second.token!,
      readResponse("ns=1;s=Pressure", "Pressure"),
    );
    expect(state.selected?.nodeId).toBe("ns=1;s=Pressure");
  });

  it("keeps loaded value and definition across partial reads of the same node", () => {
    let state = connectedState();
    const definition = {
      _tag: "Success",
      dataTypeNodeId: "i=11",
      definition: {
        _tag: "Enum",
        dataTypeNodeId: "i=11",
        name: "Double",
        fields: [],
      },
    } as const;

    const metadataOnly = beginRead(state, "ns=1;s=Temperature");
    state = finishReadSuccess(metadataOnly.state, metadataOnly.token!, {
      ...readResponse("ns=1;s=Temperature", "Temperature"),
      value: undefined,
    });
    expect(state.selected?.value).toBeUndefined();

    const valueRead = beginRead(state, "ns=1;s=Temperature", {
      value: true,
      dataTypeDefinition: false,
    });
    state = finishReadSuccess(
      valueRead.state,
      valueRead.token!,
      readResponse("ns=1;s=Temperature", "Temperature"),
    );
    expect(state.selected?.value).toMatchObject({ _tag: "Value" });

    const definitionRead = beginRead(state, "ns=1;s=Temperature", {
      value: false,
      dataTypeDefinition: true,
    });
    state = finishReadSuccess(definitionRead.state, definitionRead.token!, {
      ...readResponse("ns=1;s=Temperature", "Temperature"),
      value: undefined,
      dataTypeDefinition: definition,
    });
    expect(state.selected?.value).toMatchObject({ _tag: "Value" });
    expect(state.selected?.dataTypeDefinition).toEqual(definition);

    const refresh = beginRead(state, "ns=1;s=Temperature", {
      value: true,
      dataTypeDefinition: false,
    });
    state = finishReadSuccess(
      refresh.state,
      refresh.token!,
      readResponse("ns=1;s=Temperature", "Temperature"),
    );
    expect(state.selected?.dataTypeDefinition).toEqual(definition);
  });

  it("ignores stale browse results after disconnect cleanup", () => {
    let state = connectedState();
    const started = beginBrowse(state, "i=85");
    state = started.state;
    expect(started.token).toBeDefined();
    expect(state.tree[0]?.loading).toBe(true);

    state = disconnectLocal(state, "i=85");
    state = finishBrowseSuccess(
      state,
      started.token!,
      browseResponse("i=85", [browseReference("ns=1;s=Temperature")]),
    );

    expect(state.tree).toEqual([]);
    expect(state.selected).toBeUndefined();
    expect(state.monitorRows).toEqual([]);
  });

  it("appends continuation browse results and ignores stale continuation results", () => {
    let state = connectedState();
    const first = beginBrowse(state, "i=85");
    state = first.state;
    state = finishBrowseSuccess(
      state,
      first.token!,
      browseResponse(
        "i=85",
        [browseReference("ns=1;s=Temperature")],
        "next-page",
      ),
    );

    expect(state.tree[0]?.children.map((node) => node.nodeId)).toEqual([
      "ns=1;s=Temperature",
    ]);
    expect(state.tree[0]?.continuationToken).toBe("next-page");

    const second = beginBrowse(state, "i=85", "append");
    state = second.state;
    state = finishBrowseSuccess(
      state,
      second.token!,
      browseResponse("i=85", [browseReference("ns=1;s=Pressure")]),
    );

    expect(state.tree[0]?.children.map((node) => node.nodeId)).toEqual([
      "ns=1;s=Temperature",
      "ns=1;s=Pressure",
    ]);
    expect(state.tree[0]?.continuationToken).toBeUndefined();

    const stale = beginBrowse(
      finishBrowseSuccess(
        second.state,
        second.token!,
        browseResponse(
          "i=85",
          [browseReference("ns=1;s=Pressure")],
          "stale-next-page",
        ),
      ),
      "i=85",
      "append",
    );
    state = disconnectLocal(stale.state, "i=85");
    state = finishBrowseSuccess(
      state,
      stale.token!,
      browseResponse("i=85", [browseReference("ns=1;s=Flow")]),
    );
    expect(state.tree).toEqual([]);
  });

  it("ignores monitor samples after monitor stop", () => {
    let state = addMonitorNode(connectedState(), "ns=1;s=Temperature");
    const started = beginMonitoring(state);
    state = started.state;
    expect(started.token).toBeDefined();

    state = stopMonitoring(state);
    state = recordMonitorSample(
      state,
      started.token!,
      monitorSample("ns=1;s=Temperature", 21),
    );

    expect(state.monitorRows[0]?.samples).toEqual([]);
  });

  it("tracks monitor accepted, rejected, and stream failure state", () => {
    let state = addMonitorNode(connectedState(), "ns=1;s=Temperature");
    state = addMonitorNode(state, "ns=1;s=Rejected");
    const started = beginMonitoring(state);
    state = started.state;
    expect(state.monitor._tag).toBe("Starting");

    state = recordMonitorStarted(state, started.token!, {
      accepted: ["ns=1;s=Temperature"],
      rejected: [
        {
          nodeId: "ns=1;s=Rejected",
          message: "Access denied",
          phase: "Validation",
        },
      ],
    });

    expect(state.monitor._tag).toBe("Running");
    expect(
      state.monitorRows.map((row) => [row.nodeId, row.monitorStatus]),
    ).toEqual([
      ["ns=1;s=Temperature", "Accepted"],
      ["ns=1;s=Rejected", "Rejected"],
    ]);

    state = finishMonitorFailure(state, started.token!, "stream failed");
    expect(state.monitor).toMatchObject({
      _tag: "Failed",
      error: "stream failed",
    });
  });

  it("tracks write success, non-good status, and failure state", () => {
    let state = applyConfig(connectedState(), {
      writePolicy: { _tag: "Enabled", reason: "RuntimeConfig" },
    });
    const started = beginWrite(state, "i=85");
    state = started.state;
    expect(state.writeOperation).toMatchObject({ _tag: "Running" });

    state = finishWriteSuccess(
      state,
      started.token!,
      writeResponse("i=85", "Written"),
    );
    expect(state.writeOperation).toMatchObject({ _tag: "Written" });

    const second = beginWrite(state, "i=85");
    state = finishWriteSuccess(
      second.state,
      second.token!,
      writeResponse("i=85", "NonGoodStatus"),
    );
    expect(state.writeOperation).toMatchObject({ _tag: "NonGoodStatus" });

    const third = beginWrite(state, "i=85");
    state = finishWriteFailure(
      third.state,
      third.token!,
      new WebRpcError({
        category: "Configuration",
        operation: "WriteNode",
        nodeId: "i=85",
        message: "Writes are disabled",
      }),
    );
    expect(state.writeOperation).toMatchObject({
      _tag: "Failed",
      message: "Writes are disabled",
    });
  });
});

const connectedState = () => {
  let state = runtimeReady(initialHmiState());
  const started = beginConnect(state, {
    endpointUrl: "opc.tcp://localhost:4840",
    startNodeId: "i=85",
  });
  state = finishConnectSuccess(started.state, started.token, {
    connected: true,
    endpointUrl: "opc.tcp://localhost:4840",
  });
  const rootRead = beginRead(state, "i=85");
  state = finishReadSuccess(
    rootRead.state,
    rootRead.token!,
    readResponse("i=85", "Objects"),
  );
  return state;
};

const goodStatus = {
  text: "Good",
  code: 0,
  isGood: true,
  isUncertain: false,
  isBad: false,
};

const readResponse = (nodeId: string, label: string): ReadNodeResponse => ({
  nodeId,
  metadata: {
    nodeId,
    nodeClass: "Variable",
    browseName: label,
    displayName: label,
    accessLevel: { readable: true, writable: true },
    userAccessLevel: { readable: true, writable: true },
  },
  value: {
    _tag: "Value",
    nodeId,
    value: null,
    status: goodStatus,
  },
});

const browseReference = (nodeId: string): BrowseReference => ({
  nodeId,
  isRemote: false,
  browseName: nodeId,
  displayName: nodeId,
});

const browseResponse = (
  nodeId: string,
  references: readonly BrowseReference[],
  continuationToken?: string,
): BrowseResponse => ({
  _tag: "Browsed",
  nodeId,
  status: goodStatus,
  references: [...references],
  continuationToken,
});

const monitorSample = (nodeId: string, value: number): MonitorSample => ({
  nodeId,
  sample: {
    _tag: "Value",
    nodeId,
    value,
    status: goodStatus,
  },
});

const writeResponse = (nodeId: string, tag: "Written" | "NonGoodStatus") => ({
  nodeId,
  attemptedValue: 1,
  writtenAt: "2026-06-02T00:00:00.000Z",
  write: {
    _tag: tag,
    nodeId,
    status: goodStatus,
  },
  refreshed: readResponse(nodeId, nodeId),
});
