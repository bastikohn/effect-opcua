import { EventEmitter } from "node:events";
import { Effect, PubSub } from "effect";
import type {
  Argument,
  BrowseDescriptionOptions,
  BrowseResult,
  CallMethodRequestLike,
  CallMethodResult,
  ClientSession,
  DataValue,
  NodeId,
  ReadValueIdOptions,
  StatusCode,
  WriteValueOptions,
} from "node-opcua";
import { ExtensionObject } from "node-opcua";

import { makeSession } from "../../src/OpcuaSession.js";
import type { OpcuaSessionBatchingOptions } from "../../src/OpcuaSession.js";
import type { OpcuaSessionEvent } from "../../src/internal/events.js";
import {
  AttributeIds,
  DataType,
  NodeClass,
  StatusCodes,
  Variant,
  coerceNodeId,
} from "../../src/node-opcua.js";

export type FakeVariableMetadata = {
  readonly dataType?: string | NodeId;
  readonly valueRank?: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly accessLevel?: number;
  readonly userAccessLevel?: number;
};

export type FakeNodeMetadata = {
  readonly nodeClass?: NodeClass;
  readonly browseName?: string;
  readonly browseNameNamespaceIndex?: number;
  readonly displayName?: string;
  readonly description?: string;
};

export type FakeMethodDefinition = {
  readonly inputArguments?: ReadonlyArray<Argument>;
  readonly outputArguments?: ReadonlyArray<Argument>;
  readonly executable?: boolean;
  readonly userExecutable?: boolean;
};

export type FakeSessionOptions = {
  readonly batching?: OpcuaSessionBatchingOptions;
  readonly namespaceArray?: ReadonlyArray<string>;
  readonly nodeMetadata?: Readonly<Record<string, FakeNodeMetadata>>;
  readonly missingNodeIds?: ReadonlyArray<string>;
  readonly readValues?: (
    nodesToRead: ReadonlyArray<ReadValueIdOptions>,
  ) => ReadonlyArray<DataValue>;
  readonly variableMetadata?: Readonly<Record<string, FakeVariableMetadata>>;
  readonly methodDefinitions?: Readonly<Record<string, FakeMethodDefinition>>;
  readonly methodResults?: (input: {
    readonly request: CallMethodRequestLike;
    readonly index: number;
  }) => CallMethodResult;
  readonly dataTypeSuperTypes?: Readonly<Record<string, string | NodeId>>;
  readonly onWrite?: (
    nodesToWrite: ReadonlyArray<WriteValueOptions>,
  ) => ReadonlyArray<StatusCode> | void;
};

