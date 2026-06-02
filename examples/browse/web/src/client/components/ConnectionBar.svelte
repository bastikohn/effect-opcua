<script lang="ts">
  import { ChevronDown, Circle, PlugZap, Square, Unplug } from "lucide-svelte";
  import type {
    AuthMode,
    ConnectionRequest,
    RecentConnectionAttempt,
  } from "../types.js";
  import {
    decryptPassword,
    encryptPassword,
    isPasswordStorageAvailable,
  } from "../lib/password-storage.js";
  import {
    connectionDetails,
    connectionKey,
    connectionLabel,
    loadConnectionAttempts,
    persistConnectionAttempts,
    recentConnectionOptions,
  } from "../lib/recent-connections.js";

  type Props = {
    connected: boolean;
    connecting: boolean;
    abortingConnect: boolean;
    handleReady: boolean;
    statusText: string;
    statusClass: string;
    onConnect: (request: ConnectionRequest) => void;
    onAbortConnect: () => void;
    onDisconnect: (resetNodeId: string) => void;
    onLogError: (message: string) => void;
  };

  let props: Props = $props();
  let endpointUrl = $state("opc.tcp://127.0.0.1:4840/UA/effect-opcua-demo");
  let startNodeId = $state("i=85");
  let authMode = $state<AuthMode>("Anonymous");
  let username = $state("");
  let password = $state("");
  let savePassword = $state(false);
  let passwordStorageAvailable = $state(false);
  let connectionAttempts = $state<RecentConnectionAttempt[]>([]);
  let recentConnectionsOpen = $state(false);

  const recentConnections = $derived(
    recentConnectionOptions(connectionAttempts),
  );

  $effect(() => {
    connectionAttempts = loadConnectionAttempts();
  });

  $effect(() => {
    passwordStorageAvailable = isPasswordStorageAvailable();
  });

  $effect(() => {
    const closeRecentConnections = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-recent-connection-picker]")) return;
      recentConnectionsOpen = false;
    };
    window.addEventListener("pointerdown", closeRecentConnections);
    return () =>
      window.removeEventListener("pointerdown", closeRecentConnections);
  });

  async function connect() {
    recentConnectionsOpen = false;
    await saveConnectionAttempt();
    props.onConnect({
      endpointUrl,
      startNodeId,
      auth:
        authMode === "Anonymous"
          ? { _tag: "Anonymous" }
          : { _tag: "UserPassword", username, password },
    });
  }

  async function saveConnectionAttempt() {
    const attempt: RecentConnectionAttempt = {
      endpointUrl,
      startNodeId,
      authMode,
      username: authMode === "UserPassword" ? username : "",
      attemptedAt: new Date().toISOString(),
    };
    const previous = recentConnections.find(
      (recent) => connectionKey(recent) === connectionKey(attempt),
    );
    if (authMode === "UserPassword" && savePassword && password.length > 0) {
      attempt.password = await encryptPassword(password, props.onLogError);
    }
    if (savePassword) attempt.password ??= previous?.password;
    connectionAttempts = [attempt, ...connectionAttempts];
    persistConnectionAttempts(connectionAttempts, props.onLogError);
  }

  function toggleRecentConnections() {
    if (props.connected || props.connecting || recentConnections.length === 0)
      return;
    recentConnectionsOpen = !recentConnectionsOpen;
  }

  async function selectRecentConnection(attempt: RecentConnectionAttempt) {
    endpointUrl = attempt.endpointUrl;
    startNodeId = attempt.startNodeId;
    authMode = attempt.authMode;
    username = attempt.username;
    password = "";
    savePassword = attempt.password !== undefined;
    recentConnectionsOpen = false;
    if (attempt.password)
      password = await decryptPassword(attempt.password, props.onLogError);
  }
</script>

