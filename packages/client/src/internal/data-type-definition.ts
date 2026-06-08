import {
  AttributeIds,
  BrowseDirection,
  DataTypeExtractStrategy,
  ReferenceTypeIds,
  StatusCodes,
  coerceNodeId,
  convertStructureTypeSchemaToStructureDefinition,
  getExtraDataTypeManager,
  sameNodeId,
  type ClientSession,
  type DataValue,
  type NodeId,
} from "node-opcua";
import { Effect } from "effect";

import type { NodeIdString } from "./common/node-id.js";
import type { MetadataService, OpcuaNodeMetadataResult } from "./metadata.js";
import { isGood, normalizeStatusCode } from "./normalize.js";
import { serviceError, type OpcuaError } from "../OpcuaError.js";

type DynamicStructureSchema = Parameters<
  typeof convertStructureTypeSchemaToStructureDefinition
>[0];

export type OpcuaDataTypeDefinitionResult =
  | {
      readonly _tag: "Success";
      readonly dataTypeNodeId: string;
      readonly definition: OpcuaDataTypeDefinition;
    }
  | {
      readonly _tag: "Missing";
      readonly dataTypeNodeId: string;
      readonly reason: string;
    }
  | {
      readonly _tag: "Unsupported";
      readonly dataTypeNodeId: string;
      readonly reason: string;
    }
  | {
      readonly _tag: "Failure";
      readonly dataTypeNodeId: string;
      readonly reason: string;
    };

export type OpcuaDataTypeDefinition =
  | OpcuaStructureDefinition
  | OpcuaEnumDefinition;

export type OpcuaStructureDefinition = {
  readonly _tag: "Structure";
  readonly dataTypeNodeId: string;
  readonly name: string;
  readonly structureType:
    | "Structure"
    | "StructureWithOptionalFields"
    | "Union"
    | "Unknown";
  readonly fields: readonly OpcuaStructureField[];
};

export type OpcuaStructureField = {
  readonly name: string;
  readonly dataTypeNodeId: string;
  readonly valueRank?: number;
  readonly arrayDimensions?: readonly number[];
  readonly isOptional?: boolean;
  readonly description?: string;
};

export type OpcuaEnumDefinition = {
  readonly _tag: "Enum";
  readonly dataTypeNodeId: string;
  readonly name: string;
  readonly fields: readonly OpcuaEnumField[];
};

export type OpcuaEnumField = {
  readonly name: string;
  readonly value: number;
  readonly description?: string;
};

export const readDataTypeDefinition = (
  session: ClientSession,
  metadata: MetadataService,
  dataTypeNodeId: NodeIdString,
): Effect.Effect<OpcuaDataTypeDefinitionResult, OpcuaError> =>
  Effect.map(
    readManyDataTypeDefinitions(session, metadata, [dataTypeNodeId]),
    (results) => results[0]!,
  );

