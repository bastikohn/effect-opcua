import {
  Opcua,
  OpcuaClient,
  OpcuaSession,
  type MonitorSample,
  type NodeIdString,
  type OpcuaDynamicValue,
  type OpcuaBrowseReference,
  type ReadResult,
  type WriteResult,
} from "@effect-opcua/client";
import {
  Cause,
  Duration,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Stream,
} from "effect";

export type TreeEntryId = string;

export type TuiTreeEntry = {
  readonly entryId: TreeEntryId;
  readonly nodeId: NodeIdString;
  readonly parentEntryId?: TreeEntryId;
  readonly pathNodeIds: ReadonlyArray<string>;
  readonly referenceTypeId?: string;
  readonly label: string;
  readonly nodeClass?: string;
  readonly reference?: OpcuaBrowseReference;
  readonly expanded: boolean;
  readonly loading: boolean;
  readonly repeated: boolean;
};

export type SelectedNodeState = {
  readonly entry?: TuiTreeEntry;
  readonly sample?: ReadResult<unknown>;
  readonly error?: string;
};

export type TuiEvent = {
  readonly time: string;
  readonly message: string;
};

export type TuiState = {
  readonly connection: string;
  readonly tree: {
    readonly entries: ReadonlyArray<TuiTreeEntry>;
    readonly selectedEntryId?: TreeEntryId;
  };
  readonly selectedNode?: SelectedNodeState;
  readonly monitors: {
    readonly desired: ReadonlySet<NodeIdString>;
    readonly latest: ReadonlyMap<
      NodeIdString,
      ReadResult<unknown> | MonitorSample
    >;
  };
  readonly eventLog: ReadonlyArray<TuiEvent>;
  readonly writesEnabled: boolean;
};

export type TuiRuntime = {
  readonly subscribe: (listener: (state: TuiState) => void) => () => void;
  readonly getState: () => TuiState;
  readonly expandNode: (entryId: TreeEntryId) => Promise<void>;
  readonly collapseNode: (entryId: TreeEntryId) => Promise<void>;
  readonly selectNode: (entryId: TreeEntryId) => Promise<void>;
  readonly refreshNode: (entryId: TreeEntryId) => Promise<void>;
  readonly writeSelected: (value: unknown) => Promise<WriteResult>;
  readonly monitorSelected: () => Promise<void>;
  readonly unmonitorSelected: () => Promise<void>;
  readonly reportError: (message: string) => void;
  readonly dispose: () => Promise<void>;
};

export type TuiRuntimeOptions = {
  readonly endpointUrl: string;
  readonly startNode: string;
  readonly user?: string;
  readonly password?: string;
  readonly enableWrites: boolean;
};

