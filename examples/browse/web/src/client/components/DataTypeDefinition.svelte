<script lang="ts">
  import type { DataTypeDefinitionResult } from "../../shared/rpc.js";

  type Props = {
    definition: DataTypeDefinitionResult;
  };

  let { definition }: Props = $props();
</script>

{#if definition._tag === "Success"}
  <div class="mb-2 font-mono text-xs text-stone-500">{definition.dataTypeNodeId}</div>
  {#if definition.definition._tag === "Structure"}
    <div class="mb-2 text-sm text-stone-200">{definition.definition.name} · {definition.definition.structureType}</div>
    <div class="grid grid-cols-[minmax(120px,1fr)_minmax(120px,1fr)_70px] gap-x-3 gap-y-1 text-xs">
      {#each definition.definition.fields as field (field.name)}
        <div class="truncate text-stone-200">{field.name}</div>
        <div class="truncate font-mono text-stone-400">{field.dataTypeNodeId}</div>
        <div class="text-stone-500">{field.isOptional ? "optional" : ""}</div>
      {/each}
    </div>
  {:else}
    <div class="mb-2 text-sm text-stone-200">{definition.definition.name}</div>
    <div class="grid grid-cols-[minmax(120px,1fr)_80px] gap-x-3 gap-y-1 text-xs">
      {#each definition.definition.fields as field (field.name)}
        <div class="truncate text-stone-200">{field.name}</div>
        <div class="font-mono text-stone-400">{field.value}</div>
      {/each}
    </div>
  {/if}
{:else}
  <div class="text-sm text-stone-400">{definition._tag}: {definition.reason}</div>
{/if}
