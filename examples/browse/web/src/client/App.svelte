<script lang="ts">
  import { Cause, Exit, type Fiber } from "effect";
  import type { ReadNodeResponse } from "../shared/rpc.js";
  import { errorMessage } from "../shared/value.js";
  import ConnectionBar from "./components/ConnectionBar.svelte";
  import LogPanel from "./components/LogPanel.svelte";
  import MonitorPanel from "./components/MonitorPanel.svelte";
  import NodeDetailsPanel from "./components/NodeDetailsPanel.svelte";
  import TreePanel from "./components/TreePanel.svelte";
  import {
    awaitFiber,
    interrupt,
    makeClientHandle,
    run,
    runFork,
    runStream,
    type ClientHandle,
  } from "./rpc.js";
  import { nodeFromRead, nodeFromReference } from "./tree.js";
  import type { ConnectionRequest, LogRow, MonitorRow, TreeNode } from "./types.js";

  let handle = $state<ClientHandle>();
  let connected = $state(false);
  let connectFiber = $state<Fiber.Fiber<ReadNodeResponse, unknown>>();
  let abortingConnect = $state(false);
  let tree = $state<TreeNode[]>([]);
  let selected = $state<ReadNodeResponse>();
  let selectedNodeId = $state("i=85");
  let monitorRows = $state<MonitorRow[]>([]);
  let samplingIntervalMs = $state(500);
  let monitorFiber = $state<ReturnType<typeof runStream>>();
  let logs = $state<LogRow[]>([]);

  const connecting = $derived(connectFiber !== undefined);
  const statusText = $derived(
    connected ? "Connected" : connecting ? (abortingConnect ? "Aborting" : "Connecting") : handle ? "Ready" : "Opening RPC",
  );
  const statusClass = $derived(
    connected
      ? "fill-emerald-500 text-emerald-500"
      : connecting
        ? "fill-amber-500 text-amber-500"
        : "fill-neutral-600 text-neutral-600",
  );
  const isMonitoring = $derived(monitorFiber !== undefined);

  $effect(() => {
    let cancelled = false;
    makeClientHandle()
      .then((clientHandle) => {
        if (cancelled) {
          void clientHandle.close();
        } else {
          handle = clientHandle;
          log("info", "RPC websocket ready");
        }
      })
      .catch((error) => log("error", messageOf(error)));

    return () => {
      cancelled = true;
      const fiber = connectFiber;
      connectFiber = undefined;
      if (fiber) interrupt(fiber);
      stopMonitoring();
      if (handle) void handle.close();
    };
  });

  async function connect(request: ConnectionRequest) {
    if (!handle || connectFiber) return;
    abortingConnect = false;
    const fiber: Fiber.Fiber<ReadNodeResponse, unknown> = runFork(
      handle.client.Connect({ endpointUrl: request.endpointUrl, startNodeId: request.startNodeId, auth: request.auth }),
    );
    connectFiber = fiber;
    const exit: Exit.Exit<ReadNodeResponse, unknown> = await awaitFiber(fiber);
    if (connectFiber !== fiber) return;
    connectFiber = undefined;
    abortingConnect = false;
    const response = Exit.match(exit, {
      onFailure: (cause) => {
        const interrupted = Cause.hasInterrupts(cause);
        connected = false;
        log(interrupted ? "info" : "error", interrupted ? "Connection attempt aborted" : messageOf(cause));
        return undefined;
      },
      onSuccess: (value) => value,
    });
    if (!response) return;
    connected = true;
    selected = response;
    selectedNodeId = response.nodeId;
    tree = [nodeFromRead(response)];
    await loadChildren(tree[0]);
    log("info", `Connected ${request.endpointUrl}`);
  }

  function abortConnect() {
    if (!connectFiber || abortingConnect) return;
    abortingConnect = true;
    interrupt(connectFiber);
  }

  async function disconnect(resetNodeId: string) {
    if (!handle) return;
    stopMonitoring();
    const exit = await run(handle.client.Disconnect());
    if (Exit.isFailure(exit)) {
      log("error", messageOf(exit.cause));
    } else {
      log("info", "Disconnected");
    }
    connected = false;
    selected = undefined;
    selectedNodeId = resetNodeId;
    tree = [];
    monitorRows = [];
  }

  async function selectNode(node: TreeNode) {
    if (!handle || !connected) return;
    selectedNodeId = node.nodeId;
    const exit = await run(handle.client.ReadNode({ nodeId: node.nodeId }));
    if (Exit.isFailure(exit)) {
      log("error", messageOf(exit.cause));
      return;
    }
    selected = exit.value;
    log("info", `Read ${node.nodeId}`);
  }

  async function toggleNode(node: TreeNode) {
    node.expanded = !node.expanded;
    if (node.expanded && !node.loaded) await loadChildren(node);
  }

  async function loadChildren(node: TreeNode) {
    if (!handle || !connected || node.loading) return;
    node.loading = true;
    const exit = await run(handle.client.Browse({ nodeId: node.nodeId }));
    if (Exit.isFailure(exit)) {
      log("error", messageOf(exit.cause));
    } else {
      node.children = exit.value.references.map(nodeFromReference);
      node.loaded = true;
      log("info", `Browse ${node.nodeId}: ${exit.value.references.length}`);
    }
    node.loading = false;
  }

  function addMonitorNode(nodeId = selected?.nodeId) {
    if (!nodeId || monitorRows.some((row) => row.nodeId === nodeId)) return;
    monitorRows = [
      ...monitorRows,
      {
        nodeId,
        label: selected?.metadata.displayName ?? selected?.metadata.browseName ?? nodeId,
        samples: [],
      },
    ];
  }

  function removeMonitorNode(nodeId: string) {
    monitorRows = monitorRows.filter((row) => row.nodeId !== nodeId);
    if (monitorRows.length === 0) stopMonitoring();
  }

  function startMonitoring() {
    if (!handle || monitorRows.length === 0) return;
    stopMonitoring();
    const nodeIds = monitorRows.map((row) => row.nodeId);
    monitorFiber = runStream(
      handle.client.MonitorValues({ nodeIds, samplingIntervalMs }),
      (sample) => {
        const index = monitorRows.findIndex((row) => row.nodeId === sample.nodeId);
        if (index === -1) return;
        const next = [...monitorRows];
        const row = next[index];
        next[index] = { ...row, samples: [...row.samples.slice(-29), sample] };
        monitorRows = next;
      },
      (error) => {
        monitorFiber = undefined;
        log("error", messageOf(error));
      },
    );
    log("info", `Monitoring ${nodeIds.length} node(s)`);
  }

  function stopMonitoring() {
    if (!monitorFiber) return;
    interrupt(monitorFiber);
    monitorFiber = undefined;
    log("info", "Monitoring stopped");
  }

  function setSelected(response: ReadNodeResponse) {
    selected = response;
    selectedNodeId = response.nodeId;
  }

  function log(level: LogRow["level"], message: string) {
    logs = [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString(), level, message }, ...logs].slice(0, 80);
  }

  function messageOf(error: unknown) {
    const message = errorMessage(error);
    return message.length > 0 && message !== "{}" ? message : "Unknown error";
  }
