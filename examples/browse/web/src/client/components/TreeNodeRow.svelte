<script lang="ts">
  import { ChevronDown, ChevronRight, RefreshCw } from "lucide-svelte";
  import type { TreeNode } from "../types.js";
  import TreeNodeRow from "./TreeNodeRow.svelte";

  type Props = {
    node: TreeNode;
    depth: number;
    selectedNodeId: string;
    onSelect: (node: TreeNode) => void;
    onToggle: (node: TreeNode) => void;
  };

  let { node, depth, selectedNodeId, onSelect, onToggle }: Props = $props();
</script>

<div>
  <div
    class={[
      "flex h-8 items-center gap-1 border border-transparent px-1 text-sm hover:border-neutral-800 hover:bg-neutral-900",
      selectedNodeId === node.nodeId && "border-neutral-700 bg-neutral-900 text-white",
    ]}
    style:padding-left={`${depth * 14 + 4}px`}
  >
    <button class="grid h-6 w-6 shrink-0 place-items-center text-stone-400 hover:text-stone-100" type="button" onclick={() => onToggle(node)} title={node.expanded ? "Collapse" : "Expand"}>
      {#if node.loading}
        <RefreshCw size={14} class="animate-spin" />
      {:else if node.expanded}
        <ChevronDown size={15} />
      {:else}
        <ChevronRight size={15} />
      {/if}
    </button>
    <button class="min-w-0 flex-1 truncate text-left" type="button" onclick={() => onSelect(node)} title={node.nodeId}>
      <span class="text-stone-200">{node.label}</span>
      <span class="ml-2 text-xs text-stone-500">{node.nodeClass ?? ""}</span>
    </button>
  </div>
  {#if node.expanded}
    {#each node.children as child (child.nodeId)}
      <TreeNodeRow node={child} depth={depth + 1} {selectedNodeId} {onSelect} {onToggle} />
    {/each}
  {/if}
</div>
