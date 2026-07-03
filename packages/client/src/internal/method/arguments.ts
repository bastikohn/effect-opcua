import {
  DataType,
  type Argument,
  type CallMethodRequestLike,
  type CallMethodResult,
  type DataValue,
  type NodeId,
  type StatusCode,
  type Variant,
} from "node-opcua";
import { Effect } from "effect";

import {
  configurationError,
  isConfigurationError,
  methodInputError,
  type OpcuaConfigurationError,
  type OpcuaMethodInputError,
  type OpcuaServiceError,
} from "../../OpcuaError.js";
import type { NodeIdString } from "../common/node-id.js";
import { isPlainRecord, isRecord } from "../common/predicates.js";
import { Codec } from "../values/codec.js";
import {
  isGood,
  normalizeLocalizedText,
  normalizeNodeId,
  normalizeStatusCode,
} from "../values/normalize.js";
import type { OpcuaStructureRuntime } from "../structures/runtime.js";
import type { MethodCallOptions } from "../batch/operations.js";
import type {
  AnyMethodDef,
  InputOfMethodDef,
  MethodArgRecord,
  MethodArgumentMapping,
  MethodArgumentMetadata,
  MethodMetadata,
  ResolvedMethod,
} from "../../OpcuaMethod.js";

export type MethodPreflight = {
  readonly request: CallMethodRequestLike;
  readonly includeRaw: boolean;
};

export type MethodInfo = {
  readonly objectId: NodeIdString;
  readonly methodId: NodeIdString;
  readonly metadata: MethodMetadata;
};

export const methodCallOptionsError = (
  operation: string,
  objectId: NodeIdString,
  methodId: NodeIdString,
  options: MethodCallOptions | undefined,
) => {
  if (options === undefined) return undefined;
  if (!isPlainRecord(options)) {
    return configurationError({
      operation,
      objectId,
      methodId,
      cause: "options must be an object",
    });
  }
  const unknown = Object.keys(options).filter((key) => key !== "includeRaw");
  if (unknown.length > 0) {
    return configurationError({
      operation,
      objectId,
      methodId,
      cause: `unsupported option: ${unknown.join(", ")}`,
    });
  }
  if (
    "includeRaw" in options &&
    options.includeRaw !== undefined &&
    typeof options.includeRaw !== "boolean"
  ) {
    return configurationError({
      operation,
      objectId,
      methodId,
      cause: "includeRaw must be a boolean",
    });
  }
  return undefined;
};

export const resolveMethodMapping = (
  operation: string,
  nodeId: NodeIdString,
  arguments_: ReadonlyArray<MethodArgumentMetadata>,
  fields: MethodArgRecord | undefined,
): Effect.Effect<
  ReadonlyArray<MethodArgumentMapping>,
  OpcuaConfigurationError
> =>
  Effect.gen(function* () {
    const mapping = fields
      ? explicitMapping(operation, nodeId, arguments_, fields)
      : emptyMapping(operation, nodeId, arguments_);
    if (isConfigurationError(mapping)) {
      return yield* Effect.fail(
        configurationError({ operation, nodeId, cause: mapping.reason.cause }),
      );
    }
    for (const entry of mapping) {
      const argument = arguments_[entry.index]!;
      yield* Codec.validateMetadata(
        entry.arg.codec,
        argumentCodecMetadata(nodeId, argument),
      ).pipe(
        Effect.mapError((cause) =>
          configurationError({
            operation,
            nodeId,
            cause: {
              argumentName: argument.name,
              argumentIndex: entry.index,
              cause,
            },
          }),
        ),
      );
    }
    return mapping;
  });

export const methodArgumentMetadataFromRaw = (
  argument: Argument,
  dataTypeNodeId: NodeId,
  builtInDataType: DataType,
): MethodArgumentMetadata => ({
  name: argument.name ?? "",
  description: argument.description
    ? normalizeLocalizedText(argument.description)
    : undefined,
  declaredDataType: normalizeNodeId(dataTypeNodeId),
  builtInDataType: DataType[builtInDataType] ?? String(builtInDataType),
  valueRank: argument.valueRank ?? -1,
  arrayDimensions: argument.arrayDimensions ?? undefined,
  unsafeRaw: {
    argument,
    declaredDataType: dataTypeNodeId,
    builtInDataType,
  },
});