</script>

<svelte:head>
  <title>Effect OPC UA Web</title>
</svelte:head>

<div class="min-h-screen bg-neutral-950 text-stone-200">
  <ConnectionBar
    {connected}
    {connecting}
    {abortingConnect}
    handleReady={handle !== undefined}
    {statusText}
    {statusClass}
    onConnect={connect}
    onAbortConnect={abortConnect}
    onDisconnect={disconnect}
    onLogError={(message) => log("error", message)}
  />

  <main class="grid min-h-[calc(100vh-8rem)] grid-cols-1 overflow-auto lg:h-[calc(100vh-65px)] lg:min-h-0 lg:grid-cols-[300px_minmax(420px,1fr)] lg:grid-rows-[minmax(0,1fr)_minmax(0,280px)_220px] lg:overflow-hidden xl:grid-cols-[320px_minmax(420px,1fr)_380px] xl:grid-rows-[minmax(0,1fr)_240px]">
    <TreePanel
      {tree}
      {selectedNodeId}
      {connected}
      onRefreshRoot={() => tree[0] && loadChildren(tree[0])}
      onSelect={selectNode}
      onToggle={toggleNode}
    />
    <NodeDetailsPanel
      {handle}
      {selected}
      {selectedNodeId}
      onSelected={setSelected}
      onMonitorSelected={() => addMonitorNode()}
      onLog={log}
      {messageOf}
    />
    <MonitorPanel
      rows={monitorRows}
      {samplingIntervalMs}
      {isMonitoring}
      onSamplingIntervalChange={(value) => (samplingIntervalMs = value)}
      onStart={startMonitoring}
      onStop={stopMonitoring}
      onRemove={removeMonitorNode}
    />
    <LogPanel rows={logs} />
  </main>
</div>
