import {
  AccessLevelFlag,
  AttributeIds,
  DataType,
  NodeId,
  Variant,
  VariantArrayType,
  coerceNodeId,
  type ClientSession,
  type DataValue,
  type StatusCode,
} from "node-opcua";
import { Effect, Schema } from "effect";

import {
  Capabilities,
  type Capability,
  type CapabilitySet,
  type NodeIdString,
} from "./capabilities.js";
import {
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaEncodeError,
  OpcuaServiceError,
} from "./errors.js";
import {
  denormalizeDynamicValue,
  isArrayRank,
  isGood,
  normalizeDynamicValue,
  normalizeNodeId,
  normalizeStatusCode,
  normalizeTimestamp,
  normalizeVariantInfo,
  type OpcuaDynamicValue,
  type OpcuaNodeIdInfo,
  type OpcuaStatusInfo,
  type OpcuaVariantInfo,
} from "./normalize.js";

export type OpcuaValueSample<A, Id extends string = string> =
  | {
      readonly _tag: "Value";
      readonly nodeId: Id;
      readonly value: A;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly raw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly raw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    }
  | {
      readonly _tag: "DecodeError";
      readonly nodeId: Id;
      readonly error: Schema.SchemaError;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly raw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    };

export type OpcuaAnyValueSample =
  | OpcuaValueSample<unknown, string>
  | OpcuaValueSample<OpcuaDynamicValue, string>;

export type OpcuaWriteResult<Id extends string = string> =
  | {
      readonly _tag: "Written";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
    };

export type OpcuaWriteValuesResult<Ids extends string> = {
  readonly [Id in Ids]: OpcuaWriteResult<Id>;
};
export type OpcuaWriteValueSpec<
  Id extends string = string,
  S extends AnySchema | undefined = AnySchema | undefined,
> = ValueSpec<Id, S> & {
  readonly value: ValueOfSpec<ValueSpec<Id, S>>;
};
export type WriteValueSpec<
  Id extends string = string,
  S extends AnySchema | undefined = AnySchema | undefined,
> = OpcuaWriteValueSpec<Id, S>;
export type WriteValuesResult<Specs extends ReadonlyArray<ValueSpec>> = {
  readonly [Index in keyof Specs]: Specs[Index] extends ValueSpec<
    infer Id,
    AnySchema | undefined
  >
    ? OpcuaWriteResult<Id>
    : never;
};

export type OpcuaValueMetadata = {
  readonly nodeId: NodeIdString;
  readonly dataType: string;
  readonly dataTypeNodeId: OpcuaNodeIdInfo;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly accessLevel: number;
  readonly userAccessLevel?: number;
  readonly access: {
    readonly readable: boolean;
    readonly writable: boolean;
    readonly userReadable: boolean;
    readonly userWritable: boolean;
  };
  readonly raw: {
    readonly dataType: DataType;
    readonly dataTypeNodeId: NodeId;
  };
};

export type AnySchema = Schema.Schema<unknown>;
export type SchemaType<S> = S extends Schema.Schema<infer A> ? A : never;
export type OpcuaValueSpec<
  Id extends string = string,
  S extends AnySchema | undefined = AnySchema | undefined,
> = {
  readonly nodeId: Id;
  readonly schema?: S;
  readonly includeRaw?: boolean;
};
export type ValueSpec<
  Id extends string = string,
  S extends AnySchema | undefined = AnySchema | undefined,
> = OpcuaValueSpec<Id, S>;
export type ValueOfSpec<Spec> = Spec extends { readonly schema: infer S }
  ? S extends AnySchema
    ? SchemaType<S>
    : OpcuaDynamicValue
  : OpcuaDynamicValue;
export type ReadValuesResult<Specs extends ReadonlyArray<ValueSpec>> = {
  readonly [Index in keyof Specs]: Specs[Index] extends ValueSpec<
    infer Id,
    AnySchema | undefined
  >
    ? OpcuaValueSample<ValueOfSpec<Specs[Index]>, Id>
    : never;
};
type HasCapability<
  Caps extends CapabilitySet,
  Cap extends Capability,
