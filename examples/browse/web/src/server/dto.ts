import {
  Opcua,
  OpcuaSession,
  type OpcuaSubscription,
} from "@effect-opcua/client";
import { Duration, Effect, Stream } from "effect";

import type {
  BrowseReference,
  BrowseResponse,
  MetadataFailure,
  MonitorEvent,
  MonitorRejectedItem,
  MonitorSample,
  NodeMetadata,
  ReadNodeResponse,
  ReadValue,
  StatusInfo,
  WriteNodeResponse,
} from "../shared/rpc.js";
import { WebRpcError } from "../shared/rpc.js";
import { toJsonValue } from "../shared/value.js";
import { rpcError, type BrowserOpcuaSession } from "./session-registry.js";
import type { BrowserBrowseContinuation } from "./session-registry.js";

type OpcuaBrowseReference = OpcuaSession.OpcuaBrowseReference;
type OpcuaMetadataReadFailure = OpcuaSession.OpcuaMetadataReadFailure;
type OpcuaNodeMetadata = OpcuaSession.OpcuaNodeMetadata;
type OpcuaNodeMetadataResult = OpcuaSession.OpcuaNodeMetadataResult;
type MonitorStartupFailure = OpcuaSubscription.MonitorStartupFailure;

export type BrowsePage = {
  readonly response: BrowseResponse;
  readonly continuation?: BrowserBrowseContinuation;
};

type RuntimeMonitorSample =
  | {
      readonly _tag: "Value";
      readonly nodeId: string;
      readonly value: unknown;
      readonly status: StatusInfo;
      readonly sourceTimestamp?: Date;
      readonly serverTimestamp?: Date;
    }
  | {
      readonly _tag: "DecodeError";
      readonly nodeId: string;
      readonly error: unknown;
      readonly status: StatusInfo;
      readonly sourceTimestamp?: Date;
      readonly serverTimestamp?: Date;
    }
  | {
      readonly _tag: "Status";
      readonly nodeId: string;
      readonly status: StatusInfo;
      readonly sourceTimestamp?: Date;
      readonly serverTimestamp?: Date;
    };

export const browseNode = (
  session: BrowserOpcuaSession,
  nodeId: string,
  maxReferencesPerNode: number,
): Effect.Effect<BrowsePage, WebRpcError> =>
  Effect.gen(function* () {
    const result = yield* session
      .browseChildren(nodeId, {
        mode: "page",
        maxReferencesPerNode,
      })
      .pipe(Effect.mapError((cause) => rpcError("Browse", nodeId, cause)));
    if (result._tag === "NonGoodStatus") {
      return {
        response: {
          _tag: "NonGoodStatus",
          nodeId,
          status: result.status,
        },
      };
    }

    const nodeIds = result.references.map((reference) => reference.nodeId.text);
    const metadataResults =
      nodeIds.length === 0
        ? []
        : yield* session
            .readManyNodeMetadata(nodeIds)
            .pipe(
              Effect.mapError((cause) =>
                rpcError("BrowseMetadata", nodeId, cause),
              ),
            );
    const metadataByNodeId = new Map(
      metadataResults.map((entry) => [entry.nodeId, entry]),
    );
    return {
      response: {
        _tag: "Browsed",
        nodeId,
        status: result.status,
        references: result.references.map((reference) =>
          browseReference(
            reference,
            metadataByNodeId.get(reference.nodeId.text),
          ),
        ),
      },
      continuation: result.continuation,
    };
  });

export const browseContinuation = (
  session: BrowserOpcuaSession,
  continuation: BrowserBrowseContinuation,
): Effect.Effect<BrowsePage, WebRpcError> =>
  Effect.gen(function* () {
    const result = yield* session
      .browseNext(continuation)
      .pipe(
        Effect.mapError((cause) =>
          rpcError("BrowseNext", continuation.nodeId, cause),
        ),
      );
    if (result._tag === "NonGoodStatus") {
      return {
        response: {
          _tag: "NonGoodStatus",
          nodeId: continuation.nodeId,
          status: result.status,
        },
      };
    }

    const nodeIds = result.references.map((reference) => reference.nodeId.text);
    const metadataResults =
      nodeIds.length === 0
        ? []
        : yield* session
            .readManyNodeMetadata(nodeIds)
            .pipe(
              Effect.mapError((cause) =>
                rpcError("BrowseMetadata", continuation.nodeId, cause),
              ),
            );
    const metadataByNodeId = new Map(
      metadataResults.map((entry) => [entry.nodeId, entry]),
    );
    return {
      response: {
        _tag: "Browsed",
        nodeId: continuation.nodeId,
        status: result.status,
        references: result.references.map((reference) =>
          browseReference(
            reference,
            metadataByNodeId.get(reference.nodeId.text),
          ),
        ),
      },
      continuation: result.continuation,
    };
  });