<header class="border-b border-neutral-800 bg-neutral-950">
  <form
    class="flex flex-wrap items-end gap-3 px-4 py-3"
    onsubmit={(event) => event.preventDefault()}
  >
    <div class="grid min-w-72 flex-1 gap-1 text-sm text-stone-400">
      <label for="endpoint-url">Endpoint</label>
      <div class="relative" data-recent-connection-picker>
        <input
          id="endpoint-url"
          class="h-9 w-full border border-neutral-700 bg-neutral-900 px-2 pr-10 text-sm text-stone-100 outline-none focus:border-emerald-500"
          bind:value={endpointUrl}
          oninput={() => (recentConnectionsOpen = false)}
          disabled={props.connected || props.connecting}
        />
        <button
          class="absolute top-0 right-0 grid h-9 w-9 place-items-center border-l border-neutral-700 text-stone-400 hover:bg-neutral-800 hover:text-stone-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-400"
          type="button"
          onclick={toggleRecentConnections}
          disabled={props.connected ||
            props.connecting ||
            recentConnections.length === 0}
          aria-label="Recent connections"
          aria-expanded={recentConnectionsOpen}
          title="Recent connections"
        >
          <ChevronDown size={15} />
        </button>
        {#if recentConnectionsOpen}
          <div
            class="absolute top-[calc(100%+4px)] right-0 left-0 z-30 max-h-72 overflow-auto border border-neutral-700 bg-neutral-950 shadow-lg shadow-black/25"
          >
            {#each recentConnections as attempt (connectionKey(attempt))}
              <button
                class="grid w-full gap-0.5 border-b border-neutral-800 px-3 py-2 text-left last:border-b-0 hover:bg-neutral-900"
                type="button"
                onclick={() => selectRecentConnection(attempt)}
                title={connectionLabel(attempt)}
              >
                <span class="truncate text-sm text-stone-100"
                  >{attempt.endpointUrl}</span
                >
                <span class="truncate text-xs text-stone-500"
                  >{connectionDetails(attempt)}</span
                >
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <label class="grid w-32 gap-1 text-sm text-stone-400">
      Start node
      <input
        class="h-9 border border-neutral-700 bg-neutral-900 px-2 text-sm text-stone-100 outline-none focus:border-emerald-500"
        bind:value={startNodeId}
        disabled={props.connected || props.connecting}
      />
    </label>

    <label class="grid w-40 gap-1 text-sm text-stone-400">
      Auth
      <select
        class="h-9 border border-neutral-700 bg-neutral-900 px-2 text-sm text-stone-100 outline-none focus:border-emerald-500"
        bind:value={authMode}
        disabled={props.connected || props.connecting}
      >
        <option>Anonymous</option>
        <option>UserPassword</option>
      </select>
    </label>

    {#if authMode === "UserPassword"}
      <label class="grid w-40 gap-1 text-sm text-stone-400">
        Username
        <input
          class="h-9 border border-neutral-700 bg-neutral-900 px-2 text-sm text-stone-100 outline-none focus:border-emerald-500"
          autocomplete="username"
          bind:value={username}
          disabled={props.connected || props.connecting}
        />
      </label>
      <label class="grid w-44 gap-1 text-sm text-stone-400">
        <span class="flex items-center justify-between gap-3">
          Password
          <span class="flex items-center gap-1.5 text-xs text-stone-500">
            <input
              class="h-3.5 w-3.5 accent-emerald-600"
              type="checkbox"
              bind:checked={savePassword}
              disabled={props.connected ||
                props.connecting ||
                !passwordStorageAvailable}
            />
            Save
          </span>
        </span>
        <input
          class="h-9 border border-neutral-700 bg-neutral-900 px-2 text-sm text-stone-100 outline-none focus:border-emerald-500"
          type="password"
          autocomplete="current-password"
          bind:value={password}
          disabled={props.connected || props.connecting}
        />
      </label>
    {/if}

    {#if props.connected}
      <button
        class="flex h-9 items-center gap-2 border border-neutral-700 bg-neutral-900 px-3 text-sm text-stone-100 hover:bg-neutral-800 disabled:opacity-50"
        type="button"
        onclick={() => props.onDisconnect(startNodeId || "i=85")}
        disabled={props.connecting}
        title="Disconnect"
      >
        <Unplug size={16} />
        Disconnect
      </button>
    {:else if props.connecting}
      <button
        class="flex h-9 items-center gap-2 border border-red-800 bg-red-950 px-3 text-sm text-red-100 hover:bg-red-900 disabled:opacity-50"
        type="button"
        onclick={props.onAbortConnect}
        disabled={props.abortingConnect}
        title="Abort connection"
      >
        <Square size={13} />
        {props.abortingConnect ? "Aborting" : "Abort"}
      </button>
    {:else}
      <button
        class="flex h-9 items-center gap-2 border border-emerald-700 bg-emerald-700 px-3 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
        type="button"
        onclick={connect}
        disabled={!props.handleReady || props.connecting}
        title="Connect"
      >
        <PlugZap size={16} />
        Connect
      </button>
    {/if}

    <div class="ml-auto flex h-9 items-center gap-2 text-sm text-stone-400">
      <Circle size={10} class={props.statusClass} />
      {props.statusText}
    </div>
  </form>
</header>