export const makeFakeSession = (options: FakeSessionOptions = {}) =>
  Effect.gen(function* () {
    const events = yield* PubSub.sliding<OpcuaSessionEvent>(16);
    const calls = {
      valueReads: [] as Array<ReadonlyArray<ReadValueIdOptions>>,
      metadataReads: [] as Array<ReadonlyArray<ReadValueIdOptions>>,
      writes: [] as Array<ReadonlyArray<WriteValueOptions>>,
      calls: [] as Array<ReadonlyArray<CallMethodRequestLike>>,
      browses: [] as Array<BrowseDescriptionOptions>,
    };
    const raw = Object.assign(new EventEmitter(), {
      read: async (
        nodesToRead: ReadValueIdOptions | Array<ReadValueIdOptions>,
      ) => {
        const isSingle = !Array.isArray(nodesToRead);
        const batch = Array.isArray(nodesToRead) ? nodesToRead : [nodesToRead];
        const values = batch.every(
          (node) => node.attributeId === AttributeIds.Value,
        )
          ? readValueBatch(options, calls, batch)
          : readMetadataBatch(options, calls, batch);
        return isSingle ? values[0] : values;
      },
      write: async (
        nodesToWrite: WriteValueOptions | Array<WriteValueOptions>,
      ) => {
        const isSingle = !Array.isArray(nodesToWrite);
        const batch = Array.isArray(nodesToWrite)
          ? nodesToWrite
          : [nodesToWrite];
        calls.writes.push([...batch]);
        const statuses =
          options.onWrite?.(batch) ?? batch.map(() => StatusCodes.Good);
        return isSingle ? statuses[0] : statuses;
      },
      call: async (
        methodsToCall: CallMethodRequestLike | Array<CallMethodRequestLike>,
      ) => {
        const batch = Array.isArray(methodsToCall)
          ? methodsToCall
          : [methodsToCall];
        calls.calls.push([...batch]);
        const results = batch.map(
          (request, index) =>
            options.methodResults?.({ request, index }) ??
            methodResult([
              new Variant({
                dataType: DataType.Double,
                value:
                  (request.inputArguments?.[0] as Variant | undefined)?.value ??
                  0,
              }),
            ]),
        );
        return Array.isArray(methodsToCall) ? results : results[0];
      },
      browse: async (description: BrowseDescriptionOptions) => {
        calls.browses.push(description);
        const nodeId = coerceNodeId(description.nodeId).toString();
        const superType = options.dataTypeSuperTypes?.[nodeId];
        return {
          statusCode: StatusCodes.Good,
          references: superType ? [{ nodeId: coerceNodeId(superType) }] : [],
        } as unknown as BrowseResult;
      },
      getArgumentDefinition: async (methodId: NodeId) => {
        const definition = methodDefinition(options, methodId.toString());
        return {
          inputArguments: definition.inputArguments ?? [
            numberArgument("Value"),
          ],
          outputArguments: definition.outputArguments ?? [
            numberArgument("Value"),
          ],
        };
      },
      constructExtensionObject: async (
        dataType: NodeId,
        value: Record<string, unknown>,
      ) => fakeExtensionObject(dataType, value),
      extractNamespaceDataType: async () => undefined,
    }) as unknown as ClientSession & EventEmitter;

    const session = yield* makeSession(raw, events, {
      batching: options.batching,
    });
    return { raw, session, calls };
  });

const readValueBatch = (
  options: FakeSessionOptions,
  calls: { readonly valueReads: Array<ReadonlyArray<ReadValueIdOptions>> },
  batch: ReadonlyArray<ReadValueIdOptions>,
) => {
  calls.valueReads.push([...batch]);
  if (batch.every((node) => isNamespaceArrayNodeId(node.nodeId?.toString()))) {
    return batch.map(
      () =>
        ({
          statusCode: StatusCodes.Good,
          value: {
            value: options.namespaceArray ?? [
              "http://opcfoundation.org/UA/",
              "urn:effect-opcua:test",
            ],
          },
        }) as unknown as DataValue,
    );
  }
  return (
    options.readValues?.(batch) ??
    batch.map((_, index) => numberDataValue(index))
  );
};

const isNamespaceArrayNodeId = (nodeId: string | undefined) =>
  nodeId === "i=2255" || nodeId === "ns=0;i=2255";

const readMetadataBatch = (
  options: FakeSessionOptions,
  calls: { readonly metadataReads: Array<ReadonlyArray<ReadValueIdOptions>> },
  batch: ReadonlyArray<ReadValueIdOptions>,
) => {
  calls.metadataReads.push([...batch]);
  return batch.map((node) => metadataDataValue(options, node));
};