export const createTuiRuntime = async (
  options: TuiRuntimeOptions,
): Promise<TuiRuntime> => {
  const userIdentity =
    options.user && options.password
      ? {
          type: 1 as const,
          userName: options.user,
          password: options.password,
        }
      : undefined;
  const layer = OpcuaSession.layer({ userIdentity }).pipe(
    Layer.provideMerge(
      OpcuaClient.layer({
        endpointUrl: options.endpointUrl,
        clientOptions: { endpointMustExist: false },
      }),
    ),
  );
  const runtime = ManagedRuntime.make(layer, {
    memoMap: Layer.makeMemoMapUnsafe(),
  });
  const listeners = new Set<(state: TuiState) => void>();
  let monitorFiber: Fiber.Fiber<void, unknown> | undefined;
  let state: TuiState = {
    connection: "Connecting",
    tree: { entries: [], selectedEntryId: undefined },
    selectedNode: undefined,
    monitors: { desired: new Set(), latest: new Map() },
    eventLog: [],
    writesEnabled: options.enableWrites,
  };

  const setState = (update: (current: TuiState) => TuiState) => {
    state = update(state);
    for (const listener of listeners) listener(state);
  };
  const log = (message: string) =>
    setState((current) => ({
      ...current,
      eventLog: [
        ...current.eventLog.slice(-199),
        { time: new Date().toLocaleTimeString(), message },
      ],
    }));

  const run = runtime.runPromise;

  const root: TuiTreeEntry = {
    entryId: "root",
    nodeId: options.startNode,
    pathNodeIds: [options.startNode],
    label: options.startNode,
    expanded: false,
    loading: false,
    repeated: false,
  };
  setState((current) => ({
    ...current,
    connection: "Connected",
    tree: { entries: [root], selectedEntryId: root.entryId },
    selectedNode: { entry: root },
  }));
  log(`Connected to ${options.endpointUrl}`);

  const loadChildren = async (entryId: TreeEntryId, refresh: boolean) => {
    const entry = state.tree.entries.find(
      (candidate) => candidate.entryId === entryId,
    );
    if (!entry) return;
    const existingPrefix = `${entry.entryId}/`;
    const hasChildren = state.tree.entries.some((candidate) =>
      candidate.entryId.startsWith(existingPrefix),
    );
    if (hasChildren && !refresh) {
      setExpanded(entryId, true);
      return;
    }
    setState((current) => ({
      ...current,
      tree: {
        ...current.tree,
        entries: refresh
          ? current.tree.entries.filter(
              (candidate) => !candidate.entryId.startsWith(existingPrefix),
            )
          : current.tree.entries,
      },
    }));
    const result = await run(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.browseChildren(entry.nodeId);
      }),
    );
    if (result._tag === "NonGoodStatus") {
      log(`Browse ${entry.label} ${result.status.text}`);
      return;
    }
    const children = result.references.map((reference, index): TuiTreeEntry => {
      const nodeId = reference.nodeId.text;
      const pathNodeIds = [...entry.pathNodeIds, nodeId];
      return {
        entryId: `${entry.entryId}/${index}:${nodeId}`,
        nodeId,
        parentEntryId: entry.entryId,
        pathNodeIds,
        referenceTypeId: reference.referenceTypeId,
        label:
          reference.displayName?.text || reference.browseName?.name || nodeId,
        nodeClass: reference.nodeClass,
        reference,
        expanded: false,
        loading: false,
        repeated: entry.pathNodeIds.includes(nodeId),
      };
    });
    setState((current) => {
      const index = current.tree.entries.findIndex(
        (candidate) => candidate.entryId === entry.entryId,
      );
      const withoutOld = current.tree.entries.filter(
        (candidate) => !candidate.entryId.startsWith(existingPrefix),
      );
      return {
        ...current,
        tree: {
          ...current.tree,
          entries: [
            ...withoutOld.slice(0, index + 1),
            ...children,
            ...withoutOld.slice(index + 1),
          ].map((candidate) =>
            candidate.entryId === entry.entryId
              ? { ...candidate, expanded: true }
              : candidate,
          ),
        },
      };
    });
    log(`Browsed ${children.length} children for ${entry.label}`);
  };

  const setExpanded = (entryId: TreeEntryId, expanded: boolean) =>
    setState((current) => ({
      ...current,
      tree: {
        ...current.tree,
        entries: current.tree.entries.map((entry) =>
          entry.entryId === entryId ? { ...entry, expanded } : entry,
        ),
      },
    }));

  const collapseNode = async (entryId: TreeEntryId) => {
    const descendantPrefix = `${entryId}/`;
    setState((current) => {
      const selectedEntryId = current.tree.selectedEntryId?.startsWith(
        descendantPrefix,
      )
        ? entryId
        : current.tree.selectedEntryId;
      const selectedEntry =
        selectedEntryId === current.tree.selectedEntryId
          ? current.selectedNode?.entry
          : current.tree.entries.find((entry) => entry.entryId === entryId);
      return {
        ...current,
        tree: {
          ...current.tree,
          selectedEntryId,
          entries: current.tree.entries
            .filter((entry) => !entry.entryId.startsWith(descendantPrefix))
            .map((entry) =>
              entry.entryId === entryId ? { ...entry, expanded: false } : entry,
            ),
        },
        selectedNode:
          selectedEntryId === current.tree.selectedEntryId
            ? current.selectedNode
            : { entry: selectedEntry },
      };
    });
  };

  const selectNode = async (entryId: TreeEntryId) => {
    const entry = state.tree.entries.find(
      (candidate) => candidate.entryId === entryId,
    );
    if (!entry) return;
    setState((current) => ({
      ...current,
      tree: { ...current.tree, selectedEntryId: entryId },
      selectedNode: { entry },
    }));
    if (entry.nodeClass !== "Variable") return;
    try {
      const sample = await run(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.read(Opcua.variable({ nodeId: entry.nodeId }));
        }),
      );
      setState((current) => ({ ...current, selectedNode: { entry, sample } }));
    } catch (error) {
      setState((current) => ({
        ...current,
        selectedNode: { entry, error: String(error) },
      }));
    }
  };

  const restartMonitor = async () => {
    const current = monitorFiber;
    if (current) {
      monitorFiber = undefined;
      await Effect.runPromise(Fiber.interrupt(current));
    }
    const nodeIds = Array.from(state.monitors.desired);
    if (nodeIds.length === 0) return;
    const items = Object.fromEntries(
      nodeIds.map((nodeId, index) => [
        `item${index}`,
        Opcua.variable({ nodeId }),
      ]),
    );
    monitorFiber = runtime.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          const subscription = yield* session.makeSubscription({
            publishingInterval: Duration.millis(250),
          });
          const monitor = yield* subscription.monitor(items, {
            startup: "bestEffort",
            validation: "none",
            samplingInterval: Duration.millis(250),
            queueSize: 5,
            discardOldest: true,
            clientBuffer: Opcua.BufferPolicy.latest(),
            filter: Opcua.MonitorFilter.statusValue(),
            timestamps: "both",
          });
          if (monitor.startup.failedCount > 0) {
            yield* Effect.sync(() => {
              for (const failure of monitor.startup.failed.values()) {
                log(`Monitor ${failure.nodeId} failed: ${failure.error._tag}`);
              }
            });
          }
          yield* monitor.samples.pipe(
            Stream.runForEach((sample) =>
              Effect.sync(() => {
                setState((current) => {
                  if (!current.monitors.desired.has(sample.nodeId)) {
                    return current;
                  }
                  const latest = new Map(current.monitors.latest);
                  latest.set(sample.nodeId, sample);
                  return {
                    ...current,
                    monitors: { ...current.monitors, latest },
                  };
                });
              }),
            ),
          );
        }),
      ).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.void
            : Effect.sync(() => {
                monitorFiber = undefined;
                log(`Monitor set failed: ${Cause.pretty(cause)}`);
              }),
        ),
      ),
    );
  };

  const monitorSelected = async () => {
    const entry = state.selectedNode?.entry;
    if (!entry || entry.nodeClass !== "Variable") return;
    if (state.monitors.desired.has(entry.nodeId)) return;
    setState((current) => {
      const desired = new Set(current.monitors.desired);
      desired.add(entry.nodeId);
      return { ...current, monitors: { ...current.monitors, desired } };
    });
    await restartMonitor();
    log(`Monitoring ${entry.label}`);
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    expandNode: (entryId) => loadChildren(entryId, false),
    collapseNode,
    selectNode,
    refreshNode: (entryId) => loadChildren(entryId, true),
    writeSelected: async (value) => {
      const entry = state.selectedNode?.entry;
      if (!entry || entry.nodeClass !== "Variable") {
        throw new Error("No writable variable selected");
      }
      if (!state.writesEnabled) {
        throw new Error("Writes disabled; restart with --enable-writes");
      }
      const { result, sample } = await run(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          const def = Opcua.variable({
            nodeId: entry.nodeId,
            access: "readWrite",
          });
          const result = yield* session.write(def, value as OpcuaDynamicValue);
          const sample = yield* session.read(def);
          return { result, sample };
        }),
      );
      log(`${entry.label} write ${result._tag}`);
      setState((current) => {
        const latest = new Map(current.monitors.latest);
        if (current.monitors.desired.has(entry.nodeId)) {
          latest.set(entry.nodeId, sample);
        }
        return {
          ...current,
          selectedNode: { entry, sample },
          monitors: { ...current.monitors, latest },
        };
      });
      return result;
    },
    monitorSelected,
    unmonitorSelected: async () => {
      const entry = state.selectedNode?.entry;
      if (!entry) return;
      setState((current) => {
        const desired = new Set(current.monitors.desired);
        const latest = new Map(current.monitors.latest);
        desired.delete(entry.nodeId);
        latest.delete(entry.nodeId);
        return { ...current, monitors: { desired, latest } };
      });
      await restartMonitor();
      log(`Unmonitored ${entry.label}`);
    },
    reportError: log,
    dispose: async () => {
      const fiber = monitorFiber;
      monitorFiber = undefined;
      if (fiber) await Effect.runPromise(Fiber.interrupt(fiber));
      await runtime.dispose();
    },
  };
};