> = Cap extends Caps[number] ? unknown : never;
type ReadCapabilityPart<A, Caps extends CapabilitySet, Id extends string> =
  HasCapability<Caps, "read"> extends never
    ? Record<never, never>
    : {
        readonly read: () => Effect.Effect<
          OpcuaValueSample<A, Id>,
          OpcuaServiceError
        >;
      };
type WriteCapabilityPart<A, Caps extends CapabilitySet, Id extends string> =
  HasCapability<Caps, "write"> extends never
    ? Record<never, never>
    : {
        readonly write: (
          value: A,
        ) => Effect.Effect<
          OpcuaWriteResult<Id>,
          OpcuaEncodeError | OpcuaServiceError | OpcuaAccessDeniedError
        >;
      };

export type OpcuaValueHandle<
  A = OpcuaDynamicValue,
  Caps extends CapabilitySet = typeof Capabilities.read,
  Id extends string = string,
> = {
  readonly nodeId: Id;
  readonly schema?: Schema.Schema<A>;
  readonly metadata: OpcuaValueMetadata;
  readonly capabilities: Caps;
  readonly raw: {
    readonly nodeId: NodeId;
    readonly dataType: DataType;
  };
} & ReadCapabilityPart<A, Caps, Id> &
  WriteCapabilityPart<A, Caps, Id>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WritableOpcuaValueHandle<A = any, Id extends string = string> =
  | OpcuaValueHandle<A, typeof Capabilities.write, Id>
  | OpcuaValueHandle<A, typeof Capabilities.readWrite, Id>;

export type ValueOfHandle<H> =
  H extends OpcuaValueHandle<infer A, CapabilitySet, string> ? A : never;
export type NodeIdOfHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends OpcuaValueHandle<any, CapabilitySet, infer Id> ? Id : never;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type WriteEntry<H extends WritableOpcuaValueHandle<any, string>> = {
  readonly handle: H;
  readonly value: ValueOfHandle<H>;
};

export const readDataValue = (session: ClientSession, nodeId: NodeIdString) =>
  Effect.tryPromise({
    try: () =>
      session.read(
        {
          nodeId: coerceNodeId(nodeId),
          attributeId: AttributeIds.Value,
        },
        0,
      ),
    catch: (cause) =>
      new OpcuaServiceError({ operation: "readValue", nodeId, cause }),
  });

export const sampleFromDataValue = <
  Id extends string,
  S extends AnySchema | undefined,
>(
  spec: ValueSpec<Id, S>,
  dataValue: DataValue,
): OpcuaValueSample<ValueOfSpec<ValueSpec<Id, S>>, Id> => {
  const base = sampleBase(spec.nodeId, dataValue, spec.includeRaw ?? false);
  if (!isGood(dataValue.statusCode)) {
    return { _tag: "NonGoodStatus", ...base };
  }
  try {
    const value = spec.schema
      ? decodeWithSchema(spec.schema, dataValue.value?.value)
      : normalizeDynamicValue(dataValue.value?.value, dataValue.value);
    return {
      _tag: "Value",
      ...base,
      value: value as ValueOfSpec<ValueSpec<Id, S>>,
    };
  } catch (error) {
    return {
      _tag: "DecodeError",
      ...base,
      error: error as Schema.SchemaError,
    };
  }
};

const sampleBase = <Id extends string>(
  nodeId: Id,
  dataValue: DataValue,
  includeRaw: boolean,
) => ({
  nodeId,
  status: normalizeStatusCode(dataValue.statusCode),
  sourceTimestamp: normalizeTimestamp(dataValue.sourceTimestamp),
  serverTimestamp: normalizeTimestamp(dataValue.serverTimestamp),
  variant: dataValue.value ? normalizeVariantInfo(dataValue.value) : undefined,
  raw: includeRaw
    ? {
        dataValue,
        variant: dataValue.value,
      }
    : undefined,
});