export const readBooleanAttribute = (
  dataValue: DataValue | undefined,
  operation: string,
  nodeId: NodeIdString,
  required: boolean,
) => {
  if (
    dataValue &&
    isGood(dataValue.statusCode) &&
    typeof dataValue.value?.value === "boolean"
  ) {
    return dataValue.value.value as boolean;
  }
  if (!required) return undefined;
  return configurationError({
    operation,
    nodeId,
    cause: "method boolean attribute is unreadable",
  });
};

export const preflightMethodCall = <const Spec extends AnyMethodDef>(
  method: ResolvedMethod<Spec>,
  input: InputOfMethodDef<Spec>,
  structureRuntime: OpcuaStructureRuntime,
  options?: MethodCallOptions,
): Effect.Effect<
  MethodPreflight,
  OpcuaConfigurationError | OpcuaMethodInputError | OpcuaServiceError
> =>
  Effect.gen(function* () {
    const optionsError = methodCallOptionsError(
      "method.call.options",
      method.objectId,
      method.methodId,
      options,
    );
    if (optionsError) return yield* Effect.fail(optionsError);
    if (
      method.metadata.inputMapping.some((mapping) =>
        Codec.requiresStructureRuntime(mapping.arg.codec),
      ) ||
      method.metadata.outputMapping.some((mapping) =>
        Codec.requiresStructureRuntime(mapping.arg.codec),
      )
    ) {
      yield* structureRuntime.ensureInitialized();
    }
    const inputRecord = objectRecord(input);
    if (!inputRecord) {
      return yield* Effect.fail(
        methodInputError({
          objectId: method.objectId,
          methodId: method.methodId,
          input,
          phase: "ArgumentMapping",
          cause: "input must be an object",
        }),
      );
    }
    const keyError = validateInputKeys(method, inputRecord, input);
    if (keyError) return yield* Effect.fail(keyError);

    const inputArguments: Array<Variant> = [];
    for (const mapping of method.metadata.inputMapping) {
      const argument = method.metadata.inputArguments[mapping.index]!;
      const rawValue = inputRecord[mapping.key];
      const variant = yield* Codec.encode(
        mapping.arg.codec,
        rawValue,
        argumentCodecMetadata(method.methodId, argument),
        structureRuntime,
      ).pipe(
        Effect.mapError((error) =>
          methodInputError({
            objectId: method.objectId,
            methodId: method.methodId,
            input,
            phase: "Encoding",
            argumentKey: mapping.key,
            argumentIndex: mapping.index,
            error,
          }),
        ),
      );
      inputArguments[mapping.index] = variant;
    }

    return {
      request: {
        objectId: method.unsafeRaw.objectId,
        methodId: method.unsafeRaw.methodId,
        inputArguments,
      },
      includeRaw: options?.includeRaw ?? method.def.includeRaw ?? false,
    };
  });

export const outputObjectFromResult = (
  method: MethodInfo,
  result: CallMethodResult,
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    const output: Record<string, unknown> = {};
    const outputArguments = result.outputArguments ?? [];
    for (const mapping of method.metadata.outputMapping) {
      const argument = method.metadata.outputArguments[mapping.index]!;
      const variant = outputArguments[mapping.index];
      output[mapping.key] = yield* Codec.decode(
        mapping.arg.codec,
        variant,
        undefined,
        structureRuntime,
      ).pipe(
        Effect.mapError((error) => ({
          argumentName: argument.name,
          argumentIndex: mapping.index,
          error,
        })),
      );
    }
    return output;
  });

