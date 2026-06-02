<script lang="ts">
  import { Exit } from "effect";
  import { Eye, Link, Send } from "lucide-svelte";
  import type { ReadNodeResponse } from "../../shared/rpc.js";
  import { parseJsonValue } from "../../shared/value.js";
  import { run, type ClientHandle } from "../rpc.js";
  import { accessText } from "../tree.js";
  import { displayValue, stringifyValue } from "../value-format.js";
  import DataTypeDefinition from "./DataTypeDefinition.svelte";
  import FieldGrid from "./FieldGrid.svelte";
  import IconButton from "./IconButton.svelte";

  type Props = {
    handle?: ClientHandle;
    selected?: ReadNodeResponse;
    selectedNodeId: string;
    onSelected: (selected: ReadNodeResponse) => void;
    onMonitorSelected: () => void;
    onLog: (level: "info" | "error", message: string) => void;
    messageOf: (error: unknown) => string;
  };

  let props: Props = $props();
  let writeText = $state("");

  const latestValue = $derived(props.selected?.value);
  const canWrite = $derived(
    props.selected?.metadata.accessLevel?.writable === true && props.selected?.metadata.userAccessLevel?.writable !== false,
  );
  const title = $derived(props.selected?.metadata.displayName ?? props.selected?.metadata.browseName ?? props.selectedNodeId);
  const fields = $derived(
    props.selected
      ? [
          { label: "NodeId", value: props.selected.metadata.nodeId },
          { label: "Node class", value: props.selected.metadata.nodeClass },
          { label: "Browse name", value: props.selected.metadata.browseName },
          { label: "Display name", value: props.selected.metadata.displayName },
          { label: "Description", value: props.selected.metadata.description },
          { label: "Data type", value: props.selected.metadata.dataType },
          { label: "Value rank", value: props.selected.metadata.valueRank },
          { label: "Array dimensions", value: props.selected.metadata.arrayDimensions?.join(" x ") },
          { label: "Access", value: accessText(props.selected.metadata.accessLevel) },
          { label: "User access", value: accessText(props.selected.metadata.userAccessLevel) },
          { label: "Namespace index", value: props.selected.metadata.namespaceIndex },
          { label: "Namespace URI", value: props.selected.metadata.namespaceUri },
        ]
      : [],
  );

  $effect(() => {
    writeText = stringifyValue(props.selected?.value);
  });

  async function readSelected() {
    if (!props.handle || !props.selected) return;
    const exit = await run(props.handle.client.ReadNode({ nodeId: props.selected.nodeId }));
    if (Exit.isFailure(exit)) {
      props.onLog("error", props.messageOf(exit.cause));
      return;
    }
    props.onSelected(exit.value);
    props.onLog("info", `Read ${exit.value.nodeId}`);
  }

  async function writeSelected() {
    if (!props.handle || !props.selected) return;
    const exit = await run(props.handle.client.WriteNode({ nodeId: props.selected.nodeId, value: parseJsonValue(writeText) }));
    if (Exit.isFailure(exit)) {
      props.onLog("error", props.messageOf(exit.cause));
      return;
    }
    const response = exit.value;
    props.onSelected(response.refreshed);
    writeText = stringifyValue(response.refreshed.value);
    props.onLog(
      response.write._tag === "Written" ? "info" : "error",
      response.write._tag === "Failed"
        ? response.write.message
        : `${response.write._tag} ${response.nodeId}: ${response.write.status.text}`,
    );
  }
</script>

<section class="min-h-[420px] min-w-0 overflow-auto border-b border-neutral-800 lg:col-start-2 lg:row-start-1 lg:min-h-0 xl:col-start-2 xl:row-start-1 xl:border-r">
  <div class="flex h-10 items-center justify-between border-b border-neutral-800 px-4">
    <div class="min-w-0 truncate text-sm font-medium text-stone-200">{title}</div>
    <div class="flex items-center gap-2">
      <IconButton title="Read selected" onclick={readSelected} disabled={!props.selected}>
        <Eye size={15} />
      </IconButton>
      <IconButton title="Monitor selected" onclick={props.onMonitorSelected} disabled={!props.selected}>
        <Link size={15} />
      </IconButton>
    </div>
  </div>

  {#if props.selected}
    <div class="grid gap-4 p-4">
      <FieldGrid {fields} />

      <div class="border border-neutral-800">
        <div class="flex h-9 items-center justify-between border-b border-neutral-800 px-3">
          <div class="text-sm font-medium text-stone-200">Value</div>
          <div class="text-xs text-stone-500">{latestValue?.status.text ?? props.selected.valueError?.message ?? "Not readable"}</div>
        </div>
        <pre class="max-h-48 overflow-auto bg-neutral-900 p-3 text-xs leading-5 text-stone-200">{displayValue(latestValue) || props.selected.valueError?.message || ""}</pre>
      </div>

      {#if canWrite}
        <div class="grid gap-2 border border-neutral-800 p-3">
          <div class="text-sm font-medium text-stone-200">Write</div>
          <textarea class="min-h-28 resize-y border border-neutral-700 bg-neutral-900 p-2 font-mono text-xs text-stone-100 outline-none focus:border-emerald-500" bind:value={writeText}></textarea>
          <div class="flex justify-end">
            <button class="flex h-8 items-center gap-2 border border-neutral-700 bg-neutral-900 px-3 text-sm text-stone-100 hover:bg-neutral-800" type="button" onclick={writeSelected} title="Write value">
              <Send size={15} />
              Write
            </button>
          </div>
        </div>
      {/if}

      {#if props.selected.dataTypeDefinition}
        <div class="border border-neutral-800">
          <div class="h-9 border-b border-neutral-800 px-3 py-2 text-sm font-medium text-stone-200">Data Type Definition</div>
          <div class="max-h-64 overflow-auto p-3 text-sm">
            <DataTypeDefinition definition={props.selected.dataTypeDefinition} />
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="p-8 text-sm text-stone-500">Select a node</div>
  {/if}
</section>