export const discoverMetadata = (
  session: ClientSession,
  nodeId: NodeIdString,
  requested: CapabilitySet,
) =>
  Effect.gen(function* () {
    const nodes = [
      AttributeIds.DataType,
      AttributeIds.ValueRank,
      AttributeIds.ArrayDimensions,
      AttributeIds.AccessLevel,
      AttributeIds.UserAccessLevel,
    ].map((attributeId) => ({ nodeId: coerceNodeId(nodeId), attributeId }));
    const [
      dataTypeValue,
      valueRankValue,
      arrayDimensionsValue,
      accessLevelValue,
      userAccessLevelValue,
    ] = yield* Effect.tryPromise({
      try: () => session.read(nodes, 0),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "valueHandle.discovery",
          nodeId,
          cause,
        }),
    });
    if (
      !dataTypeValue ||
      !isGood(dataTypeValue.statusCode) ||
      !(dataTypeValue.value?.value instanceof NodeId)
    ) {
      return yield* Effect.fail(
        new OpcuaConfigurationError({
          operation: "valueHandle.discovery",
          nodeId,
          cause: "DataType is unreadable",
        }),
      );
    }
    if (
      !valueRankValue ||
      !isGood(valueRankValue.statusCode) ||
      typeof valueRankValue.value?.value !== "number"
    ) {
      return yield* Effect.fail(
        new OpcuaConfigurationError({
          operation: "valueHandle.discovery",
          nodeId,
          cause: "ValueRank is unreadable",
        }),
      );
    }
    if (
      !accessLevelValue ||
      !isGood(accessLevelValue.statusCode) ||
      typeof accessLevelValue.value?.value !== "number"
    ) {
      return yield* Effect.fail(
        new OpcuaConfigurationError({
          operation: "valueHandle.discovery",
          nodeId,
          cause: "AccessLevel is unreadable",
        }),
      );
    }
    const builtInDataType = yield* Effect.tryPromise({
      try: () => session.getBuiltInDataType(coerceNodeId(nodeId)),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "valueHandle.discovery.getBuiltInDataType",
          nodeId,
          cause,
        }),
    });
    const accessLevel = accessLevelValue.value.value as number;
    const userAccessLevel =
      userAccessLevelValue &&
      isGood(userAccessLevelValue.statusCode) &&
      typeof userAccessLevelValue.value?.value === "number"
        ? (userAccessLevelValue.value.value as number)
        : undefined;
    for (const capability of requested) {
      const accessError = accessDeniedError(
        nodeId,
        capability,
        accessLevel,
        userAccessLevel,
      );
      if (accessError) return yield* Effect.fail(accessError);
    }
    const dataTypeNodeId = dataTypeValue.value.value as NodeId;
    return {
      nodeId,
      dataType: DataType[builtInDataType] ?? String(builtInDataType),
      dataTypeNodeId: normalizeNodeId(dataTypeNodeId),
      valueRank: valueRankValue.value.value as number,
      arrayDimensions:
        arrayDimensionsValue &&
        isGood(arrayDimensionsValue.statusCode) &&
        Array.isArray(arrayDimensionsValue.value?.value)
          ? arrayDimensionsValue.value.value
          : undefined,
      accessLevel,
      userAccessLevel,
      access: {
        readable: hasAccess(accessLevel, "read"),
        writable: hasAccess(accessLevel, "write"),
        userReadable:
          userAccessLevel === undefined || hasAccess(userAccessLevel, "read"),
        userWritable:
          userAccessLevel === undefined || hasAccess(userAccessLevel, "write"),
      },
      raw: {
        dataType: builtInDataType,
        dataTypeNodeId,
      },
    };
  });