export const normalizeInputArgumentResults = (
  method: MethodInfo,
  result: CallMethodResult,
) => {
  const statuses = result.inputArgumentResults;
  if (!statuses || statuses.length === 0) return undefined;
  const diagnostics = (
    result as { readonly inputArgumentDiagnosticInfos?: ReadonlyArray<unknown> }
  ).inputArgumentDiagnosticInfos;
  return statuses.map((statusCode: StatusCode, index: number) => {
    const mapping = method.metadata.inputMapping.find(
      (candidate) => candidate.index === index,
    );
    return {
      key: mapping?.key ?? String(index),
      index,
      argumentName:
        mapping?.argumentName ??
        method.metadata.inputArguments[index]?.name ??
        "",
      status: normalizeStatusCode(statusCode),
      diagnosticInfo: diagnostics?.[index],
    };
  });
};

export const argumentCodecMetadata = (
  nodeId: NodeIdString,
  metadata: MethodArgumentMetadata,
) => ({
  nodeId,
  valueRank: metadata.valueRank,
  arrayDimensions: metadata.arrayDimensions,
  raw: {
    declaredDataType: metadata.unsafeRaw.declaredDataType,
    builtInDataType: metadata.unsafeRaw.builtInDataType,
  },
});

const emptyMapping = (
  operation: string,
  nodeId: NodeIdString,
  arguments_: ReadonlyArray<MethodArgumentMetadata>,
) =>
  arguments_.length === 0
    ? []
    : configurationError({
        operation,
        nodeId,
        cause: "Method arguments must be declared explicitly in v1",
      });

const explicitMapping = (
  _operation: string,
  _nodeId: NodeIdString,
  arguments_: ReadonlyArray<MethodArgumentMetadata>,
  fields: MethodArgRecord,
) => {
  const usedIndexes = new Set<number>();
  const mapping: Array<MethodArgumentMapping> = [];
  for (const [key, arg] of Object.entries(fields)) {
    const selector = arg.selector ?? { _tag: "Name" as const, name: key };
    const matches =
      selector._tag === "Index"
        ? [selector.index]
        : arguments_
            .map((argument, index) =>
              argument.name === selector.name ? index : undefined,
            )
            .filter((index): index is number => index !== undefined);
    const index = matches[0] ?? -1;
    if (!Number.isInteger(index) || index < 0 || index >= arguments_.length) {
      return configurationError({
        operation: "method.argumentMap",
        cause: `Argument selector for ${key} did not resolve`,
      });
    }
    if (matches.length !== 1) {
      return configurationError({
        operation: "method.argumentMap",
        cause: `Argument selector for ${key} did not resolve exactly once`,
      });
    }
    if (usedIndexes.has(index)) {
      return configurationError({
        operation: "method.argumentMap",
        cause: "Two public keys target the same argument",
      });
    }
    usedIndexes.add(index);
    mapping.push({
      key,
      index,
      argumentName: arguments_[index]!.name,
      arg,
    });
  }
  if (usedIndexes.size !== arguments_.length) {
    return configurationError({
      operation: "method.argumentMap",
      cause: "Method arguments must cover every OPC UA argument",
    });
  }
  return mapping;
};

const validateInputKeys = (
  method: MethodInfo,
  inputRecord: Record<string, unknown>,
  input: unknown,
) => {
  const expected = new Set(
    method.metadata.inputMapping.map((mapping) => mapping.key),
  );
  for (const key of expected) {
    if (!(key in inputRecord)) {
      const mapping = method.metadata.inputMapping.find((m) => m.key === key);
      return methodInputError({
        objectId: method.objectId,
        methodId: method.methodId,
        input,
        phase: "MissingInputKey",
        argumentKey: key,
        argumentIndex: mapping?.index,
      });
    }
  }
  for (const key of Object.keys(inputRecord)) {
    if (!expected.has(key)) {
      return methodInputError({
        objectId: method.objectId,
        methodId: method.methodId,
        input,
        phase: "UnknownInputKey",
        argumentKey: key,
      });
    }
  }
  return undefined;
};

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;
