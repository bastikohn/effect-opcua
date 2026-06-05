import type { OpcuaSession, OpcuaSubscription } from "@effect-opcua/client";
import { Effect, Stream } from "effect";

import type {
  DataTypeDefinitionResult,
  ReadValue,
  WriteStatus,
} from "../../src/shared/rpc.js";
import type { BrowserOpcuaSession } from "../../src/server/session-registry.js";

type OpcuaNodeMetadata = OpcuaSession.OpcuaNodeMetadata;

export const goodStatus = {
  text: "Good",
  code: 0,
  isGood: true,
  isUncertain: false,
  isBad: false,
};

type FakeMonitorSample = {
  readonly _tag: "Value";
  readonly key: string;
  readonly nodeId: string;
  readonly value: unknown;
  readonly status: typeof goodStatus;
};

export const badStatus = {
  text: "BadNotReadable",
  code: 0x803a0000,
  isGood: false,
  isUncertain: false,
  isBad: true,
};

export const variableMetadata = (
  nodeId: string,
  overrides: Partial<OpcuaNodeMetadata> = {},
): OpcuaNodeMetadata => ({
  nodeId,
  nodeClass: "Variable",
  browseName: nodeLabel(nodeId),
  displayName: nodeLabel(nodeId),
  description: "Demo variable",
  dataType: "i=11",
  valueRank: -1,
  accessLevel: { readable: true, writable: true },
  userAccessLevel: { readable: true, writable: true },
  namespaceIndex: nodeId.startsWith("ns=") ? 1 : 0,
  namespaceUri: nodeId.startsWith("ns=") ? "urn:test" : undefined,
  ...overrides,
});

const nodeLabel = (nodeId: string) =>
  (nodeId.split(";").at(-1) ?? nodeId).replace(/^[a-z]=/, "");

export const objectMetadata = (nodeId: string): OpcuaNodeMetadata => ({
  nodeId,
  nodeClass: "Object",
  browseName: "Objects",
  displayName: "Objects",
  namespaceIndex: 0,
});

export type FakeSessionOptions = {
  readonly metadata?: Record<string, OpcuaNodeMetadata>;
  readonly values?: Record<string, ReadValue>;
  readonly definitions?: Record<string, DataTypeDefinitionResult>;
  readonly browseStatus?: typeof goodStatus;
  readonly browsePages?: ReadonlyArray<ReadonlyArray<string>>;
  readonly writeStatus?: WriteStatus;
  readonly writeFailure?: unknown;
  readonly onWrite?: (nodeId: string, value: unknown) => void;
  readonly onReleaseContinuation?: (nodeId: string) => void;
  readonly monitorStream?: Stream.Stream<FakeMonitorSample>;
};

