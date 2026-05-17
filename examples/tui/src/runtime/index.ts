import {
  Capabilities,
  ClientBufferPolicy,
  MonitorValueFilter,
  OpcuaClient,
  OpcuaSession,
  type NodeIdString,
  type OpcuaBrowseReference,
  type OpcuaDynamicValue,
  type OpcuaValueSample,
  type OpcuaWriteResult,
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
  readonly sample?: OpcuaValueSample<unknown>;
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
    readonly latest: ReadonlyMap<NodeIdString, OpcuaValueSample<unknown>>;
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
  readonly writeSelected: (value: unknown) => Promise<OpcuaWriteResult>;
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
  const monitorFibers = new Map<NodeIdString, Fiber.Fiber<void, unknown>>();
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

  const run = <A, E>(effect: Effect.Effect<A, E, OpcuaSession>) =>
    runtime.runPromise(effect);

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
        const session = yield* OpcuaSession;
        return yield* session.browseChildren(entry.nodeId);
      }),
    );
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
          const session = yield* OpcuaSession;
          const handle = yield* session.valueHandle({ nodeId: entry.nodeId });
          return yield* handle.read();
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

  const monitorSelected = async () => {
    const entry = state.selectedNode?.entry;
    if (!entry || entry.nodeClass !== "Variable") return;
    if (monitorFibers.has(entry.nodeId)) return;
    const fiber = runtime.runFork(
      Effect.scoped(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          const subscription = yield* session.createSubscription({
            publishingInterval: Duration.millis(250),
          });
          yield* subscription
            .monitorValues([{ nodeId: entry.nodeId }], {
              samplingInterval: Duration.millis(250),
              queueSize: 5,
              discardOldest: true,
              clientBuffer: ClientBufferPolicy.latest(),
              filter: MonitorValueFilter.statusValue(),
            })
            .pipe(
              Stream.runForEach((sample) =>
                Effect.sync(() => {
                  setState((current) => {
                    const latest = new Map(current.monitors.latest);
                    latest.set(entry.nodeId, sample);
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
          Effect.sync(() => {
            monitorFibers.delete(entry.nodeId);
            log(`Monitor ${entry.label} failed: ${Cause.pretty(cause)}`);
          }),
        ),
      ),
    );
    monitorFibers.set(entry.nodeId, fiber);
    setState((current) => {
      const desired = new Set(current.monitors.desired);
      desired.add(entry.nodeId);
      return { ...current, monitors: { ...current.monitors, desired } };
    });
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
          const session = yield* OpcuaSession;
          const handle = yield* session.valueHandle({
            nodeId: entry.nodeId,
            capabilities: Capabilities.readWrite,
          });
          const result = yield* handle.write(value as OpcuaDynamicValue);
          const sample = yield* handle.read();
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
      const fiber = monitorFibers.get(entry.nodeId);
      if (fiber) {
        monitorFibers.delete(entry.nodeId);
        await Effect.runPromise(Fiber.interrupt(fiber));
      }
      setState((current) => {
        const desired = new Set(current.monitors.desired);
        const latest = new Map(current.monitors.latest);
        desired.delete(entry.nodeId);
        latest.delete(entry.nodeId);
        return { ...current, monitors: { desired, latest } };
      });
      log(`Unmonitored ${entry.label}`);
    },
    reportError: log,
    dispose: async () => {
      const fibers = Array.from(monitorFibers.values());
      monitorFibers.clear();
      await Effect.runPromise(Fiber.interruptAll(fibers));
      await runtime.dispose();
    },
  };
};
