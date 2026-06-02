<script lang="ts">
  import ConnectionBar from "./components/ConnectionBar.svelte";
  import LogPanel from "./components/LogPanel.svelte";
  import MonitorPanel from "./components/MonitorPanel.svelte";
  import NodeDetailsPanel from "./components/NodeDetailsPanel.svelte";
  import TreePanel from "./components/TreePanel.svelte";
  import { makeHmiActions } from "./lib/actions.js";
  import {
    hmiViewState,
    initialHmiState,
    runtimeFailed,
    runtimeReady,
  } from "./lib/model.js";
  import { makeHmiRuntime, type HmiRuntime } from "./lib/runtime.js";

  let runtime = $state<HmiRuntime>();
  let hmi = $state(initialHmiState());

  const actions = makeHmiActions({
    getRuntime: () => runtime,
    getState: () => hmi,
    setState: (state) => (hmi = state),
  });
  const view = $derived(hmiViewState(hmi));

  $effect(() => {
    let cancelled = false;
    makeHmiRuntime()
      .then((hmiRuntime) => {
        if (cancelled) {
          void hmiRuntime.dispose();
        } else {
          runtime = hmiRuntime;
          hmi = runtimeReady(hmi);
          actions.log("info", "RPC websocket ready");
          void actions.loadConfig();
        }
      })
      .catch((error) => {
        hmi = runtimeFailed(hmi, actions.messageOf(error));
        actions.log("error", actions.messageOf(error));
      });

    return () => {
      cancelled = true;
      actions.dispose();
      if (runtime) void runtime.dispose();
    };
  });
</script>

<svelte:head>
  <title>Effect OPC UA Web</title>
</svelte:head>

<div class="min-h-screen bg-neutral-950 text-stone-200">
  <ConnectionBar
    connected={view.connected}
    connecting={view.connecting}
    abortingConnect={view.abortingConnect}
    handleReady={view.handleReady}
    statusText={view.statusText}
    statusClass={view.statusClass}
    onConnect={actions.connect}
    onAbortConnect={actions.abortConnect}
    onDisconnect={actions.disconnect}
    onLogError={(message) => actions.log("error", message)}
  />

  <main
    class="grid min-h-[calc(100vh-8rem)] grid-cols-1 overflow-auto lg:h-[calc(100vh-65px)] lg:min-h-0 lg:grid-cols-[300px_minmax(420px,1fr)] lg:grid-rows-[minmax(0,1fr)_minmax(0,280px)_220px] lg:overflow-hidden xl:grid-cols-[320px_minmax(420px,1fr)_380px] xl:grid-rows-[minmax(0,1fr)_240px]"
  >
    <TreePanel
      tree={hmi.tree}
      selectedNodeId={hmi.selectedNodeId}
      connected={view.connected}
      onRefreshRoot={() =>
        hmi.tree[0] && actions.loadChildren(hmi.tree[0].nodeId)}
      onSelect={(node) => actions.selectNode(node.nodeId)}
      onToggle={(node) => actions.toggleNode(node.nodeId)}
      onLoadMore={(node) => actions.loadMoreChildren(node.nodeId)}
    />
    <NodeDetailsPanel
      selected={hmi.selected}
      selectedNodeId={hmi.selectedNodeId}
      onReadSelected={actions.readSelected}
      onWriteSelected={actions.writeSelected}
      onMonitorSelected={() => actions.addMonitorNode()}
      writePolicy={hmi.writePolicy}
      writeOperation={hmi.writeOperation}
    />
    <MonitorPanel
      rows={hmi.monitorRows}
      samplingIntervalMs={hmi.samplingIntervalMs}
      monitorState={hmi.monitor}
      isMonitoring={view.isMonitoring}
      onSamplingIntervalChange={actions.setSamplingIntervalMs}
      onStart={actions.startMonitoring}
      onStop={actions.stopMonitoring}
      onRemove={actions.removeMonitorNode}
    />
    <LogPanel rows={hmi.logs} />
  </main>
</div>