export type ReadNodeOptions = {
  readonly value?: boolean;
  readonly dataTypeDefinition?: boolean;
};

export const readNode = (
  session: BrowserOpcuaSession,
  nodeId: string,
  options?: ReadNodeOptions,
): Effect.Effect<ReadNodeResponse, WebRpcError> =>
  Effect.gen(function* () {
    const inspection = yield* session
      .inspectNode(nodeId, {
        value: options?.value === true,
        dataTypeDefinition: options?.dataTypeDefinition === true,
      })
      .pipe(Effect.mapError((cause) => rpcError("ReadNode", nodeId, cause)));

    return {
      nodeId,
      metadata: nodeMetadata(inspection.metadata),
      value:
        inspection.value &&
        inspection.value._tag !== "NotReadable" &&
        inspection.value._tag !== "ReadFailed"
          ? readValue(nodeId, inspection.value)
          : undefined,
      valueError:
        inspection.value?._tag === "ReadFailed"
          ? rpcError("ReadValue", nodeId, inspection.value.error)
          : undefined,
      dataTypeDefinition: inspection.dataTypeDefinition,
    };
  });

export const writeNode = (
  session: BrowserOpcuaSession,
  nodeId: string,
  value: unknown,
): Effect.Effect<WriteNodeResponse, WebRpcError> =>
  Effect.gen(function* () {
    const variable = Opcua.variable({
      nodeId,
      access: "readWrite",
    });
    const write = yield* session
      .write(variable, value as never)
      .pipe(Effect.mapError((cause) => rpcError("WriteNode", nodeId, cause)));
    const refreshed = yield* readNode(session, nodeId, { value: true });
    return {
      nodeId,
      attemptedValue: toJsonValue(value),
      writtenAt: new Date().toISOString(),
      write,
      refreshed,
    };
  });

export const monitorValues = (
  session: BrowserOpcuaSession,
  input: {
    readonly nodeIds: readonly string[];
    readonly samplingIntervalMs: number;
  },
) =>
  Effect.gen(function* () {
    const metadataResults =
      input.nodeIds.length === 0
        ? []
        : yield* session
            .readManyNodeMetadata(input.nodeIds)
            .pipe(
              Effect.mapError((cause) =>
                rpcError("MonitorMetadata", undefined, cause),
              ),
            );
    const metadataByNodeId = new Map(
      metadataResults.flatMap((result) =>
        result._tag === "Success"
          ? [[result.nodeId, nodeMetadata(result.metadata)] as const]
          : [],
      ),
    );
    const subscription = yield* session.makeSubscription({
      publishingInterval: Duration.millis(input.samplingIntervalMs),
    });
    const items = Object.fromEntries(
      input.nodeIds.map((nodeId) => [
        nodeId,
        Opcua.variable({ nodeId, access: "read" }),
      ]),
    );
    const active = yield* subscription.monitor(items, {
      startup: "bestEffort",
      validation: "access",
      samplingInterval: Duration.millis(input.samplingIntervalMs),
      queueSize: 5,
      discardOldest: true,
      filter: Opcua.MonitorFilter.statusValue(),
      timestamps: "both",
      clientBuffer: Opcua.BufferPolicy.sliding(64),
    });
    const started: MonitorEvent = {
      _tag: "Started",
      accepted: Array.from(active.startup.active.values()).map(
        (item) => item.nodeId,
      ),
      rejected: Array.from(active.startup.failed.values()).map(
        monitorRejectedItem,
      ),
    };
    return Stream.concat(
      Stream.succeed(started),
      active.samples.pipe(
        Stream.map(
          (sample): MonitorEvent => ({
            _tag: "Sample",
            sample: monitorSample(sample, metadataByNodeId),
          }),
        ),
      ),
    );
  });

