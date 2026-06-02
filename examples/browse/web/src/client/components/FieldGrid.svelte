<script lang="ts">
  type Field = {
    label: string;
    value: unknown;
  };

  type Props = {
    fields: Field[];
  };

  let { fields }: Props = $props();
</script>

<div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
  {#each fields as field (field.label)}
    <div class="text-stone-500">{field.label}</div>
    <div class="min-w-0 truncate font-mono text-stone-200">{field.value ?? ""}</div>
  {/each}
</div>
