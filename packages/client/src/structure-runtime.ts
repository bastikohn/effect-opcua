import {
  DataType,
  Variant,
  VariantArrayType,
  coerceNodeId,
  type ClientSession,
  type ExtensionObject,
} from "node-opcua";
import { Effect } from "effect";

import type { NodeIdString } from "./capabilities.js";
import { encodeWithSchema, decodeWithSchema } from "./codecs.js";
import {
  OpcuaConfigurationError,
  OpcuaEncodeError,
  OpcuaServiceError,
} from "./errors.js";
import {
  isOpcuaStructureArrayCodec,
  type AnyStructureSpec,
  type OpcuaStructureArrayCodec,
  type OpcuaStructureCodec,
} from "./structures.js";

export type OpcuaStructureRuntime = {
  readonly ensureInitialized: () => Effect.Effect<void, OpcuaServiceError>;
  readonly encodeStructure: <A>(
    nodeId: NodeIdString,
    codec: OpcuaStructureCodec<A>,
    value: A,
  ) => Effect.Effect<ExtensionObject, OpcuaEncodeError | OpcuaServiceError>;
  readonly encodeStructureArray: <A>(
    nodeId: NodeIdString,
    codec: OpcuaStructureArrayCodec<A>,
    values: ReadonlyArray<A>,
  ) => Effect.Effect<
    ReadonlyArray<ExtensionObject>,
    OpcuaEncodeError | OpcuaServiceError
  >;
  readonly decodeStructure: <A>(
    codec: OpcuaStructureCodec<A>,
    rawValue: unknown,
  ) => A;
  readonly decodeStructureArray: <A>(
    codec: OpcuaStructureArrayCodec<A>,
    rawValues: unknown,
  ) => ReadonlyArray<A>;
  readonly variantFromStructure: <A>(
    nodeId: NodeIdString,
    codec: AnyStructureSpec,
    value: A,
  ) => Effect.Effect<Variant, OpcuaEncodeError | OpcuaServiceError>;
};

export const makeStructureRuntime = (
  session: ClientSession,
): OpcuaStructureRuntime => {
  let initialized = false;

  const ensureInitialized = () =>
    initialized
      ? Effect.void
      : Effect.tryPromise({
          try: async () => {
            await session.extractNamespaceDataType();
            initialized = true;
          },
          catch: (cause) =>
            new OpcuaServiceError({
              operation: "structure.extractNamespaceDataType",
              cause,
            }),
        });

  const encodeStructure = <A>(
    nodeId: NodeIdString,
    codec: OpcuaStructureCodec<A>,
    value: A,
  ) =>
    Effect.gen(function* () {
      yield* ensureInitialized();
      const pojo = yield* Effect.try({
        try: () => encodeWithSchema(codec.schema, value),
        catch: (error) => new OpcuaEncodeError({ nodeId, value, error }),
      });
      return yield* Effect.tryPromise({
        try: () =>
          session.constructExtensionObject(
            coerceNodeId(codec.dataTypeId),
            pojoRecord(pojo),
          ),
        catch: (cause) =>
          new OpcuaEncodeError({
            nodeId,
            value,
            error: cause,
            cause,
          }),
      });
    });

  const encodeStructureArray = <A>(
    nodeId: NodeIdString,
    codec: OpcuaStructureArrayCodec<A>,
    values: ReadonlyArray<A>,
  ) =>
    Effect.forEach(values, (value) =>
      encodeStructure(nodeId, codec.item, value),
    );

  const decodeStructure = <A>(
    codec: OpcuaStructureCodec<A>,
    rawValue: unknown,
  ): A => decodeWithSchema(codec.schema, extractStructurePojo(rawValue)) as A;

  const decodeStructureArray = <A>(
    codec: OpcuaStructureArrayCodec<A>,
    rawValues: unknown,
  ): ReadonlyArray<A> => {
    if (!Array.isArray(rawValues)) {
      throw new TypeError(`Expected structure array for ${codec.item.name}`);
    }
    return rawValues.map((value) => decodeStructure(codec.item, value));
  };

  const variantFromStructure = <A>(
    nodeId: NodeIdString,
    codec: AnyStructureSpec,
    value: A,
  ) =>
    Effect.suspend(() =>
      isOpcuaStructureArrayCodec(codec)
        ? encodeStructureArray(nodeId, codec, arrayValue(nodeId, value)).pipe(
            Effect.map(
              (extensionObjects) =>
                new Variant({
                  dataType: DataType.ExtensionObject,
                  arrayType: VariantArrayType.Array,
                  value: [...extensionObjects],
                }),
            ),
          )
        : encodeStructure(nodeId, codec, value).pipe(
            Effect.map(
              (extensionObject) =>
                new Variant({
                  dataType: DataType.ExtensionObject,
                  arrayType: VariantArrayType.Scalar,
                  value: extensionObject,
                }),
            ),
          ),
    );

  return {
    ensureInitialized,
    encodeStructure,
    encodeStructureArray,
    decodeStructure,
    decodeStructureArray,
    variantFromStructure,
  };
};

const pojoRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new TypeError("Structure schema must encode to a plain object");
};

const arrayValue = <A>(
  nodeId: NodeIdString,
  value: A,
): ReadonlyArray<unknown> => {
  if (Array.isArray(value)) return value;
  throw new OpcuaEncodeError({
    nodeId,
    value,
    error: "Structure array value must be an array",
  });
};

export const extractStructurePojo = (value: unknown): unknown => {
  if (!value || typeof value !== "object") {
    throw new TypeError("Expected structure object");
  }
  if (isPlainRecord(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.toJSON === "function") {
    const json = record.toJSON();
    if (isPlainRecord(json)) return json;
  }
  if ("schema" in record) {
    const entries = Object.entries(record).filter(([key]) =>
      isStructureDataKey(key),
    );
    if (entries.length > 0) return Object.fromEntries(entries);
  }
  throw new TypeError("Could not extract plain structure body");
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const isStructureDataKey = (key: string) =>
  !key.startsWith("_") &&
  key !== "schema" &&
  key !== "encode" &&
  key !== "decode" &&
  key !== "binaryStoreSize" &&
  key !== "constructor";

export const validateStructureMetadata = (
  operation: string,
  nodeId: NodeIdString,
  metadata: {
    readonly valueRank: number;
    readonly raw: {
      readonly declaredDataType: { readonly toString: () => string };
      readonly builtInDataType: DataType;
    };
  },
  structure: AnyStructureSpec,
) => {
  const codec = isOpcuaStructureArrayCodec(structure)
    ? structure.item
    : structure;
  if (metadata.raw.builtInDataType !== DataType.ExtensionObject) {
    return new OpcuaConfigurationError({
      operation,
      nodeId,
      cause: `Expected built-in DataType.ExtensionObject for ${codec.name}`,
    });
  }
  if (metadata.raw.declaredDataType.toString() !== codec.dataTypeId) {
    return new OpcuaConfigurationError({
      operation,
      nodeId,
      cause: `Expected declared DataType ${codec.dataTypeId}, got ${metadata.raw.declaredDataType.toString()}`,
    });
  }
  if (metadata.valueRank > 1) {
    return new OpcuaConfigurationError({
      operation,
      nodeId,
      cause: "Structure matrices are not supported",
    });
  }
  if (isOpcuaStructureArrayCodec(structure)) {
    if (metadata.valueRank < 1) {
      return new OpcuaConfigurationError({
        operation,
        nodeId,
        cause: "Expected one-dimensional structure array metadata",
      });
    }
  } else if (metadata.valueRank >= 1) {
    return new OpcuaConfigurationError({
      operation,
      nodeId,
      cause: "Expected scalar structure metadata",
    });
  }
  return undefined;
};
