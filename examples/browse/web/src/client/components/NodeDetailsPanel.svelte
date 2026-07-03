<script lang="ts">
  import { Eye, Link, Send } from "lucide-svelte";
  import type { ReadNodeResponse } from "../../shared/rpc.js";
  import type { HmiWritePolicy, WriteOperationState } from "../lib/model.js";
  import { accessText } from "../lib/tree.js";
  import { displayValue, stringifyValue } from "../lib/value-format.js";
  import DataTypeDefinition from "./DataTypeDefinition.svelte";
  import FieldGrid from "./FieldGrid.svelte";
  import IconButton from "./IconButton.svelte";

  type Props = {
    selected?: ReadNodeResponse;
    selectedNodeId: string;
    onReadSelected: () => void;
    onLoadDataTypeDefinition: () => void;
    onWriteSelected: (text: string) => void;
    onMonitorSelected: () => void;
    writePolicy: HmiWritePolicy;
    writeOperation: WriteOperationState;
  };

  let props: Props = $props();
  let writeText = $state("");

  const latestValue = $derived(props.selected?.value);
  const valueReadable = $derived(
    props.selected?.metadata.accessLevel?.readable === true &&
      props.selected?.metadata.userAccessLevel?.readable !== false,
  );
  const valueStatusText = $derived(
    latestValue?.status.text ??
      props.selected?.valueError?.message ??
      (valueReadable ? "Not loaded" : "Not readable"),
  );
  const canWrite = $derived(
    props.writePolicy._tag === "Enabled" &&
      props.selected?.metadata.accessLevel?.writable === true &&
      props.selected?.metadata.userAccessLevel?.writable !== false,
  );
  const writeSupportedByNode = $derived(
    props.selected?.metadata.accessLevel?.writable === true &&
      props.selected?.metadata.userAccessLevel?.writable !== false,
  );
  const writeRunning = $derived(props.writeOperation._tag === "Running");
  const writePolicyText = $derived(
    props.writePolicy._tag === "Enabled"
      ? "Writes enabled"
      : props.writePolicy._tag === "Disabled"
        ? "Writes disabled"
        : "Write policy loading",
  );
  const writeStatusText = $derived(
    props.writeOperation._tag === "Running"
      ? `Writing ${props.writeOperation.nodeId}`
      : props.writeOperation._tag === "Written" ||
          props.writeOperation._tag === "NonGoodStatus"
        ? `${props.writeOperation._tag} ${props.writeOperation.response.write.status.text}`
        : props.writeOperation._tag === "Failed"
          ? props.writeOperation.message
          : writePolicyText,
  );
  const title = $derived(
    props.selected?.metadata.displayName ??
      props.selected?.metadata.browseName ??
      props.selectedNodeId,
  );
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
          {
            label: "Array dimensions",
            value: props.selected.metadata.arrayDimensions?.join(" x "),
          },
          {
            label: "Access",
            value: accessText(props.selected.metadata.accessLevel),
          },
          {
            label: "User access",
            value: accessText(props.selected.metadata.userAccessLevel),
          },
          {
            label: "Namespace index",
            value: props.selected.metadata.namespaceIndex,
          },
          {
            label: "Namespace URI",
            value: props.selected.metadata.namespaceUri,
          },
        ]
      : [],
  );

  $effect(() => {
    writeText = stringifyValue(props.selected?.value);
  });

  const readSelected = () => props.onReadSelected();
  const writeSelected = () => props.onWriteSelected(writeText);
</script>

<section
  class="min-h-[420px] min-w-0 overflow-auto border-b border-neutral-800 lg:col-start-2 lg:row-start-1 lg:min-h-0 xl:col-start-2 xl:row-start-1 xl:border-r"
>
  <div
    class="flex h-10 items-center justify-between border-b border-neutral-800 px-4"
  >
    <div class="min-w-0 truncate text-sm font-medium text-stone-200">
      {title}
    </div>
    <div class="flex items-center gap-2">
      <IconButton
        title="Read selected"
        onclick={readSelected}
        disabled={!props.selected}
      >
        <Eye size={15} />
      </IconButton>
      <IconButton
        title="Monitor selected"
        onclick={props.onMonitorSelected}
        disabled={!props.selected}
      >
        <Link size={15} />
      </IconButton>
    </div>
  </div>

  {#if props.selected}
    <div class="grid gap-4 p-4">
      <FieldGrid {fields} />

      <div class="border border-neutral-800">
        <div
          class="flex h-9 items-center justify-between border-b border-neutral-800 px-3"
        >
          <div class="text-sm font-medium text-stone-200">Value</div>
          <div class="flex items-center gap-2">
            <div class="text-xs text-stone-500">{valueStatusText}</div>
            {#if valueReadable}
              <button
                class="flex h-6 items-center border border-neutral-700 bg-neutral-900 px-2 text-xs text-stone-100 hover:bg-neutral-800"
                type="button"
                onclick={readSelected}
                title="Read value"
              >
                Read
              </button>
            {/if}
          </div>
        </div>
        <pre
          class="max-h-48 overflow-auto bg-neutral-900 p-3 text-xs leading-5 text-stone-200">{displayValue(
            latestValue,
          ) ||
            props.selected.valueError?.message ||
            ""}</pre>
      </div>

      {#if writeSupportedByNode}
        <div class="grid gap-2 border border-neutral-800 p-3">
          <div class="flex items-center justify-between gap-3">
            <div class="text-sm font-medium text-stone-200">Write</div>
            <div class="text-xs text-stone-500">{writeStatusText}</div>
          </div>
          <textarea
            class="min-h-28 resize-y border border-neutral-700 bg-neutral-900 p-2 font-mono text-xs text-stone-100 outline-none focus:border-emerald-500"
            bind:value={writeText}
          ></textarea>
          <div class="flex justify-end">
            <button
              class="flex h-8 items-center gap-2 border border-neutral-700 bg-neutral-900 px-3 text-sm text-stone-100 hover:bg-neutral-800 disabled:cursor-default disabled:opacity-50"
              type="button"
              onclick={writeSelected}
              disabled={!canWrite || writeRunning}
              title="Write value"
            >
              <Send size={15} />
              Write
            </button>
          </div>
        </div>
      {/if}

      {#if props.selected.metadata.dataType}
        <div class="border border-neutral-800">
          <div
            class="flex h-9 items-center justify-between border-b border-neutral-800 px-3"
          >
            <div class="text-sm font-medium text-stone-200">
              Data Type Definition
            </div>
            {#if !props.selected.dataTypeDefinition}
              <button
                class="flex h-6 items-center border border-neutral-700 bg-neutral-900 px-2 text-xs text-stone-100 hover:bg-neutral-800"
                type="button"
                onclick={props.onLoadDataTypeDefinition}
                title="Load data type definition"
              >
                Load
              </button>
            {/if}
          </div>
          {#if props.selected.dataTypeDefinition}
            <div class="max-h-64 overflow-auto p-3 text-sm">
              <DataTypeDefinition
                definition={props.selected.dataTypeDefinition}
              />
            </div>
          {:else}
            <div class="p-3 text-xs text-stone-500">
              Definition not loaded
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <div class="p-8 text-sm text-stone-500">Select a node</div>
  {/if}
</section>