export const readManyDataTypeDefinitions = (
  session: ClientSession,
  metadata: MetadataService,
  dataTypeNodeIds: readonly NodeIdString[],
): Effect.Effect<readonly OpcuaDataTypeDefinitionResult[], OpcuaError> =>
  Effect.gen(function* () {
    if (dataTypeNodeIds.length === 0) return [];
    const metadataResults = yield* metadata.nodes(dataTypeNodeIds);
    let dynamicManager: Promise<unknown> | undefined;
    const nodesToRead = dataTypeNodeIds.map((nodeId) => ({
      nodeId: coerceNodeId(nodeId),
      attributeId: AttributeIds.DataTypeDefinition,
    }));
    const values = yield* Effect.tryPromise({
      try: () => session.read(nodesToRead, 0),
      catch: (cause) =>
        serviceError({
          operation: "metadata.dataTypeDefinition",
          cause,
        }),
    });
    if (values.length !== dataTypeNodeIds.length) {
      return yield* Effect.fail(
        serviceError({
          operation: "metadata.dataTypeDefinition",
          cause: `Expected ${dataTypeNodeIds.length} DataValues, got ${values.length}`,
        }),
      );
    }
    return yield* Effect.forEach(
      dataTypeNodeIds,
      (dataTypeNodeId, index) =>
        Effect.gen(function* () {
          const result = normalizeDefinitionResult(
            dataTypeNodeId,
            metadataResults[index],
            values[index],
          );
          const name = dataTypeName(dataTypeNodeId, metadataResults[index]);
          const canReadDynamicDefinition =
            nodesToRead[index]?.nodeId.namespace !== 0;
          if (isEmptyStructureResult(result)) {
            if (!canReadDynamicDefinition) {
              return {
                _tag: "Unsupported" as const,
                dataTypeNodeId,
                reason: "Structure DataTypeDefinition has no fields",
              };
            }
            return yield* readDynamicDataTypeDefinition(
              () =>
                (dynamicManager ??= getExtraDataTypeManager(
                  session,
                  DataTypeExtractStrategy.Both,
                )),
              dataTypeNodeId,
              name,
            ).pipe(
              Effect.map(
                (fallback) =>
                  fallback ?? {
                    _tag: "Unsupported" as const,
                    dataTypeNodeId,
                    reason: "Structure DataTypeDefinition has no fields",
                  },
              ),
            );
          }
          if (result._tag !== "Missing") return result;
          const enumFallback = yield* readEnumPropertyDefinition(
            session,
            dataTypeNodeId,
            name,
          );
          if (enumFallback) return enumFallback;
          if (!canReadDynamicDefinition) return result;
          return yield* readDynamicDataTypeDefinition(
            () =>
              (dynamicManager ??= getExtraDataTypeManager(
                session,
                DataTypeExtractStrategy.Both,
              )),
            dataTypeNodeId,
            name,
          ).pipe(Effect.map((fallback) => fallback ?? result));
        }),
      { concurrency: 1 },
    );
  });

const isEmptyStructureResult = (result: OpcuaDataTypeDefinitionResult) =>
  result._tag === "Success" &&
  result.definition._tag === "Structure" &&
  result.definition.fields.length === 0;

const readDynamicDataTypeDefinition = (
  getDynamicManager: () => Promise<unknown>,
  dataTypeNodeId: string,
  name: string,
): Effect.Effect<OpcuaDataTypeDefinitionResult | undefined> =>
  Effect.promise(async () => {
    try {
      const manager = await getDynamicManager();
      const definition = normalizeDynamicDefinition(
        manager,
        dataTypeNodeId,
        name,
      );
      return definition
        ? {
            _tag: "Success" as const,
            dataTypeNodeId,
            definition,
          }
        : undefined;
    } catch {
      return undefined;
    }
  });

const normalizeDynamicDefinition = (
  manager: unknown,
  dataTypeNodeId: string,
  name: string,
): OpcuaDataTypeDefinition | undefined => {
  const nodeId = coerceNodeId(dataTypeNodeId);
  const structureInfo = dynamicStructureInfo(manager, nodeId);
  if (structureInfo) {
    const raw = convertStructureTypeSchemaToStructureDefinition(
      structureInfo.schema,
    );
    const definition = normalizeRawDefinition(dataTypeNodeId, name, raw);
    return definition._tag === "Structure" && definition.fields.length > 0
      ? definition
      : undefined;
  }
  return dynamicEnumDefinition(manager, nodeId, dataTypeNodeId, name);
};

const dynamicStructureInfo = (
  manager: unknown,
  dataTypeNodeId: NodeId,
): { readonly schema: DynamicStructureSchema } | undefined => {
  if (!isRecord(manager)) return undefined;
  const getStructureInfoForDataType = manager.getStructureInfoForDataType;
  if (typeof getStructureInfoForDataType !== "function") return undefined;
  const info = getStructureInfoForDataType.call(manager, dataTypeNodeId);
  if (!isRecord(info) || !("schema" in info)) return undefined;
  return info as { readonly schema: DynamicStructureSchema };
};

