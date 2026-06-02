<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    title: string;
    icon?: Snippet;
    actions?: Snippet;
  };

  let { title, icon, actions }: Props = $props();
</script>

<div class="flex h-10 shrink-0 items-center justify-between border-b border-neutral-800 px-3">
  <div class="flex min-w-0 items-center gap-2">
    {#if icon}
      {@render icon()}
    {/if}
    <div class="truncate text-sm font-medium text-stone-200">{title}</div>
  </div>
  {#if actions}
    <div class="flex items-center gap-2">
      {@render actions()}
    </div>
  {/if}
</div>
