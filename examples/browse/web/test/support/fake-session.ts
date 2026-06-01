import type { OpcuaSession, OpcuaSubscription } from "@effect-opcua/client";
import { Effect, Stream } from "effect";

import type {
  DataTypeDefinitionResult,
  MonitorSample,
  ReadValue,
  WriteStatus,
} from "../../src/shared/rpc.js";
import type { BrowserOpcuaSession } from "../../src/server/session-registry.js";

export const goodStatus = {
  text: "Good",
  code: 0,
  isGood: true,
  isUncertain: false,
  isBad: false,
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
  overrides: Partial<OpcuaSession.OpcuaNodeMetadata> = {},
): OpcuaSession.OpcuaNodeMetadata => ({
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

export const objectMetadata = (
  nodeId: string,
): OpcuaSession.OpcuaNodeMetadata => ({
  nodeId,
  nodeClass: "Object",
  browseName: "Objects",
  displayName: "Objects",
  namespaceIndex: 0,
});

export type FakeSessionOptions = {
  readonly metadata?: Record<string, OpcuaSession.OpcuaNodeMetadata>;
  readonly values?: Record<string, ReadValue>;
  readonly definitions?: Record<string, DataTypeDefinitionResult>;
  readonly onWrite?: (nodeId: string, value: unknown) => void;
  readonly monitorStream?: Stream.Stream<MonitorSample>;
};

export const makeFakeSession = (
  options: FakeSessionOptions = {},
): BrowserOpcuaSession => {
  const metadata = new Map(Object.entries(options.metadata ?? {}));
  const values = new Map(Object.entries(options.values ?? {}));
  const definitions = new Map(Object.entries(options.definitions ?? {}));

  return {
    browseChildren: (nodeId) =>
      Effect.succeed({
        _tag: "Browsed" as const,
        nodeId,
        status: goodStatus,
        references: [...metadata.keys()]
          .filter((childNodeId) => childNodeId !== nodeId)
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
          })),
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
      options.onWrite?.(def.nodeId, value);
      values.set(def.nodeId, {
        _tag: "Value",
        nodeId: def.nodeId,
        value: value as never,
        status: goodStatus,
      });
      return Effect.succeed({
        _tag: "Written",
        nodeId: def.nodeId,
        status: goodStatus,
      } satisfies WriteStatus as never);
    },
    makeSubscription: () =>
      Effect.succeed({
        monitor: () =>
          Effect.succeed({
            startup: {
              ok: true,
              requested: 1,
              activeCount: 1,
              failedCount: 0,
              active: new Map(),
              failed: new Map(),
            },
            samples: options.monitorStream ?? Stream.never,
          }),
        events: Stream.empty,
        unsafeRaw: undefined,
      } as unknown as OpcuaSubscription.OpcuaSubscription),
  };
};

export const valueSample = (
  nodeId: string,
  value: unknown,
): MonitorSample => ({
  nodeId,
  sample: {
    _tag: "Value",
    nodeId,
    value,
    status: goodStatus,
  },
});
