import {
  DataType,
  Variant,
  VariantArrayType,
  type DataValue,
} from "node-opcua";
import { Effect, Schema } from "effect";

import {
  denormalizeDynamicValue,
  isArrayRank,
  normalizeDynamicValue,
  type OpcuaDynamicValue,
  type OpcuaDynamicValueMetadata,
} from "./normalize.js";
import { encodeError, type OpcuaConfigurationError } from "../OpcuaError.js";
import {
  validateStructureMetadata,
  type OpcuaStructureRuntime,
} from "./structure-runtime.js";
import {
  isStructureArrayDef,
  type AnyStructureDef,
  type StructureArrayDef,
  type StructureDef,
} from "./structures.js";
import type { NodeIdString } from "./capabilities.js";

// Sync encode/decode helpers only support schemas without contextual services.
export type AnySchema = Schema.Codec<unknown, unknown, never, never>;
export type SchemaType<S extends AnySchema> = Schema.Schema.Type<S>;

export type OpcuaCodec<A> =
  | { readonly _tag: "Dynamic"; readonly _A?: A }
  | { readonly _tag: "Schema"; readonly schema: AnySchema; readonly _A?: A }
  | StructureDef<A>
  | (unknown extends A
      ? StructureArrayDef<unknown>
      : A extends ReadonlyArray<infer Item>
        ? StructureArrayDef<Item>
        : never);

export type CodecType<C> =
  C extends StructureArrayDef<infer A>
    ? ReadonlyArray<A>
    : C extends OpcuaCodec<infer A>
      ? A
      : never;

export type CodecMetadata = {
  readonly nodeId: NodeIdString;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly raw: {
    readonly declaredDataType: import("node-opcua").NodeId;
    readonly builtInDataType: DataType;
  };
};

export const dynamic = <A = OpcuaDynamicValue>(): OpcuaCodec<A> => ({
  _tag: "Dynamic",
});

export const schema = <S extends AnySchema>(
  schema: S,
): OpcuaCodec<SchemaType<S>> => ({
  _tag: "Schema",
  schema,
});

export const structure = <S extends AnySchema>(options: {
  readonly name: string;
  readonly dataTypeId: NodeIdString;
  readonly schema: S;
}): StructureDef<SchemaType<S>> => ({
  _tag: "Structure",
  name: options.name,
  dataTypeId: options.dataTypeId,
  schema: options.schema as Schema.Codec<unknown, SchemaType<S>, never, never>,
});

export const structureArray = <A>(
  structure: StructureDef<A>,
): StructureArrayDef<A> => ({
  _tag: "StructureArray",
  item: structure,
});

export const Codec = {
  encode: <A>(
    codec: OpcuaCodec<A>,
    value: A,
    metadata: CodecMetadata,
    structureRuntime: OpcuaStructureRuntime,
  ) => encodeCodec(codec, value, metadata, structureRuntime),
  decode: <A>(
    codec: OpcuaCodec<A>,
    variant: Variant | undefined,
    dataValue: DataValue | undefined,
    structureRuntime: OpcuaStructureRuntime,
  ) => decodeCodec(codec, variant, dataValue, structureRuntime),
  validateMetadata: (codec: OpcuaCodec<unknown>, metadata: CodecMetadata) =>
    validateCodecMetadata(codec, metadata),
  requiresStructureRuntime: (codec: OpcuaCodec<unknown>) =>
    codec._tag === "Structure" || codec._tag === "StructureArray",
};

export const encodeWithSchema = <S extends AnySchema>(
  schema: S,
  value: unknown,
): unknown =>
  Schema.encodeUnknownSync(schema as unknown as Schema.Encoder<unknown>)(value);

export const decodeWithSchema = <S extends AnySchema>(
  schema: S,
  value: unknown,
): SchemaType<S> =>
  Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown>)(
    value,
  ) as SchemaType<S>;

export const encodeDynamicValue = (
  value: unknown,
  metadata: OpcuaDynamicValueMetadata,
): unknown => denormalizeDynamicValue(value, metadata);

export const decodeDynamicValue = (
  value: unknown,
  variant?: Variant,
): OpcuaDynamicValue => normalizeDynamicValue(value, variant);

export const makeVariantFromMetadata = (
  metadata: OpcuaDynamicValueMetadata,
  value: unknown,
) =>
  new Variant({
    dataType: metadata.raw.dataType,
    arrayType: variantArrayType(metadata, value),
    dimensions:
      variantArrayType(metadata, value) === VariantArrayType.Matrix
        ? matrixDimensions(metadata, value)
        : undefined,
    value: flattenMatrixValue(metadata, value) as Variant["value"],
  });

