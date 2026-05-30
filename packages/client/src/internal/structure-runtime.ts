import {
  DataType,
  DataTypeExtractStrategy,
  Variant,
  VariantArrayType,
  coerceNodeId,
  getExtraDataTypeManager,
  sameNodeId,
  type ClientSession,
  type ExtensionObject,
  type NodeId,
} from "node-opcua";
import { Effect } from "effect";

import type { NodeIdString } from "./capabilities.js";
import { encodeWithSchema, decodeWithSchema } from "./codecs.js";
import {
  configurationError,
  encodeError,
  serviceError,
  type OpcuaEncodeError,
  type OpcuaServiceError,
} from "../OpcuaError.js";
import {
  isStructureArrayDef,
  type AnyStructureDef,
  type StructureArrayDef,
  type StructureDef,
} from "./structures.js";
import { isPlainRecord } from "./predicates.js";
import { structureBodyFromExtensionObject } from "./structure-adapter.js";

export type OpcuaStructureRuntime = {
  readonly ensureInitialized: () => Effect.Effect<void, OpcuaServiceError>;
  readonly invalidate: Effect.Effect<void>;
  readonly encodeStructure: <A>(
    nodeId: NodeIdString,
    codec: StructureDef<A>,
    value: A,
  ) => Effect.Effect<ExtensionObject, OpcuaEncodeError | OpcuaServiceError>;
  readonly encodeStructureArray: <A>(
    nodeId: NodeIdString,
    codec: StructureArrayDef<A>,
    values: ReadonlyArray<A>,
  ) => Effect.Effect<
    ReadonlyArray<ExtensionObject>,
    OpcuaEncodeError | OpcuaServiceError
  >;
  readonly decodeStructure: <A>(codec: StructureDef<A>, rawValue: unknown) => A;
  readonly decodeStructureArray: <A>(
    codec: StructureArrayDef<A>,
    rawValues: unknown,
  ) => ReadonlyArray<A>;
  readonly variantFromStructure: <A>(
    nodeId: NodeIdString,
    codec: AnyStructureDef,
    value: A,
  ) => Effect.Effect<Variant, OpcuaEncodeError | OpcuaServiceError>;
};

export const makeStructureRuntime = (
  session: ClientSession,
): OpcuaStructureRuntime => {
  let initializeOnce = makeInitializeOnce(session);

  const ensureInitialized = () => initializeOnce;
  const invalidate = Effect.sync(() => {
    initializeOnce = makeInitializeOnce(session);
  });

  const encodeStructure = <A>(
    nodeId: NodeIdString,
    codec: StructureDef<A>,
    value: A,
  ) =>
    Effect.gen(function* () {
      yield* ensureInitialized();
      const pojo = yield* Effect.try({
        try: () => encodeWithSchema(codec.schema, value),
        catch: (error) => encodeError({ nodeId, value, error }),
      });
      return yield* Effect.tryPromise({
        try: () =>
          session.constructExtensionObject(
            coerceNodeId(codec.dataTypeId),
            pojoRecord(pojo),
          ),
        catch: (cause) =>
          encodeError({
            nodeId,
            value,
            error: cause,
            cause,
          }),
      });
    });

  const encodeStructureArray = <A>(
    nodeId: NodeIdString,
    codec: StructureArrayDef<A>,
    values: ReadonlyArray<A>,
  ) =>
    Effect.forEach(values, (value) =>
      encodeStructure(nodeId, codec.item, value),
    );

  const decodeStructure = <A>(codec: StructureDef<A>, rawValue: unknown): A =>
    decodeWithSchema(
      codec.schema,
      structureBodyFromExtensionObject(rawValue),
    ) as A;

  const decodeStructureArray = <A>(
    codec: StructureArrayDef<A>,
    rawValues: unknown,
  ): ReadonlyArray<A> => {
    if (!Array.isArray(rawValues)) {
      throw new TypeError(`Expected structure array for ${codec.item.name}`);
    }
    return rawValues.map((value) => decodeStructure(codec.item, value));
  };

  const variantFromStructure = <A>(
    nodeId: NodeIdString,
    codec: AnyStructureDef,
    value: A,
  ) =>
    Effect.gen(function* () {
      if (isStructureArrayDef(codec)) {
        const values = yield* arrayValue(nodeId, value);
        const extensionObjects = yield* encodeStructureArray(
          nodeId,
          codec,
          values,
        );
        return new Variant({
          dataType: DataType.ExtensionObject,
          arrayType: VariantArrayType.Array,
          value: [...extensionObjects],
        });
      }
      const extensionObject = yield* encodeStructure(nodeId, codec, value);
      return new Variant({
        dataType: DataType.ExtensionObject,
        arrayType: VariantArrayType.Scalar,
        value: extensionObject,
      });
    });

  return {
    ensureInitialized,
    invalidate,
    encodeStructure,
    encodeStructureArray,
    decodeStructure,
    decodeStructureArray,
    variantFromStructure,
  };
};