const metadataDataValue = (
  options: FakeSessionOptions,
  node: ReadValueIdOptions,
): DataValue => {
  const nodeId = node.nodeId?.toString() ?? "";
  if (options.missingNodeIds?.includes(nodeId)) {
    return { statusCode: StatusCodes.BadNodeIdUnknown } as unknown as DataValue;
  }
  const nodeMetadata = options.nodeMetadata?.[nodeId] ?? {};
  const variable = options.variableMetadata?.[nodeId] ?? {};
  const method = methodDefinition(options, nodeId);
  switch (node.attributeId) {
    case AttributeIds.NodeClass:
      return variantDataValue(
        DataType.Int32,
        nodeMetadata.nodeClass ?? NodeClass.Variable,
      );
    case AttributeIds.BrowseName:
      return variantDataValue(DataType.QualifiedName, {
        namespaceIndex: nodeMetadata.browseNameNamespaceIndex ?? 1,
        name: nodeMetadata.browseName ?? nodeId,
        toString: () => nodeMetadata.browseName ?? nodeId,
      });
    case AttributeIds.DisplayName:
      return variantDataValue(DataType.LocalizedText, {
        text: nodeMetadata.displayName ?? nodeMetadata.browseName ?? nodeId,
        locale: undefined,
      });
    case AttributeIds.Description:
      return nodeMetadata.description
        ? variantDataValue(DataType.LocalizedText, {
            text: nodeMetadata.description,
            locale: undefined,
          })
        : ({
            statusCode: StatusCodes.BadAttributeIdInvalid,
          } as unknown as DataValue);
    case AttributeIds.DataType:
      return variantDataValue(
        DataType.NodeId,
        coerceNodeId(variable.dataType ?? "i=11"),
      );
    case AttributeIds.ValueRank:
      return variantDataValue(DataType.Int32, variable.valueRank ?? -1);
    case AttributeIds.ArrayDimensions:
      return variable.arrayDimensions
        ? variantDataValue(DataType.UInt32, [...variable.arrayDimensions])
        : ({
            statusCode: StatusCodes.BadAttributeIdInvalid,
          } as unknown as DataValue);
    case AttributeIds.AccessLevel:
      return variantDataValue(DataType.Byte, variable.accessLevel ?? 3);
    case AttributeIds.UserAccessLevel:
      return variantDataValue(DataType.Byte, variable.userAccessLevel ?? 3);
    case AttributeIds.Executable:
      return variantDataValue(DataType.Boolean, method.executable ?? true);
    case AttributeIds.UserExecutable:
      return variantDataValue(DataType.Boolean, method.userExecutable ?? true);
    default:
      return numberDataValue(0);
  }
};

const methodDefinition = (options: FakeSessionOptions, methodId: string) =>
  options.methodDefinitions?.[methodId] ?? {};

export const numberDataValue = (
  value: unknown,
  statusCode: StatusCode = StatusCodes.Good,
): DataValue => variantDataValue(DataType.Double, value, statusCode);

export const variantDataValue = (
  dataType: DataType,
  value: unknown,
  statusCode: StatusCode = StatusCodes.Good,
  arrayType?: number,
): DataValue =>
  ({
    statusCode,
    value: new Variant({ dataType, value, arrayType }),
  }) as DataValue;

export const numberArgument = (name: string): Argument =>
  fakeArgument(name, "i=11");

export const booleanArgument = (name: string): Argument =>
  fakeArgument(name, "i=1");

export const stringArgument = (name: string): Argument =>
  fakeArgument(name, "i=12");

export const structureArgument = (
  name: string,
  dataType: string,
  valueRank = -1,
): Argument => fakeArgument(name, dataType, valueRank);

export const fakeArgument = (
  name: string,
  dataType: string | NodeId,
  valueRank = -1,
): Argument =>
  ({
    name,
    dataType: coerceNodeId(dataType),
    valueRank,
    arrayDimensions: [],
  }) as unknown as Argument;

export const methodResult = (
  outputArguments: ReadonlyArray<Variant>,
  statusCode: StatusCode = StatusCodes.Good,
): CallMethodResult =>
  ({
    statusCode,
    outputArguments: [...outputArguments],
  }) as CallMethodResult;

export const fakeExtensionObject = (
  dataType: string | NodeId,
  value: Record<string, unknown>,
) => new FakeExtensionObject(coerceNodeId(dataType), value);

export const fakeOpaqueExtensionObject = (
  nodeId: string | NodeId,
  buffer: Buffer,
) => new FakeOpaqueExtensionObject(coerceNodeId(nodeId), buffer);

class FakeExtensionObject extends ExtensionObject {
  readonly dataType: NodeId;

  constructor(dataType: NodeId, value: Record<string, unknown>) {
    super();
    this.dataType = dataType;
    Object.assign(this, value);
  }

  toJSON() {
    return Object.fromEntries(
      Object.entries(this).filter(([key]) => key !== "dataType"),
    );
  }
}

class FakeOpaqueExtensionObject extends ExtensionObject {
  readonly nodeId: NodeId;
  readonly buffer: Buffer;

  constructor(nodeId: NodeId, buffer: Buffer) {
    super();
    this.nodeId = nodeId;
    this.buffer = buffer;
  }
}