const dynamicEnumDefinition = (
  manager: unknown,
  nodeId: NodeId,
  dataTypeNodeId: string,
  name: string,
): OpcuaEnumDefinition | undefined => {
  if (!isRecord(manager)) return undefined;
  const getDataTypeFactory = manager.getDataTypeFactory;
  if (typeof getDataTypeFactory !== "function") return undefined;
  const factory = getDataTypeFactory.call(manager, nodeId.namespace);
  if (!isRecord(factory)) return undefined;
  const getEnumIterator = factory.getEnumIterator;
  if (typeof getEnumIterator !== "function") return undefined;
  for (const rawEnum of getEnumIterator.call(factory) as Iterable<unknown>) {
    if (!isRecord(rawEnum)) continue;
    const rawNodeId = rawEnum.dataTypeNodeId;
    if (
      !isRecord(rawNodeId) ||
      typeof rawNodeId.toString !== "function" ||
      !sameNodeId(coerceNodeId(rawNodeId.toString()), nodeId)
    ) {
      continue;
    }
    const fields = enumFieldsFromMap(rawEnum.enumValues);
    if (fields.length === 0) return undefined;
    return {
      _tag: "Enum",
      dataTypeNodeId,
      name,
      fields,
    };
  }
  return undefined;
};

const readEnumPropertyDefinition = (
  session: ClientSession,
  dataTypeNodeId: string,
  name: string,
): Effect.Effect<OpcuaDataTypeDefinitionResult | undefined, OpcuaError> =>
  Effect.gen(function* () {
    const browseResult = yield* Effect.tryPromise({
      try: () =>
        session.browse({
          nodeId: coerceNodeId(dataTypeNodeId),
          referenceTypeId: coerceNodeId(ReferenceTypeIds.HasProperty),
          browseDirection: BrowseDirection.Forward,
          includeSubtypes: false,
          resultMask: 63,
        }),
      catch: (cause) =>
        serviceError({
          operation: "metadata.dataTypeEnumProperties",
          nodeId: dataTypeNodeId,
          cause,
        }),
    });
    if (!isGood(browseResult.statusCode)) return undefined;
    const enumValues = browseResult.references?.find(
      (reference) => reference.browseName?.name === "EnumValues",
    );
    const enumStrings = browseResult.references?.find(
      (reference) => reference.browseName?.name === "EnumStrings",
    );
    const property = enumValues ?? enumStrings;
    if (!property) return undefined;

    const dataValue = yield* Effect.tryPromise({
      try: () =>
        session.read(
          {
            nodeId: property.nodeId,
            attributeId: AttributeIds.Value,
          },
          0,
        ),
      catch: (cause) =>
        serviceError({
          operation: "metadata.dataTypeEnumProperties",
          nodeId: dataTypeNodeId,
          cause,
        }),
    });
    if (!isGood(dataValue.statusCode)) return undefined;
    try {
      const fields =
        property === enumValues
          ? normalizeEnumValues(dataValue.value?.value)
          : normalizeEnumStrings(dataValue.value?.value);
      return {
        _tag: "Success",
        dataTypeNodeId,
        definition: {
          _tag: "Enum",
          dataTypeNodeId,
          name,
          fields,
        },
      };
    } catch (cause) {
      return {
        _tag: "Failure",
        dataTypeNodeId,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
  });

const normalizeDefinitionResult = (
  dataTypeNodeId: string,
  metadata: OpcuaNodeMetadataResult | undefined,
  dataValue: DataValue | undefined,
): OpcuaDataTypeDefinitionResult => {
  if (!dataValue || !isGood(dataValue.statusCode)) {
    return {
      _tag: "Missing",
      dataTypeNodeId,
      reason: normalizeStatusCode(
        dataValue?.statusCode ?? StatusCodes.BadAttributeIdInvalid,
      ).text,
    };
  }
  const raw = dataValue.value?.value;
  const name = dataTypeName(dataTypeNodeId, metadata);
  try {
    const definition = normalizeRawDefinition(dataTypeNodeId, name, raw);
    return definition._tag === "Unsupported"
      ? {
          _tag: "Unsupported",
          dataTypeNodeId,
          reason: definition.reason,
        }
      : {
          _tag: "Success",
          dataTypeNodeId,
          definition,
        };
  } catch (cause) {
    return {
      _tag: "Failure",
      dataTypeNodeId,
      reason: cause instanceof Error ? cause.message : String(cause),
    };
  }
};

const dataTypeName = (
  dataTypeNodeId: string,
  metadata: OpcuaNodeMetadataResult | undefined,
) =>
  metadata?._tag === "Success"
    ? (metadata.metadata.browseName ?? dataTypeNodeId)
    : dataTypeNodeId;

const normalizeRawDefinition = (
  dataTypeNodeId: string,
  name: string,
  raw: unknown,
):
  | OpcuaDataTypeDefinition
  | { readonly _tag: "Unsupported"; readonly reason: string } => {
  if (!isRecord(raw)) {
    return {
      _tag: "Unsupported",
      reason: "DataTypeDefinition is not an object",
    };
  }
  if ("structureType" in raw) {
    return {
      _tag: "Structure",
      dataTypeNodeId,
      name,
      structureType: normalizeStructureType(raw.structureType),
      fields: arrayValue(raw.fields).map((field) =>
        normalizeStructureField(field),
      ),
    };
  }
  if ("fields" in raw) {
    return {
      _tag: "Enum",
      dataTypeNodeId,
      name,
      fields: arrayValue(raw.fields).map((field) => normalizeEnumField(field)),
    };
  }
  return {
    _tag: "Unsupported",
    reason: "Unsupported DataTypeDefinition shape",
  };
};

const normalizeStructureField = (raw: unknown): OpcuaStructureField => {
  if (!isRecord(raw)) throw new Error("Structure field is not an object");
  return {
    name: stringValue(raw.name),
    dataTypeNodeId: nodeIdString(raw.dataType),
    valueRank: numberOrUndefined(raw.valueRank),
    arrayDimensions: numberArrayOrUndefined(raw.arrayDimensions),
    isOptional: booleanOrUndefined(raw.isOptional),
    description: localizedText(raw.description),
  };
};

const normalizeEnumField = (raw: unknown): OpcuaEnumField => {
  if (!isRecord(raw)) throw new Error("Enum field is not an object");
  return {
    name: stringValue(raw.name),
    value: int64Number(raw.value),
    description: localizedText(raw.description),
  };
};

const enumFieldsFromMap = (raw: unknown): readonly OpcuaEnumField[] => {
  if (Array.isArray(raw)) {
    return raw.map((name, value) => ({ name: stringValue(name), value }));
  }
  if (!isRecord(raw)) return [];
  return Object.entries(raw).flatMap(([name, value]) =>
    Number.isNaN(Number(name)) && typeof value === "number"
      ? [{ name, value }]
      : [],
  );
};

const normalizeEnumValues = (raw: unknown): readonly OpcuaEnumField[] => {
  if (!Array.isArray(raw)) throw new Error("EnumValues is not an array");
  return raw.map((field) => {
    if (!isRecord(field)) throw new Error("EnumValues entry is not an object");
    return {
      name:
        localizedText(field.displayName) ??
        localizedText(field.name) ??
        stringValue(field.name),
      value: int64Number(field.value),
      description: localizedText(field.description),
    };
  });
};

const normalizeEnumStrings = (raw: unknown): readonly OpcuaEnumField[] => {
  if (!Array.isArray(raw)) throw new Error("EnumStrings is not an array");
  return raw.map((field, value) => ({
    name: localizedText(field) ?? stringValue(field),
    value,
    description: localizedText(field),
  }));
};

const normalizeStructureType = (
  value: unknown,
): OpcuaStructureDefinition["structureType"] => {
  switch (numericEnumValue(value)) {
    case 0:
      return "Structure";
    case 1:
      return "StructureWithOptionalFields";
    case 2:
      return "Union";
    default:
      return "Unknown";
  }
};

const arrayValue = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

const stringValue = (value: unknown): string =>
  typeof value === "string" ? value : "";

const nodeIdString = (value: unknown): string =>
  isRecord(value) && typeof value.toString === "function"
    ? value.toString()
    : String(value ?? "");

const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const numberArrayOrUndefined = (
  value: unknown,
): readonly number[] | undefined =>
  Array.isArray(value) && value.every((item) => typeof item === "number")
    ? [...value]
    : undefined;

const booleanOrUndefined = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const localizedText = (value: unknown): string | undefined => {
  if (!isRecord(value)) return undefined;
  const text = value.text;
  return typeof text === "string" ? text : undefined;
};

const numericEnumValue = (value: unknown): number | undefined => {
  if (typeof value === "number") return value;
  if (isRecord(value) && typeof value.value === "number") return value.value;
  return undefined;
};

const int64Number = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number"
  ) {
    const high = value[0] | 0;
    const low = value[1] >>> 0;
    return high * 0x1_0000_0000 + low;
  }
  if (isRecord(value) && typeof value.value === "number") return value.value;
  throw new Error(`Enum value is not numeric: ${String(value)}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