export const writeByMetadata = (
  session: ClientSession,
  input: {
    readonly nodeId: NodeIdString;
    readonly schema?: AnySchema;
    readonly value: unknown;
    readonly metadata: OpcuaValueMetadata;
  },
) =>
  Effect.gen(function* () {
    const encoded = yield* encodeValue(
      input.nodeId,
      input.schema,
      input.value,
      input.metadata,
    );
    const statusCode = yield* Effect.tryPromise({
      try: () =>
        session.write({
          nodeId: coerceNodeId(input.nodeId),
          attributeId: AttributeIds.Value,
          value: {
            value: makeVariant(input.metadata, encoded),
          },
        }),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "writeValue",
          nodeId: input.nodeId,
          cause,
        }),
    });
    return writeResult(input.nodeId, statusCode);
  });

export const encodeValue = (
  nodeId: NodeIdString,
  schema: AnySchema | undefined,
  value: unknown,
  metadata: OpcuaValueMetadata,
) =>
  schema
    ? Effect.sync(() =>
        Schema.encodeUnknownSync(schema as Schema.Encoder<unknown>)(value),
      ).pipe(
        Effect.mapError(
          (error) => new OpcuaEncodeError({ nodeId, value, error }),
        ),
      )
    : Effect.suspend(() => {
        try {
          return Effect.succeed(denormalizeDynamicValue(value, metadata));
        } catch (error) {
          return Effect.fail(new OpcuaEncodeError({ nodeId, value, error }));
        }
      });

export const makeVariant = (metadata: OpcuaValueMetadata, value: unknown) =>
  new Variant({
    dataType: metadata.raw.dataType,
    arrayType: variantArrayType(metadata, value),
    dimensions:
      variantArrayType(metadata, value) === VariantArrayType.Matrix
        ? matrixDimensions(metadata, value)
        : undefined,
    value: flattenMatrixValue(metadata, value) as Variant["value"],
  });

const variantArrayType = (metadata: OpcuaValueMetadata, value: unknown) =>
  metadata.valueRank > 1
    ? VariantArrayType.Matrix
    : Array.isArray(value) || isArrayRank(metadata.valueRank)
      ? VariantArrayType.Array
      : VariantArrayType.Scalar;

const flattenMatrixValue = (
  metadata: OpcuaValueMetadata,
  value: unknown,
): unknown => {
  if (metadata.valueRank <= 1 || !Array.isArray(value)) return value;
  return value.flat(metadata.valueRank - 1);
};

const matrixDimensions = (
  metadata: OpcuaValueMetadata,
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

export const writeResult = <Id extends string>(
  nodeId: Id,
  statusCode: StatusCode,
): OpcuaWriteResult<Id> =>
  isGood(statusCode)
    ? { _tag: "Written", nodeId, status: normalizeStatusCode(statusCode) }
    : {
        _tag: "NonGoodStatus",
        nodeId,
        status: normalizeStatusCode(statusCode),
      };

export const accessDeniedError = (
  nodeId: NodeIdString,
  requestedCapability: Capability,
  accessLevel: number,
  userAccessLevel?: number,
) => {
  const hasNodeAccess = hasAccess(accessLevel, requestedCapability);
  const hasUserAccess =
    userAccessLevel === undefined ||
    hasAccess(userAccessLevel, requestedCapability);
  if (!hasNodeAccess || !hasUserAccess) {
    return new OpcuaAccessDeniedError({
      nodeId,
      requestedCapability,
      accessLevel,
      userAccessLevel,
    });
  }
  return undefined;
};

export const hasAccess = (accessLevel: number, capability: Capability) => {
  const flag =
    capability === "read"
      ? AccessLevelFlag.CurrentRead
      : AccessLevelFlag.CurrentWrite;
  return (accessLevel & flag) !== 0;
};

const decodeWithSchema = <S extends AnySchema>(
  schema: S,
  value: unknown,
): SchemaType<S> =>
  Schema.decodeUnknownSync(schema as unknown as Schema.Decoder<unknown>)(
    value,
  ) as SchemaType<S>;

export const hasCapability = (
  capabilities: CapabilitySet,
  capability: Capability,
) => capabilities.includes(capability);