const monitorSample = (
  sample: RuntimeMonitorSample,
  metadataByNodeId: ReadonlyMap<string, NodeMetadata>,
): MonitorSample => {
  const base = {
    nodeId: sample.nodeId,
    metadata: metadataByNodeId.get(sample.nodeId),
  };
  if (sample._tag === "Value") {
    return {
      ...base,
      sample: {
        _tag: "Value",
        nodeId: sample.nodeId,
        value: toJsonValue(sample.value),
        status: sample.status,
        sourceTimestamp: sample.sourceTimestamp?.toISOString(),
        serverTimestamp: sample.serverTimestamp?.toISOString(),
      },
    };
  }
  if (sample._tag === "DecodeError") {
    return {
      ...base,
      sample: {
        _tag: "DecodeError",
        nodeId: sample.nodeId,
        error: toJsonValue(sample.error),
        status: sample.status,
        sourceTimestamp: sample.sourceTimestamp?.toISOString(),
        serverTimestamp: sample.serverTimestamp?.toISOString(),
      },
    };
  }
  return {
    ...base,
    sample: {
      _tag: "NonGoodStatus",
      nodeId: sample.nodeId,
      status: sample.status,
      sourceTimestamp: sample.sourceTimestamp?.toISOString(),
      serverTimestamp: sample.serverTimestamp?.toISOString(),
    },
  };
};

const monitorRejectedItem = (
  failure: MonitorStartupFailure,
): MonitorRejectedItem => ({
  nodeId: failure.nodeId,
  message: rpcError("MonitorStartup", failure.nodeId, failure.error).message,
  phase: failure.error.reason.phase,
  status: failure.error.reason.status,
});

export const nodeMetadata = (metadata: OpcuaNodeMetadata): NodeMetadata => ({
  nodeId: metadata.nodeId,
  nodeClass: metadata.nodeClass,
  browseName: metadata.browseName,
  browseNameNamespaceIndex: metadata.browseNameNamespaceIndex,
  displayName: metadata.displayName,
  description: metadata.description,
  dataType: metadata.dataType,
  valueRank: metadata.valueRank,
  arrayDimensions: metadata.arrayDimensions
    ? [...metadata.arrayDimensions]
    : undefined,
  accessLevel: metadata.accessLevel,
  userAccessLevel: metadata.userAccessLevel,
  namespaceIndex: metadata.namespaceIndex,
  namespaceUri: metadata.namespaceUri,
});

const readValue = (
  nodeId: string,
  result: Exclude<
    OpcuaSession.OpcuaInspectValueResult,
    { _tag: "NotReadable" } | { _tag: "ReadFailed" }
  >,
): ReadValue => {
  if (result._tag === "Value") {
    return {
      _tag: "Value",
      nodeId,
      value: toJsonValue(result.value),
      status: result.status,
      sourceTimestamp: result.sourceTimestamp,
      serverTimestamp: result.serverTimestamp,
      variant: result.variant,
    };
  }
  if (result._tag === "DecodeError") {
    return {
      _tag: "DecodeError",
      nodeId,
      error: toJsonValue(result.error),
      status: result.status,
      sourceTimestamp: result.sourceTimestamp,
      serverTimestamp: result.serverTimestamp,
      variant: result.variant,
    };
  }
  return {
    _tag: "NonGoodStatus",
    nodeId,
    status: result.status,
    sourceTimestamp: result.sourceTimestamp,
    serverTimestamp: result.serverTimestamp,
    variant: result.variant,
  };
};

const browseReference = (
  reference: OpcuaBrowseReference,
  metadataResult: OpcuaNodeMetadataResult | undefined,
): BrowseReference => ({
  nodeId: reference.nodeId.text,
  namespaceIndex: reference.nodeId.namespace,
  namespaceUri: reference.nodeId.namespaceUri,
  isRemote: reference.nodeId.isRemote,
  referenceTypeId: reference.referenceTypeId,
  isForward: reference.isForward,
  nodeClass: reference.nodeClass,
  browseName: reference.browseName?.text,
  displayName: reference.displayName?.text,
  typeDefinition: reference.typeDefinition?.text,
  metadata:
    metadataResult?._tag === "Success"
      ? nodeMetadata(metadataResult.metadata)
      : undefined,
  metadataFailure:
    metadataResult?._tag === "Failure"
      ? metadataFailure(metadataResult.nodeId, metadataResult.reason)
      : undefined,
});

const metadataFailure = (
  nodeId: string,
  failure: OpcuaMetadataReadFailure,
): MetadataFailure => {
  if (failure._tag === "NonGoodStatus") {
    return {
      nodeId,
      message: `${failure.attribute}: ${failure.status.text}`,
      attribute: failure.attribute,
      status: failure.status.text,
    };
  }
  return {
    nodeId,
    message: `${failure.attribute}: ${failure.message}`,
    attribute: failure.attribute,
  };
};