export const makeFakeSession = (
  options: FakeSessionOptions = {},
): BrowserOpcuaSession => {
  const metadata = new Map(Object.entries(options.metadata ?? {}));
  const values = new Map(Object.entries(options.values ?? {}));
  const definitions = new Map(Object.entries(options.definitions ?? {}));
  const defaultBrowseNodeIds = [...metadata.keys()];
  const browsePages = options.browsePages ?? [defaultBrowseNodeIds];
  const pageReferences = (nodeIds: readonly string[]) =>
    nodeIds
      .filter((childNodeId) => childNodeId !== "i=85")
      .map((childNodeId) => ({
        nodeId: {
          text: childNodeId,
          namespace: childNodeId.startsWith("ns=") ? 1 : 0,
          identifierType: "STRING",
          value: childNodeId,
          isLocal: true,
          isRemote: false,
        },
        nodeClass: metadata.get(childNodeId)?.nodeClass,
        browseName: {
          text: metadata.get(childNodeId)?.browseName ?? childNodeId,
          name: metadata.get(childNodeId)?.browseName ?? childNodeId,
          namespaceIndex: metadata.get(childNodeId)?.namespaceIndex ?? 0,
        },
        displayName: {
          text: metadata.get(childNodeId)?.displayName ?? childNodeId,
        },
      }));
  const continuation = (nodeId: string, pageIndex: number) =>
    pageIndex < browsePages.length
      ? { nodeId, unsafeRaw: Buffer.from(String(pageIndex)) }
      : undefined;

  return {
    browseChildren: (nodeId) =>
      options.browseStatus && !options.browseStatus.isGood
        ? Effect.succeed({
            _tag: "NonGoodStatus" as const,
            nodeId,
            status: options.browseStatus,
          })
        : Effect.succeed({
            _tag: "Browsed" as const,
            nodeId,
            status: goodStatus,
            references: pageReferences(browsePages[0] ?? []),
            continuation: continuation(nodeId, 1),
          }),
    browseNext: (input) => {
      const pageIndex = Number(input.unsafeRaw.toString("utf8"));
      return Effect.succeed({
        _tag: "Browsed" as const,
        nodeId: input.nodeId,
        status: goodStatus,
        references: pageReferences(browsePages[pageIndex] ?? []),
        continuation: continuation(input.nodeId, pageIndex + 1),
      });
    },
    releaseBrowseContinuation: (input) =>
      Effect.sync(() => {
        options.onReleaseContinuation?.(input.nodeId);
      }),
    readNodeMetadata: (nodeId) => {
      const entry = metadata.get(nodeId);
      return entry
        ? Effect.succeed(entry)
        : Effect.fail(new Error(`Missing metadata for ${nodeId}`) as never);
    },
    readManyNodeMetadata: (nodeIds) =>
      Effect.succeed(
        nodeIds.map((nodeId) => {
          const entry = metadata.get(nodeId);
          return entry
            ? {
                _tag: "Success" as const,
                nodeId,
                metadata: entry,
              }
            : {
                _tag: "Failure" as const,
                nodeId,
                reason: {
                  _tag: "InvalidValue" as const,
                  attribute: "DisplayName" as const,
                  message: "missing",
                },
              };
        }),
      ),
    readDataTypeDefinition: (dataTypeNodeId) =>
      Effect.succeed(
        definitions.get(dataTypeNodeId) ?? {
          _tag: "Missing",
          dataTypeNodeId,
          reason: "No DataTypeDefinition",
        },
      ),
    read: (def) =>
      Effect.succeed(
        (values.get(def.nodeId) ?? {
          _tag: "Value",
          nodeId: def.nodeId,
          value: null,
          status: goodStatus,
        }) as never,
      ),
    write: (def, value) => {
      if (options.writeFailure !== undefined) {
        return Effect.fail(options.writeFailure as never);
      }
      options.onWrite?.(def.nodeId, value);
      const writeStatus =
        options.writeStatus ??
        ({
          _tag: "Written",
          nodeId: def.nodeId,
          status: goodStatus,
        } satisfies WriteStatus);
      if (writeStatus._tag === "Written") {
        values.set(def.nodeId, {
          _tag: "Value",
          nodeId: def.nodeId,
          value: value as never,
          status: goodStatus,
        });
      }
      return Effect.succeed(writeStatus as never);
    },
    makeSubscription: () =>
      Effect.succeed({
        monitor: (items: Record<string, { readonly nodeId: string }>) =>
          Effect.succeed({
            startup: {
              ok: true,
              requested: Object.keys(items).length,
              activeCount: Object.keys(items).length,
              failedCount: 0,
              active: new Map(
                Object.entries(items).map(([key, item]) => [
                  key,
                  {
                    key,
                    nodeId: item.nodeId,
                    requested: {
                      samplingInterval: 100,
                      queueSize: 5,
                      discardOldest: true,
                      filter: {
                        _tag: "StatusValue" as const,
                        deadband: { _tag: "None" as const },
                      },
                      timestamps: "both" as const,
                    },
                  },
                ]),
              ),
              failed: new Map(),
            },
            samples: options.monitorStream ?? Stream.never,
          }),
        events: Stream.empty,
        unsafeRaw: undefined,
      } as unknown as OpcuaSubscription),
  };
};

export const valueSample = (
  nodeId: string,
  value: unknown,
): FakeMonitorSample => ({
  _tag: "Value",
  key: nodeId,
  nodeId,
  value,
  status: goodStatus,
});
