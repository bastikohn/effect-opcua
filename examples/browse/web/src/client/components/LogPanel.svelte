<script lang="ts">
  import { Terminal } from "lucide-svelte";
  import type { LogRow } from "../types.js";
  import PanelHeader from "./PanelHeader.svelte";

  type Props = {
    rows: LogRow[];
  };

  let { rows }: Props = $props();
</script>

<section class="min-h-52 border-t border-neutral-800 bg-neutral-950 lg:col-start-2 lg:row-start-3 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden xl:col-start-2 xl:col-end-4 xl:row-start-2">
  <PanelHeader title="Operation Log">
    {#snippet icon()}
      <Terminal size={15} class="text-stone-400" />
    {/snippet}
  </PanelHeader>
  <div class="h-[200px] overflow-auto lg:h-auto lg:flex-1">
    {#each rows as row (row.id)}
      <div class="grid grid-cols-[82px_58px_minmax(0,1fr)] gap-2 border-b border-neutral-900 px-3 py-1.5 text-xs">
        <div class="font-mono text-stone-500">{row.time}</div>
        <div class={row.level === "error" ? "text-amber-400" : "text-emerald-400"}>{row.level}</div>
        <div class="truncate text-stone-300">{row.message}</div>
      </div>
    {:else}
      <div class="px-3 py-6 text-sm text-stone-500">No operations</div>
    {/each}
  </div>
</section>
