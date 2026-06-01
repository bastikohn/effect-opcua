<script lang="ts">
  import {
    ChevronDown,
    ChevronRight,
    Circle,
    Eye,
    Link,
    Pause,
    Play,
    PlugZap,
    RefreshCw,
    Send,
    Square,
    Terminal,
    Unplug,
  } from "lucide-svelte";
  import type { AccessBits, DataTypeDefinitionResult } from "../shared/rpc.js";
  import type {
    BrowseReference,
    MonitorSample,
    ReadNodeResponse,
    ReadValue,
  } from "../shared/rpc.js";
  import { errorMessage, parseJsonValue } from "../shared/value.js";
  import { Cause, Exit, type Fiber } from "effect";
  import {
    awaitFiber,
    interrupt,
    makeClientHandle,
    run,
    runFork,
    runStream,
    type ClientHandle,
  } from "./rpc.js";

  type AuthMode = "Anonymous" | "UserPassword";
  type TreeNode = {
    nodeId: string;
    label: string;
    nodeClass?: string;
    metadata?: BrowseReference["metadata"];
    expanded: boolean;
    loading: boolean;
    loaded: boolean;
    children: TreeNode[];
  };
  type LogRow = {
    id: number;
    time: string;
    level: "info" | "error";
    message: string;
  };
  type MonitorRow = {
    nodeId: string;
    label: string;
    samples: MonitorSample[];
  };
  type RecentConnectionAttempt = {
    endpointUrl: string;
    startNodeId: string;
    authMode: AuthMode;
    username: string;
    password?: EncryptedPassword;
    attemptedAt: string;
  };
  type EncryptedPassword = {
    keyId: string;
    iv: string;
    ciphertext: string;
  };

  const RECENT_CONNECTIONS_STORAGE_KEY = "effect-opcua.recentConnections";
  const RECENT_CONNECTION_OPTIONS = 20;
  const PASSWORD_KEY_DB = "effect-opcua-passwords";
  const PASSWORD_KEY_STORE = "keys";
  const PASSWORD_KEY_ID = "default";

  let handle = $state<ClientHandle>();
  let endpointUrl = $state("opc.tcp://127.0.0.1:4840/UA/effect-opcua-demo");
  let startNodeId = $state("i=85");
  let authMode = $state<AuthMode>("Anonymous");
  let username = $state("");
  let password = $state("");
  let savePassword = $state(false);
  let passwordStorageAvailable = $state(false);
  let connectionAttempts = $state<RecentConnectionAttempt[]>([]);
  let recentConnectionsOpen = $state(false);
  let connected = $state(false);
  let connectFiber = $state<Fiber.Fiber<ReadNodeResponse, unknown>>();
  let abortingConnect = $state(false);
  let tree = $state<TreeNode[]>([]);
  let selected = $state<ReadNodeResponse>();
  let selectedNodeId = $state("i=85");
  let writeText = $state("");
  let monitorRows = $state<MonitorRow[]>([]);
  let samplingIntervalMs = $state(500);
  let monitorFiber = $state<ReturnType<typeof runStream>>();
  let logs = $state<LogRow[]>([]);

  const latestValue = $derived(selected?.value);
  const canWrite = $derived(
    selected?.metadata.accessLevel?.writable === true &&
      selected?.metadata.userAccessLevel?.writable !== false,
  );
  const connecting = $derived(connectFiber !== undefined);
  const statusText = $derived(
    connected
      ? "Connected"
      : connecting
        ? abortingConnect
          ? "Aborting"
          : "Connecting"
        : handle
          ? "Ready"
          : "Opening RPC",
  );
  const statusClass = $derived(
    connected
      ? "fill-emerald-500 text-emerald-500"
      : connecting
        ? "fill-amber-500 text-amber-500"
        : "fill-neutral-600 text-neutral-600",
  );
  const isMonitoring = $derived(monitorFiber !== undefined);
  const recentConnections = $derived(recentConnectionOptions(connectionAttempts));

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
    return () => window.removeEventListener("pointerdown", closeRecentConnections);
  });

  $effect(() => {
    let cancelled = false;
    makeClientHandle()
      .then((clientHandle) => {
        if (cancelled) {
          void clientHandle.close();
        } else {
          handle = clientHandle;
          log("info", "RPC websocket ready");
        }
      })
      .catch((error) => log("error", messageOf(error)));

    return () => {
      cancelled = true;
      const fiber = connectFiber;
      connectFiber = undefined;
      if (fiber) interrupt(fiber);
      stopMonitoring();
      if (handle) void handle.close();
    };
  });

  async function connect() {
    if (!handle || connectFiber) return;
    abortingConnect = false;
    recentConnectionsOpen = false;
    await saveConnectionAttempt();
    const fiber: Fiber.Fiber<ReadNodeResponse, unknown> = runFork(
      handle.client.Connect({
        endpointUrl,
        startNodeId,
        auth:
          authMode === "Anonymous"
            ? { _tag: "Anonymous" as const }
            : {
                _tag: "UserPassword" as const,
                username,
                password,
              },
      }),
    );
    connectFiber = fiber;
    const exit: Exit.Exit<ReadNodeResponse, unknown> = await awaitFiber(fiber);
    if (connectFiber !== fiber) return;
    connectFiber = undefined;
    abortingConnect = false;
    const response = Exit.match(exit, {
      onFailure: (cause) => {
        const interrupted = Cause.hasInterrupts(cause);
        connected = false;
        log(
          interrupted ? "info" : "error",
          interrupted ? "Connection attempt aborted" : messageOf(cause),
        );
        return undefined;
      },
      onSuccess: (value) => value,
    });
    if (!response) return;
    connected = true;
    selected = response;
    selectedNodeId = response.nodeId;
    writeText = stringifyValue(response.value);
    tree = [nodeFromRead(response)];
    await loadChildren(tree[0]);
    log("info", `Connected ${endpointUrl}`);
  }

  function abortConnect() {
    if (!connectFiber || abortingConnect) return;
    abortingConnect = true;
    interrupt(connectFiber);
  }

  async function disconnect() {
    if (!handle) return;
    stopMonitoring();
    const exit = await run(handle.client.Disconnect());
    if (Exit.isFailure(exit)) {
      log("error", messageOf(exit.cause));
    } else {
      log("info", "Disconnected");
    }
    connected = false;
    selected = undefined;
    selectedNodeId = startNodeId || "i=85";
    writeText = "";
    tree = [];
    monitorRows = [];
  }

  async function selectNode(node: TreeNode) {
    if (!handle || !connected) return;
    selectedNodeId = node.nodeId;
    const exit = await run(handle.client.ReadNode({ nodeId: node.nodeId }));
    if (Exit.isFailure(exit)) {
      log("error", messageOf(exit.cause));
      return;
    }
    const response = exit.value;
    selected = response;
    writeText = stringifyValue(response.value);
    log("info", `Read ${node.nodeId}`);
  }

  async function toggleNode(node: TreeNode) {
    node.expanded = !node.expanded;
    if (node.expanded && !node.loaded) {
      await loadChildren(node);
    }
  }

  async function loadChildren(node: TreeNode) {
    if (!handle || !connected || node.loading) return;
    node.loading = true;
    const exit = await run(handle.client.Browse({ nodeId: node.nodeId }));
    if (Exit.isFailure(exit)) {
      log("error", messageOf(exit.cause));
    } else {
      const response = exit.value;
      node.children = response.references.map(nodeFromReference);
      node.loaded = true;
      log("info", `Browse ${node.nodeId}: ${response.references.length}`);
    }
    node.loading = false;
  }

  async function writeSelected() {
    if (!handle || !selected) return;
    const exit = await run(
      handle.client.WriteNode({
        nodeId: selected.nodeId,
        value: parseJsonValue(writeText),
      }),
    );
    if (Exit.isFailure(exit)) {
      log("error", messageOf(exit.cause));
      return;
    }
    const response = exit.value;
    selected = response.refreshed;
    writeText = stringifyValue(response.refreshed.value);
    log(
      response.write._tag === "Written" ? "info" : "error",
      response.write._tag === "Failed"
        ? response.write.message
        : `${response.write._tag} ${response.nodeId}: ${response.write.status.text}`,
    );
  }

  function addMonitorNode(nodeId = selected?.nodeId) {
    if (!nodeId || monitorRows.some((row) => row.nodeId === nodeId)) return;
    monitorRows = [
      ...monitorRows,
      {
        nodeId,
        label: selected?.metadata.displayName ?? selected?.metadata.browseName ?? nodeId,
        samples: [],
      },
    ];
  }

  function removeMonitorNode(nodeId: string) {
    monitorRows = monitorRows.filter((row) => row.nodeId !== nodeId);
    if (monitorRows.length === 0) stopMonitoring();
  }

  function startMonitoring() {
    if (!handle || monitorRows.length === 0) return;
    stopMonitoring();
    const nodeIds = monitorRows.map((row) => row.nodeId);
    monitorFiber = runStream(
      handle.client.MonitorValues({ nodeIds, samplingIntervalMs }),
      (sample) => {
        const index = monitorRows.findIndex((row) => row.nodeId === sample.nodeId);
        if (index === -1) return;
        const next = [...monitorRows];
        const row = next[index];
        next[index] = {
          ...row,
          samples: [...row.samples.slice(-29), sample],
        };
        monitorRows = next;
      },
      (error) => {
        monitorFiber = undefined;
        log("error", messageOf(error));
      },
    );
    log("info", `Monitoring ${nodeIds.length} node(s)`);
  }

  function stopMonitoring() {
    if (!monitorFiber) return;
    interrupt(monitorFiber);
    monitorFiber = undefined;
    log("info", "Monitoring stopped");
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
    if (
      authMode === "UserPassword" &&
      savePassword &&
      password.length > 0
    ) {
      attempt.password = await encryptPassword(password);
    }
    if (savePassword) attempt.password ??= previous?.password;
    connectionAttempts = [attempt, ...connectionAttempts];
    persistConnectionAttempts(connectionAttempts);
  }

  function toggleRecentConnections() {
    if (connected || connecting || recentConnections.length === 0) return;
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
    if (attempt.password) {
      password = await decryptPassword(attempt.password);
    }
  }

  function recentConnectionOptions(attempts: RecentConnectionAttempt[]) {
    const seen = new Set<string>();
    const options: RecentConnectionAttempt[] = [];
    for (const attempt of attempts) {
      const key = connectionKey(attempt);
      if (seen.has(key)) continue;
      seen.add(key);
      options.push(attempt);
      if (options.length >= RECENT_CONNECTION_OPTIONS) break;
    }
    return options;
  }

  function connectionKey(attempt: RecentConnectionAttempt) {
    return [
      attempt.endpointUrl,
      attempt.startNodeId,
      attempt.authMode,
      attempt.authMode === "UserPassword" ? attempt.username : "",
    ].join("\u0000");
  }

  function connectionLabel(attempt: RecentConnectionAttempt) {
    const auth =
      attempt.authMode === "UserPassword" && attempt.username
        ? ` as ${attempt.username}`
        : "";
    return `${attempt.endpointUrl} (${attempt.startNodeId})${auth}`;
  }

  function connectionDetails(attempt: RecentConnectionAttempt) {
    const auth =
      attempt.authMode === "UserPassword"
        ? `User: ${attempt.username || "UserPassword"}`
        : "Anonymous";
    return [
      attempt.startNodeId,
      auth,
      attempt.password ? "password saved" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  async function encryptPassword(value: string) {
    try {
      const key = await passwordKey();
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        new TextEncoder().encode(value),
      );
      return {
        keyId: PASSWORD_KEY_ID,
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(new Uint8Array(encrypted)),
      } satisfies EncryptedPassword;
    } catch (error) {
      log("error", `Could not save password: ${messageOf(error)}`);
      return undefined;
    }
  }

  async function decryptPassword(value: EncryptedPassword) {
    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToBytes(value.iv),
        },
        await passwordKey(),
        base64ToBytes(value.ciphertext),
      );
      return new TextDecoder().decode(decrypted);
    } catch (error) {
      log("error", `Could not load saved password: ${messageOf(error)}`);
      return "";
    }
  }

  async function passwordKey() {
    const existing = await readPasswordKey();
    if (existing) return existing;
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await writePasswordKey(key);
    return key;
  }

  async function readPasswordKey() {
    return withPasswordKeyStore("readonly", (store) =>
      store.get(PASSWORD_KEY_ID),
    );
  }

  async function writePasswordKey(key: CryptoKey) {
    await withPasswordKeyStore("readwrite", (store) =>
      store.put(key, PASSWORD_KEY_ID),
    );
  }

  async function withPasswordKeyStore<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ) {
    const database = await openPasswordDatabase();
    return new Promise<T | undefined>((resolve, reject) => {
      const transaction = database.transaction(PASSWORD_KEY_STORE, mode);
      const request = action(transaction.objectStore(PASSWORD_KEY_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function openPasswordDatabase() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(PASSWORD_KEY_DB, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(PASSWORD_KEY_STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function isPasswordStorageAvailable() {
    return (
      typeof window !== "undefined" &&
      window.crypto?.subtle !== undefined &&
      typeof indexedDB !== "undefined"
    );
  }

  function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  function base64ToBytes(text: string) {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  }

  function loadConnectionAttempts() {
    const storage = connectionStorage();
    if (!storage) return [];
    try {
      const text = storage.getItem(RECENT_CONNECTIONS_STORAGE_KEY);
      const parsed = text ? (JSON.parse(text) as unknown) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isConnectionAttempt);
    } catch {
      return [];
    }
  }

  function persistConnectionAttempts(attempts: RecentConnectionAttempt[]) {
    const storage = connectionStorage();
    if (!storage) return;
    try {
      storage.setItem(RECENT_CONNECTIONS_STORAGE_KEY, JSON.stringify(attempts));
    } catch (error) {
      log("error", `Could not save recent connection: ${messageOf(error)}`);
    }
  }

  function isConnectionAttempt(value: unknown): value is RecentConnectionAttempt {
    if (!value || typeof value !== "object") return false;
    const attempt = value as RecentConnectionAttempt;
    return (
      typeof attempt.endpointUrl === "string" &&
      typeof attempt.startNodeId === "string" &&
      (attempt.authMode === "Anonymous" ||
        attempt.authMode === "UserPassword") &&
      typeof attempt.username === "string" &&
      (attempt.password === undefined || isEncryptedPassword(attempt.password)) &&
      typeof attempt.attemptedAt === "string"
    );
  }

  function isEncryptedPassword(value: unknown): value is EncryptedPassword {
    if (!value || typeof value !== "object") return false;
    const password = value as EncryptedPassword;
    return (
      password.keyId === PASSWORD_KEY_ID &&
      typeof password.iv === "string" &&
      typeof password.ciphertext === "string"
    );
  }

  function connectionStorage() {
    try {
      return typeof window === "undefined" ? undefined : window.localStorage;
    } catch {
      return undefined;
    }
  }

  function nodeFromRead(response: ReadNodeResponse): TreeNode {
    return {
      nodeId: response.nodeId,
      label:
        response.metadata.displayName ??
        response.metadata.browseName ??
        response.nodeId,
      nodeClass: response.metadata.nodeClass,
      metadata: response.metadata,
      expanded: true,
      loading: false,
      loaded: false,
      children: [],
    };
  }

  function nodeFromReference(reference: BrowseReference): TreeNode {
    return {
      nodeId: reference.nodeId,
      label:
        reference.metadata?.displayName ??
        reference.displayName ??
        reference.metadata?.browseName ??
        reference.browseName ??
        reference.nodeId,
      nodeClass: reference.metadata?.nodeClass ?? reference.nodeClass,
      metadata: reference.metadata,
      expanded: false,
      loading: false,
      loaded: false,
      children: [],
    };
  }

  function stringifyValue(value: ReadValue | undefined) {
    return value?._tag === "Value"
      ? JSON.stringify(value.value, null, 2)
      : "";
  }

  function displayValue(value: ReadValue | undefined) {
    if (!value) return "";
    if (value._tag === "Value") return readableJson(value.value);
    if (value._tag === "DecodeError") return readableJson(value.error);
    return value.status.text;
  }

  function compactValue(value: ReadValue | undefined) {
    if (!value) return "";
    if (value._tag === "Value") return compactJson(value.value);
    if (value._tag === "DecodeError") return compactJson(value.error);
    return value.status.text;
  }

  function readableJson(value: unknown) {
    return JSON.stringify(valueForDisplay(value), null, 2);
  }

  function compactJson(value: unknown) {
    const text = JSON.stringify(valueForDisplay(value));
    return text.length > 90 ? `${text.slice(0, 87)}...` : text;
  }

  function valueForDisplay(value: unknown) {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) return value;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return value;
    }
  }

  function log(level: LogRow["level"], message: string) {
    logs = [
      {
        id: Date.now() + Math.random(),
        time: new Date().toLocaleTimeString(),
        level,
        message,
      },
      ...logs,
    ].slice(0, 80);
  }

  function messageOf(error: unknown) {
    const message = errorMessage(error);
    return message.length > 0 && message !== "{}" ? message : "Unknown error";
  }

  function sparkline(samples: MonitorSample[]) {
    const values = samples
      .map((sample) =>
        sample.sample._tag === "Value" && typeof sample.sample.value === "number"
          ? sample.sample.value
          : undefined,
      )
      .filter((value): value is number => value !== undefined);
    if (values.length < 2) return "";
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((value, index) => {
        const x = (index / (values.length - 1)) * 100;
        const y = 28 - ((value - min) / span) * 24;
        return `${x},${y}`;
      })
      .join(" ");
  }

  function accessText(access: AccessBits | undefined) {
    if (!access) return "";
    if (access.readable && access.writable) return "read/write";
    if (access.readable) return "read";
    if (access.writable) return "write";
    return "none";
  }
</script>

<svelte:head>
  <title>Effect OPC UA Web</title>
</svelte:head>

<div class="min-h-screen bg-neutral-950 text-stone-200">
  <header class="border-b border-neutral-800 bg-neutral-950">
    <form class="flex flex-wrap items-end gap-3 px-4 py-3" onsubmit={(event) => event.preventDefault()}>
      <div class="grid min-w-72 flex-1 gap-1 text-sm text-stone-400">
        <label for="endpoint-url">Endpoint</label>
        <div class="relative" data-recent-connection-picker>
          <input
            id="endpoint-url"
            class="h-9 w-full border border-neutral-700 bg-neutral-900 px-2 pr-10 text-sm text-stone-100 outline-none focus:border-emerald-500"
            bind:value={endpointUrl}
            oninput={() => (recentConnectionsOpen = false)}
            disabled={connected || connecting}
          />
          <button
            class="absolute top-0 right-0 grid h-9 w-9 place-items-center border-l border-neutral-700 text-stone-400 hover:bg-neutral-800 hover:text-stone-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-400"
            type="button"
            onclick={toggleRecentConnections}
            disabled={connected || connecting || recentConnections.length === 0}
            aria-label="Recent connections"
            aria-expanded={recentConnectionsOpen}
            title="Recent connections"
          >
            <ChevronDown size={15} />
          </button>
          {#if recentConnectionsOpen}
            <div class="absolute top-[calc(100%+4px)] right-0 left-0 z-30 max-h-72 overflow-auto border border-neutral-700 bg-neutral-950 shadow-lg shadow-black/25">
              {#each recentConnections as attempt (connectionKey(attempt))}
                <button
                  class="grid w-full gap-0.5 border-b border-neutral-800 px-3 py-2 text-left last:border-b-0 hover:bg-neutral-900"
                  type="button"
                  onclick={() => selectRecentConnection(attempt)}
                  title={connectionLabel(attempt)}
                >
                  <span class="truncate text-sm text-stone-100">{attempt.endpointUrl}</span>
                  <span class="truncate text-xs text-stone-500">{connectionDetails(attempt)}</span>
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
          disabled={connected || connecting}
        />
      </label>
      <label class="grid w-40 gap-1 text-sm text-stone-400">
        Auth
        <select
          class="h-9 border border-neutral-700 bg-neutral-900 px-2 text-sm text-stone-100 outline-none focus:border-emerald-500"
          bind:value={authMode}
          disabled={connected || connecting}
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
            disabled={connected || connecting}
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
                disabled={connected || connecting || !passwordStorageAvailable}
              />
              Save
            </span>
          </span>
          <input
            class="h-9 border border-neutral-700 bg-neutral-900 px-2 text-sm text-stone-100 outline-none focus:border-emerald-500"
            type="password"
            autocomplete="current-password"
            bind:value={password}
            disabled={connected || connecting}
          />
        </label>
      {/if}
      {#if connected}
        <button
          class="flex h-9 items-center gap-2 border border-neutral-700 bg-neutral-900 px-3 text-sm text-stone-100 hover:bg-neutral-800 disabled:opacity-50"
          type="button"
          onclick={disconnect}
          disabled={connecting}
          title="Disconnect"
        >
          <Unplug size={16} />
          Disconnect
        </button>
      {:else if connecting}
        <button
          class="flex h-9 items-center gap-2 border border-red-800 bg-red-950 px-3 text-sm text-red-100 hover:bg-red-900 disabled:opacity-50"
          type="button"
          onclick={abortConnect}
          disabled={abortingConnect}
          title="Abort connection"
        >
          <Square size={13} />
          {abortingConnect ? "Aborting" : "Abort"}
        </button>
      {:else}
        <button
          class="flex h-9 items-center gap-2 border border-emerald-700 bg-emerald-700 px-3 text-sm text-white hover:bg-emerald-600 disabled:opacity-50"
          type="button"
          onclick={connect}
          disabled={!handle || connecting}
          title="Connect"
        >
          <PlugZap size={16} />
          Connect
        </button>
      {/if}
      <div class="ml-auto flex h-9 items-center gap-2 text-sm text-stone-400">
        <Circle size={10} class={statusClass} />
        {statusText}
      </div>
    </form>
  </header>

  <main class="grid min-h-[calc(100vh-8rem)] grid-cols-1 overflow-auto lg:h-[calc(100vh-65px)] lg:min-h-0 lg:grid-cols-[300px_minmax(420px,1fr)] lg:grid-rows-[minmax(0,1fr)_minmax(0,280px)_220px] lg:overflow-hidden xl:grid-cols-[320px_minmax(420px,1fr)_380px] xl:grid-rows-[minmax(0,1fr)_240px]">
    <aside class="min-h-80 border-b border-neutral-800 bg-neutral-950 lg:col-start-1 lg:row-start-1 lg:row-end-4 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-r lg:border-b-0 xl:row-end-3">
      <div class="flex h-10 shrink-0 items-center justify-between border-b border-neutral-800 px-3">
        <div class="text-sm font-medium text-stone-200">Address Space</div>
        <button
          class="grid h-7 w-7 place-items-center border border-neutral-800 bg-neutral-900 text-stone-300 hover:bg-neutral-800 disabled:opacity-50"
          type="button"
          onclick={() => tree[0] && loadChildren(tree[0])}
          disabled={!connected || !tree[0]?.nodeId}
          title="Refresh root"
        >
          <RefreshCw size={15} />
        </button>
      </div>
      <div class="p-2 lg:min-h-0 lg:flex-1 lg:overflow-auto">
        {#if tree.length === 0}
          <div class="px-2 py-6 text-sm text-stone-500">No session</div>
        {:else}
          {#each tree as node (node.nodeId)}
            {@render treeRow(node, 0)}
          {/each}
        {/if}
      </div>
    </aside>

    <section class="min-h-[420px] min-w-0 overflow-auto border-b border-neutral-800 lg:col-start-2 lg:row-start-1 lg:min-h-0 xl:col-start-2 xl:row-start-1 xl:border-r">
      <div class="flex h-10 items-center justify-between border-b border-neutral-800 px-4">
        <div class="min-w-0 truncate text-sm font-medium text-stone-200">
          {selected?.metadata.displayName ?? selected?.metadata.browseName ?? selectedNodeId}
        </div>
        <div class="flex items-center gap-2">
          <button
            class="grid h-7 w-7 place-items-center border border-neutral-800 bg-neutral-900 text-stone-300 hover:bg-neutral-800 disabled:opacity-50"
            type="button"
            onclick={() => selected && selectNode(nodeFromRead(selected))}
            disabled={!selected}
            title="Read selected"
          >
            <Eye size={15} />
          </button>
          <button
            class="grid h-7 w-7 place-items-center border border-neutral-800 bg-neutral-900 text-stone-300 hover:bg-neutral-800 disabled:opacity-50"
            type="button"
            onclick={() => addMonitorNode()}
            disabled={!selected}
            title="Monitor selected"
          >
            <Link size={15} />
          </button>
        </div>
      </div>

      {#if selected}
        <div class="grid gap-4 p-4">
          <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {@render field("NodeId", selected.metadata.nodeId)}
            {@render field("Node class", selected.metadata.nodeClass)}
            {@render field("Browse name", selected.metadata.browseName)}
            {@render field("Display name", selected.metadata.displayName)}
            {@render field("Description", selected.metadata.description)}
            {@render field("Data type", selected.metadata.dataType)}
            {@render field("Value rank", selected.metadata.valueRank)}
            {@render field("Array dimensions", selected.metadata.arrayDimensions?.join(" x "))}
            {@render field("Access", accessText(selected.metadata.accessLevel))}
            {@render field("User access", accessText(selected.metadata.userAccessLevel))}
            {@render field("Namespace index", selected.metadata.namespaceIndex)}
            {@render field("Namespace URI", selected.metadata.namespaceUri)}
          </div>

          <div class="border border-neutral-800">
            <div class="flex h-9 items-center justify-between border-b border-neutral-800 px-3">
              <div class="text-sm font-medium text-stone-200">Value</div>
              <div class="text-xs text-stone-500">{latestValue?.status.text ?? selected.valueError?.message ?? "Not readable"}</div>
            </div>
            <pre class="max-h-48 overflow-auto bg-neutral-900 p-3 text-xs leading-5 text-stone-200">{displayValue(latestValue) || selected.valueError?.message || ""}</pre>
          </div>

          {#if canWrite}
            <div class="grid gap-2 border border-neutral-800 p-3">
              <div class="text-sm font-medium text-stone-200">Write</div>
              <textarea
                class="min-h-28 resize-y border border-neutral-700 bg-neutral-900 p-2 font-mono text-xs text-stone-100 outline-none focus:border-emerald-500"
                bind:value={writeText}
              ></textarea>
              <div class="flex justify-end">
                <button
                  class="flex h-8 items-center gap-2 border border-neutral-700 bg-neutral-900 px-3 text-sm text-stone-100 hover:bg-neutral-800"
                  type="button"
                  onclick={writeSelected}
                  title="Write value"
                >
                  <Send size={15} />
                  Write
                </button>
              </div>
            </div>
          {/if}

          {#if selected.dataTypeDefinition}
            <div class="border border-neutral-800">
              <div class="h-9 border-b border-neutral-800 px-3 py-2 text-sm font-medium text-stone-200">
                Data Type Definition
              </div>
              <div class="max-h-64 overflow-auto p-3 text-sm">
                {@render dataTypeDefinition(selected.dataTypeDefinition)}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="p-8 text-sm text-stone-500">Select a node</div>
      {/if}
    </section>

    <aside class="min-h-80 overflow-auto border-b border-neutral-800 bg-neutral-950 lg:col-start-2 lg:row-start-2 lg:min-h-0 xl:col-start-3 xl:row-start-1">
      <div class="flex h-10 items-center justify-between border-b border-neutral-800 px-3">
        <div class="text-sm font-medium text-stone-200">Monitored Variables</div>
        <div class="flex items-center gap-2">
          <input
            class="h-7 w-20 border border-neutral-800 bg-neutral-900 px-2 text-xs text-stone-100 outline-none focus:border-emerald-500"
            type="number"
            min="50"
            bind:value={samplingIntervalMs}
            title="Sampling interval"
          />
          {#if isMonitoring}
            <button class="grid h-7 w-7 place-items-center border border-neutral-800 bg-neutral-900 text-stone-300 hover:bg-neutral-800" type="button" onclick={stopMonitoring} title="Stop monitoring">
              <Pause size={15} />
            </button>
          {:else}
            <button class="grid h-7 w-7 place-items-center border border-neutral-800 bg-neutral-900 text-stone-300 hover:bg-neutral-800 disabled:opacity-50" type="button" onclick={startMonitoring} disabled={monitorRows.length === 0} title="Start monitoring">
              <Play size={15} />
            </button>
          {/if}
        </div>
      </div>
      <div class="divide-y divide-neutral-800">
        {#each monitorRows as row (row.nodeId)}
          <div class="grid gap-2 p-3">
            <div class="flex items-center justify-between gap-2">
              <div class="min-w-0">
                <div class="truncate text-sm text-stone-200">{row.label}</div>
                <div class="truncate text-xs text-stone-500">{row.nodeId}</div>
              </div>
              <button class="grid h-7 w-7 shrink-0 place-items-center border border-neutral-800 bg-neutral-900 text-stone-400 hover:bg-neutral-800" type="button" onclick={() => removeMonitorNode(row.nodeId)} title="Remove">
                <Square size={13} />
              </button>
            </div>
            <div class="flex items-center gap-3">
              <svg class="h-8 flex-1 border border-neutral-800 bg-neutral-900" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
                <polyline points={sparkline(row.samples)} fill="none" stroke="#10b981" stroke-width="2" vector-effect="non-scaling-stroke" />
              </svg>
              <div class="w-28 truncate text-right font-mono text-xs text-stone-300">{compactValue(row.samples.at(-1)?.sample)}</div>
            </div>
          </div>
        {:else}
          <div class="px-3 py-6 text-sm text-stone-500">No monitored nodes</div>
        {/each}
      </div>
    </aside>

    <section class="min-h-52 border-t border-neutral-800 bg-neutral-950 lg:col-start-2 lg:row-start-3 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden xl:col-start-2 xl:col-end-4 xl:row-start-2">
      <div class="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-800 px-3">
        <Terminal size={15} class="text-stone-400" />
        <div class="text-sm font-medium text-stone-200">Operation Log</div>
      </div>
      <div class="h-[200px] overflow-auto lg:h-auto lg:flex-1">
        {#each logs as row (row.id)}
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
  </main>
</div>

{#snippet treeRow(node: TreeNode, depth: number)}
  <div>
    <div
      class={[
        "flex h-8 items-center gap-1 border border-transparent px-1 text-sm hover:border-neutral-800 hover:bg-neutral-900",
        selectedNodeId === node.nodeId && "border-neutral-700 bg-neutral-900 text-white",
      ]}
      style:padding-left={`${depth * 14 + 4}px`}
    >
      <button
        class="grid h-6 w-6 shrink-0 place-items-center text-stone-400 hover:text-stone-100"
        type="button"
        onclick={() => toggleNode(node)}
        title={node.expanded ? "Collapse" : "Expand"}
      >
        {#if node.loading}
          <RefreshCw size={14} class="animate-spin" />
        {:else if node.expanded}
          <ChevronDown size={15} />
        {:else}
          <ChevronRight size={15} />
        {/if}
      </button>
      <button class="min-w-0 flex-1 truncate text-left" type="button" onclick={() => selectNode(node)} title={node.nodeId}>
        <span class="text-stone-200">{node.label}</span>
        <span class="ml-2 text-xs text-stone-500">{node.nodeClass ?? ""}</span>
      </button>
    </div>
    {#if node.expanded}
      {#each node.children as child (child.nodeId)}
        {@render treeRow(child, depth + 1)}
      {/each}
    {/if}
  </div>
{/snippet}

{#snippet field(label: string, value: unknown)}
  <div class="text-stone-500">{label}</div>
  <div class="min-w-0 truncate font-mono text-stone-200">{value ?? ""}</div>
{/snippet}

{#snippet dataTypeDefinition(definition: DataTypeDefinitionResult)}
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
{/snippet}
