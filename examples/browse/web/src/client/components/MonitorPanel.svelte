<script lang="ts">
  import { Pause, Play, Square } from "lucide-svelte";
  import type { MonitorState } from "../lib/model.js";
  import type { MonitorRow } from "../types.js";
  import { compactValue, sparkline } from "../lib/value-format.js";
  import IconButton from "./IconButton.svelte";
  import PanelHeader from "./PanelHeader.svelte";

  type Props = {
    rows: MonitorRow[];
    samplingIntervalMs: number;
    monitorState: MonitorState;
    isMonitoring: boolean;
    onSamplingIntervalChange: (value: number) => void;
    onStart: () => void;
    onStop: () => void;
    onRemove: (nodeId: string) => void;
  };

  let {
    rows,
    samplingIntervalMs,
    monitorState,
    isMonitoring,
    onSamplingIntervalChange,
    onStart,
    onStop,
    onRemove,
  }: Props = $props();

  const monitorStatus = $derived(
    monitorState._tag === "Starting"
      ? "Starting"
      : monitorState._tag === "Running"
        ? `${monitorState.accepted.length} active${monitorState.rejected.length > 0 ? `, ${monitorState.rejected.length} rejected` : ""}`
        : monitorState._tag === "Failed"
          ? monitorState.error
          : "",
  );
</script>

<aside
  class="min-h-80 overflow-auto border-b border-neutral-800 bg-neutral-950 lg:col-start-2 lg:row-start-2 lg:min-h-0 xl:col-start-3 xl:row-start-1"
>
  <PanelHeader title="Monitored Variables">
    {#snippet actions()}
      <input
        class="h-7 w-20 border border-neutral-800 bg-neutral-900 px-2 text-xs text-stone-100 outline-none focus:border-emerald-500"
        type="number"
        min="50"
        value={samplingIntervalMs}
        oninput={(event) =>
          onSamplingIntervalChange(event.currentTarget.valueAsNumber)}
        title="Sampling interval"
      />
      {#if isMonitoring}
        <IconButton title="Stop monitoring" onclick={onStop}>
          <Pause size={15} />
        </IconButton>
      {:else}
        <IconButton
          title="Start monitoring"
          onclick={onStart}
          disabled={rows.length === 0}
        >
          <Play size={15} />
        </IconButton>
      {/if}
    {/snippet}
  </PanelHeader>
  {#if monitorStatus}
    <div class="border-b border-neutral-800 px-3 py-2 text-xs text-stone-500">
      {monitorStatus}
    </div>
  {/if}
  <div class="divide-y divide-neutral-800">
    {#each rows as row (row.nodeId)}
      <div class="grid gap-2 p-3">
        <div class="flex items-center justify-between gap-2">
          <div class="min-w-0">
            <div class="truncate text-sm text-stone-200">{row.label}</div>
            <div class="truncate text-xs text-stone-500">
              {row.nodeId}
              {#if row.monitorStatus !== "Desired"}
                <span
                  class={row.monitorStatus === "Rejected"
                    ? "text-red-400"
                    : "text-emerald-400"}
                >
                  - {row.monitorStatus}</span
                >
              {/if}
            </div>
            {#if row.rejectionMessage}
              <div class="truncate text-xs text-red-400">
                {row.rejectionMessage}
              </div>
            {/if}
          </div>
          <IconButton
            class="shrink-0 text-stone-400"
            title="Remove"
            onclick={() => onRemove(row.nodeId)}
          >
            <Square size={13} />
          </IconButton>
        </div>
        <div class="flex items-center gap-3">
          <svg
            class="h-8 flex-1 border border-neutral-800 bg-neutral-900"
            viewBox="0 0 100 32"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              points={sparkline(row.samples)}
              fill="none"
              stroke="#10b981"
              stroke-width="2"
              vector-effect="non-scaling-stroke"
            />
          </svg>
          <div
            class="w-28 truncate text-right font-mono text-xs text-stone-300"
          >
            {compactValue(row.samples.at(-1)?.sample)}
          </div>
        </div>
      </div>
    {:else}
      <div class="px-3 py-6 text-sm text-stone-500">No monitored nodes</div>
    {/each}
  </div>
</aside>
