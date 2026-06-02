<script lang="ts">
  import { RefreshCw } from "lucide-svelte";
  import type { TreeNode } from "../types.js";
  import IconButton from "./IconButton.svelte";
  import PanelHeader from "./PanelHeader.svelte";
  import TreeNodeRow from "./TreeNodeRow.svelte";

  type Props = {
    tree: TreeNode[];
    selectedNodeId: string;
    connected: boolean;
    onRefreshRoot: () => void;
    onSelect: (node: TreeNode) => void;
    onToggle: (node: TreeNode) => void;
    onLoadMore: (node: TreeNode) => void;
  };

  let { tree, selectedNodeId, connected, onRefreshRoot, onSelect, onToggle, onLoadMore }: Props = $props();
</script>

<aside class="min-h-80 border-b border-neutral-800 bg-neutral-950 lg:col-start-1 lg:row-start-1 lg:row-end-4 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-r lg:border-b-0 xl:row-end-3">
  <PanelHeader title="Address Space">
    {#snippet actions()}
      <IconButton title="Refresh root" onclick={onRefreshRoot} disabled={!connected || !tree[0]?.nodeId}>
        <RefreshCw size={15} />
      </IconButton>
    {/snippet}
  </PanelHeader>
  <div class="p-2 lg:min-h-0 lg:flex-1 lg:overflow-auto">
    {#if tree.length === 0}
      <div class="px-2 py-6 text-sm text-stone-500">No session</div>
    {:else}
      {#each tree as node (node.nodeId)}
        <TreeNodeRow {node} depth={0} {selectedNodeId} {onSelect} {onToggle} {onLoadMore} />
      {/each}
    {/if}
  </div>
</aside>
