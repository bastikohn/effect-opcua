<script lang="ts">
  import type { Snippet } from "svelte";

  type Props = {
    title: string;
    disabled?: boolean;
    class?: string;
    children: Snippet;
    onclick: () => void;
  };

  let { title, disabled = false, class: className = "", children, onclick }: Props = $props();
</script>

<button
  class={["grid h-7 w-7 place-items-center border border-neutral-800 bg-neutral-900 text-stone-300 hover:bg-neutral-800 disabled:opacity-50", className]}
  type="button"
  {onclick}
  {disabled}
  {title}
>
  {@render children()}
</button>