const makeInitializeOnce = (session: ClientSession) =>
  Effect.runSync(
    Effect.cached(
      Effect.tryPromise({
        try: () =>
          getExtraDataTypeManager(session, DataTypeExtractStrategy.Both),
        catch: (cause) =>
          serviceError({
            operation: "structure.extractNamespaceDataType",
            cause,
          }),
      }),
    ),
  );

const pojoRecord = (value: unknown): Record<string, unknown> => {
  if (isPlainRecord(value)) {
    return value as Record<string, unknown>;
  }
  throw new TypeError("Structure schema must encode to a plain object");
};

const arrayValue = <A>(
  nodeId: NodeIdString,
  value: A,
): Effect.Effect<ReadonlyArray<unknown>, OpcuaEncodeError> =>
  Array.isArray(value)
    ? Effect.succeed(value)
    : Effect.fail(
        encodeError({
          nodeId,
          value,
          error: "Structure array value must be an array",
        }),
      );

export const validateStructureMetadata = (
  operation: string,
  nodeId: NodeIdString,
  metadata: {
    readonly valueRank: number;
    readonly raw: {
      readonly declaredDataType: NodeId;
      readonly builtInDataType: DataType;
    };
  },
  structure: AnyStructureDef,
) => {
  const codec = isStructureArrayDef(structure) ? structure.item : structure;
  if (metadata.raw.builtInDataType !== DataType.ExtensionObject) {
    return configurationError({
      operation,
      nodeId,
      cause: `Expected built-in DataType.ExtensionObject for ${codec.name}`,
    });
  }
  const expectedDataType = coerceNodeId(codec.dataTypeId);
  if (!sameNodeId(metadata.raw.declaredDataType, expectedDataType)) {
    return configurationError({
      operation,
      nodeId,
      cause: `Expected exact declared DataType ${expectedDataType.toString()} for ${codec.name}, got ${metadata.raw.declaredDataType.toString()}`,
    });
  }
  if (metadata.valueRank > 1) {
    return configurationError({
      operation,
      nodeId,
      cause: "Structure matrices are not supported",
    });
  }
  if (isStructureArrayDef(structure)) {
    if (!isOneDimArrayCompatibleRank(metadata.valueRank)) {
      return configurationError({
        operation,
        nodeId,
        cause: "Expected one-dimensional structure array metadata",
      });
    }
  } else if (!isScalarCompatibleRank(metadata.valueRank)) {
    return configurationError({
      operation,
      nodeId,
      cause: "Expected scalar structure metadata",
    });
  }
  return undefined;
};

const isScalarCompatibleRank = (rank: number) =>
  rank === -1 || rank === -2 || rank === -3;

const isOneDimArrayCompatibleRank = (rank: number) =>
  rank === 1 || rank === 0 || rank === -2 || rank === -3;