const variantArrayType = (
  metadata: OpcuaDynamicValueMetadata,
  value: unknown,
) =>
  metadata.valueRank > 1
    ? VariantArrayType.Matrix
    : Array.isArray(value) || isArrayRank(metadata.valueRank)
      ? VariantArrayType.Array
      : VariantArrayType.Scalar;

const flattenMatrixValue = (
  metadata: OpcuaDynamicValueMetadata,
  value: unknown,
): unknown => {
  if (metadata.valueRank <= 1 || !Array.isArray(value)) return value;
  return value.flat(metadata.valueRank - 1);
};

const matrixDimensions = (
  metadata: OpcuaDynamicValueMetadata,
  value: unknown,
): Array<number> | undefined => {
  if (metadata.arrayDimensions && metadata.arrayDimensions.length > 0) {
    return [...metadata.arrayDimensions];
  }
  return inferArrayDimensions(value, metadata.valueRank);
};

const inferArrayDimensions = (
  value: unknown,
  rank: number,
): Array<number> | undefined => {
  const dimensions: Array<number> = [];
  let current = value;
  for (let depth = 0; depth < rank; depth++) {
    if (!Array.isArray(current)) return undefined;
    dimensions.push(current.length);
    current = current[0];
  }
  return dimensions;
};

const encodeCodec = <A>(
  codec: OpcuaCodec<A>,
  value: A,
  metadata: CodecMetadata,
  structureRuntime: OpcuaStructureRuntime,
) => {
  switch (codec._tag) {
    case "Dynamic":
      return Effect.suspend(() => {
        try {
          return Effect.succeed(
            makeVariantFromMetadata(
              codecMetadata(metadata),
              encodeDynamicValue(value, codecMetadata(metadata)),
            ),
          );
        } catch (error) {
          return Effect.fail(
            encodeError({ nodeId: metadata.nodeId, value, error }),
          );
        }
      });
    case "Schema":
      return Effect.try({
        try: () =>
          makeVariantFromMetadata(
            codecMetadata(metadata),
            encodeWithSchema(codec.schema, value),
          ),
        catch: (error) =>
          encodeError({ nodeId: metadata.nodeId, value, error }),
      });
    case "Structure":
      return structureRuntime.variantFromStructure(
        metadata.nodeId,
        codec,
        value,
      );
    case "StructureArray":
      return structureRuntime.variantFromStructure(
        metadata.nodeId,
        codec,
        value,
      );
  }
};

const decodeCodec = <A>(
  codec: OpcuaCodec<A>,
  variant: Variant | undefined,
  _dataValue: DataValue | undefined,
  structureRuntime: OpcuaStructureRuntime,
): Effect.Effect<A, unknown> =>
  Effect.try({
    try: () => {
      switch (codec._tag) {
        case "Dynamic":
          return decodeDynamicValue(variant?.value, variant) as A;
        case "Schema":
          return decodeWithSchema(codec.schema, variant?.value) as A;
        case "Structure":
          return decodeStructureValue(codec, variant, structureRuntime) as A;
        case "StructureArray":
          return decodeStructureValue(codec, variant, structureRuntime) as A;
      }
    },
    catch: (error) => error,
  });

const decodeStructureValue = (
  structure: AnyStructureDef,
  variant: Variant | undefined,
  structureRuntime: OpcuaStructureRuntime,
) => {
  if (variant?.dataType !== DataType.ExtensionObject) {
    throw new TypeError("Expected ExtensionObject Variant");
  }
  if (isStructureArrayDef(structure)) {
    if (variant.arrayType !== VariantArrayType.Array) {
      throw new TypeError("Expected ExtensionObject array Variant");
    }
    return structureRuntime.decodeStructureArray(structure, variant.value);
  }
  if (variant.arrayType !== VariantArrayType.Scalar) {
    throw new TypeError("Expected scalar ExtensionObject Variant");
  }
  return structureRuntime.decodeStructure(structure, variant.value);
};

const validateCodecMetadata = (
  codec: OpcuaCodec<unknown>,
  metadata: CodecMetadata,
): Effect.Effect<void, OpcuaConfigurationError> => {
  if (codec._tag !== "Structure" && codec._tag !== "StructureArray") {
    return Effect.void;
  }
  const error = validateStructureMetadata(
    "codec.structure",
    metadata.nodeId,
    metadata,
    codec,
  );
  return error ? Effect.fail(error) : Effect.void;
};

const codecMetadata = (metadata: CodecMetadata): OpcuaDynamicValueMetadata => ({
  raw: { dataType: metadata.raw.builtInDataType },
  valueRank: metadata.valueRank,
  arrayDimensions: metadata.arrayDimensions,
});
