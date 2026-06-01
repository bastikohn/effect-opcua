import {
  OpcuaSubscription,
  OpcuaVariable,
  type OpcuaSession,
} from "@effect-opcua/client";
import { Duration, Effect, Result, Stream } from "effect";

import type {
  BrowseReference,
  BrowseResponse,
  DataTypeDefinitionResult,
  MetadataFailure,
  MonitorSample,
  NodeMetadata,
  ReadNodeResponse,
  ReadValue,
  WriteNodeResponse,
  WriteStatus,
} from "../shared/rpc.js";
import { WebRpcError } from "../shared/rpc.js";
import { toJsonValue } from "../shared/value.js";
import { rpcError, type BrowserOpcuaSession } from "./session-registry.js";

export const browseNode = (
  session: BrowserOpcuaSession,
  nodeId: string,
): Effect.Effect<BrowseResponse, WebRpcError> =>
  Effect.gen(function* () {
    const result = yield* session.browseChildren(nodeId).pipe(
      Effect.mapError((cause) => rpcError("Browse", nodeId, cause)),
    );
    if (result._tag === "NonGoodStatus") {
      return {
        nodeId,
        status: result.status,
        references: [],
      };
    }

    const nodeIds = result.references.map((reference) => reference.nodeId.text);
    const metadataResults =
      nodeIds.length === 0
        ? []
        : yield* session.readManyNodeMetadata(nodeIds).pipe(
            Effect.mapError((cause) =>
              rpcError("BrowseMetadata", nodeId, cause),
            ),
          );
    const metadataByNodeId = new Map(
      metadataResults.map((entry) => [entry.nodeId, entry]),
    );
    return {
      nodeId,
      status: result.status,
      references: result.references.map((reference) =>
        browseReference(reference, metadataByNodeId.get(reference.nodeId.text)),
      ),
    };
  });

export const readNode = (
  session: BrowserOpcuaSession,
  nodeId: string,
): Effect.Effect<ReadNodeResponse, WebRpcError> =>
  Effect.gen(function* () {
    const metadata = yield* session.readNodeMetadata(nodeId).pipe(
      Effect.mapError((cause) => rpcError("ReadNodeMetadata", nodeId, cause)),
    );
    const valueResult = isReadable(metadata)
      ? yield* Effect.result(readValue(session, nodeId))
      : undefined;
    const dataTypeDefinition = metadata.dataType
      ? yield* readDataTypeDefinition(session, metadata.dataType)
      : undefined;

    return {
      nodeId,
      metadata: nodeMetadata(metadata),
      value:
        valueResult && Result.isSuccess(valueResult)
          ? valueResult.success
          : undefined,
      valueError:
        valueResult && Result.isFailure(valueResult)
          ? rpcError("ReadValue", nodeId, valueResult.failure)
          : undefined,
      dataTypeDefinition,
    };
  });

export const writeNode = (
  session: BrowserOpcuaSession,
  nodeId: string,
  value: unknown,
): Effect.Effect<WriteNodeResponse, WebRpcError> =>
  Effect.gen(function* () {
    const variable = OpcuaVariable.make({
      nodeId,
      access: "readWrite",
    });
    const result = yield* Effect.result(session.write(variable, value as never));
    const write: WriteStatus = Result.isSuccess(result)
      ? result.success
      : {
          _tag: "Failed",
          nodeId,
          message: rpcError("WriteNode", nodeId, result.failure).message,
        };
    const refreshed = yield* readNode(session, nodeId);
    return { nodeId, write, refreshed };
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
        : yield* session.readManyNodeMetadata(input.nodeIds).pipe(
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
        OpcuaVariable.make({ nodeId, access: "read" }),
      ]),
    );
    const active = yield* subscription.monitor(items, {
      startup: "bestEffort",
      validation: "access",
      samplingInterval: Duration.millis(input.samplingIntervalMs),
      queueSize: 5,
      discardOldest: true,
      filter: OpcuaSubscription.MonitorFilter.statusValue(),
      timestamps: "both",
      clientBuffer: OpcuaSubscription.BufferPolicy.sliding(64),
    });
    return active.samples.pipe(
      Stream.map((sample): MonitorSample => {
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
      }),
    );
  });

export const nodeMetadata = (
  metadata: OpcuaSession.OpcuaNodeMetadata,
): NodeMetadata => ({
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
  session: BrowserOpcuaSession,
  nodeId: string,
): Effect.Effect<ReadValue, unknown> =>
  Effect.map(
    session.read(
      OpcuaVariable.make({
        nodeId,
        access: "read",
      }),
    ),
    (result): ReadValue => {
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
    },
  );

const readDataTypeDefinition = (
  session: BrowserOpcuaSession,
  dataTypeNodeId: string,
): Effect.Effect<DataTypeDefinitionResult> =>
  session.readDataTypeDefinition(dataTypeNodeId).pipe(
    Effect.matchEffect({
      onFailure: (cause) =>
        Effect.succeed({
          _tag: "Failure" as const,
          dataTypeNodeId,
          reason: rpcError(
            "ReadDataTypeDefinition",
            dataTypeNodeId,
            cause,
          ).message,
        }),
      onSuccess: (result) => Effect.succeed(result),
    }),
  );

const browseReference = (
  reference: OpcuaSession.OpcuaBrowseReference,
  metadataResult: OpcuaSession.OpcuaNodeMetadataResult | undefined,
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
  failure: OpcuaSession.OpcuaMetadataReadFailure,
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

const isReadable = (metadata: OpcuaSession.OpcuaNodeMetadata) =>
  metadata.accessLevel?.readable === true &&
  metadata.userAccessLevel?.readable !== false;
