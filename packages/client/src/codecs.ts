import { Variant, VariantArrayType } from "node-opcua";
import { Schema } from "effect";

import {
  denormalizeDynamicValue,
  isArrayRank,
  normalizeDynamicValue,
  type OpcuaDynamicValue,
  type OpcuaDynamicValueMetadata,
} from "./normalize.js";

// Sync encode/decode helpers only support schemas without contextual services.
export type AnySchema = Schema.Codec<unknown, unknown, never, never>;
export type SchemaType<S extends AnySchema> = Schema.Schema.Type<S>;

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
