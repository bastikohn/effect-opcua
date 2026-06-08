import {
  DataType,
  coerceNodeId,
  type Argument,
  type CallMethodRequestLike,
  type CallMethodResult,
  type ClientSession,
  type DataValue,
  type NodeId,
  type StatusCode,
  type Variant,
} from "node-opcua";
import { Effect } from "effect";

import { runChunked, type BatchOptions } from "./internal/batch.js";
import type { NodeIdString } from "./internal/common/node-id.js";
import {
  Codec,
  dynamic,
  type CodecType,
  type OpcuaCodec,
} from "./internal/values/codec.js";
import {
  configurationError,
  isConfigurationError,
  methodInputError,
  methodNotExecutableError,
  serviceError,
  OpcuaConfigurationError,
  OpcuaMethodInputError,
  OpcuaServiceError,
} from "./OpcuaError.js";
import {
  isGood,
  normalizeLocalizedText,
  normalizeNodeId,
  normalizeStatusCode,
  type OpcuaDynamicValue,
  type OpcuaLocalizedTextInfo,
  type OpcuaNodeIdInfo,
  type OpcuaStatusInfo,
} from "./internal/values/normalize.js";
import { resultFromStatusAndDecode } from "./internal/values/result.js";
import type { OpcuaStructureRuntime } from "./internal/structures/runtime.js";
import { isPlainRecord, isRecord } from "./internal/common/predicates.js";
import type { MethodCallOptions } from "./internal/session-operations.js";

export type { MethodCallOptions };

export type MethodArgSelector =
  | { readonly _tag: "Name"; readonly name: string }
  | { readonly _tag: "Index"; readonly index: number };

export type MethodArg<A> = {
  readonly _tag: "MethodArg";
  readonly codec: OpcuaCodec<unknown>;
  readonly selector?: MethodArgSelector;
  readonly _A?: A;
};

export type MethodArgRecord = Readonly<Record<string, MethodArg<unknown>>>;

export type MethodDef<
  ObjectId extends string = string,
  MethodId extends string = string,
  Input extends MethodArgRecord | undefined = MethodArgRecord | undefined,
  Output extends MethodArgRecord | undefined = MethodArgRecord | undefined,
> = {
  readonly _tag: "MethodDef";
  readonly objectId: ObjectId;
  readonly methodId: MethodId;
  readonly input?: Input;
  readonly output?: Output;
  readonly includeRaw?: boolean;
};

export type AnyMethodDef = MethodDef<
  string,
  string,
  MethodArgRecord | undefined,
  MethodArgRecord | undefined
>;

export type ArgType<Arg> = Arg extends MethodArg<infer A> ? A : never;

export type InputOfMethodDef<Spec> = Spec extends {
  readonly input?: infer Input;
}
  ? Input extends MethodArgRecord
    ? { readonly [Key in keyof Input]: ArgType<Input[Key]> }
    : Record<never, never>
  : Record<never, never>;

export type OutputOfMethodDef<Spec> = Spec extends {
  readonly output?: infer Output;
}
  ? Output extends MethodArgRecord
    ? { readonly [Key in keyof Output]: ArgType<Output[Key]> }
    : Record<never, never>
  : Record<never, never>;

export type MethodMetadata = {
  readonly objectId: NodeIdString;
  readonly methodId: NodeIdString;
  readonly executable: boolean;
  readonly userExecutable?: boolean;
  readonly inputArguments: ReadonlyArray<MethodArgumentMetadata>;
  readonly outputArguments: ReadonlyArray<MethodArgumentMetadata>;
  readonly inputMapping: ReadonlyArray<MethodArgumentMapping>;
  readonly outputMapping: ReadonlyArray<MethodArgumentMapping>;
};

export type MethodArgumentMapping = {
  readonly key: string;
  readonly index: number;
  readonly argumentName: string;
  readonly arg: MethodArg<unknown>;
};

export type MethodArgumentMetadata = {
  readonly name: string;
  readonly description?: OpcuaLocalizedTextInfo;
  readonly declaredDataType: OpcuaNodeIdInfo;
  readonly builtInDataType: string;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly unsafeRaw: {
    readonly argument: Argument;
    readonly declaredDataType: NodeId;
    readonly builtInDataType: DataType;
  };
};

export type MethodCallRaw = {
  readonly request: CallMethodRequestLike;
  readonly result: CallMethodResult;
};

export type MethodArgumentResult = {
  readonly key: string;
  readonly index: number;
  readonly argumentName: string;
  readonly status: OpcuaStatusInfo;
  readonly diagnosticInfo?: unknown;
};

export type MethodCallResult<
  Output,
  ObjectId extends string,
  MethodId extends string,
> =
  | {
      readonly _tag: "Called";
      readonly objectId: ObjectId;
      readonly methodId: MethodId;
      readonly output: Output;
      readonly status: OpcuaStatusInfo;
      readonly inputArgumentResults?: ReadonlyArray<MethodArgumentResult>;
      readonly unsafeRaw?: MethodCallRaw;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly objectId: ObjectId;
      readonly methodId: MethodId;
      readonly status: OpcuaStatusInfo;
      readonly inputArgumentResults?: ReadonlyArray<MethodArgumentResult>;
      readonly unsafeRaw?: MethodCallRaw;
    }
  | {
      readonly _tag: "DecodeError";
      readonly objectId: ObjectId;
      readonly methodId: MethodId;
      readonly status: OpcuaStatusInfo;
      readonly error: unknown;
      readonly unsafeRaw?: MethodCallRaw;
    };

export type ResolvedMethod<Spec extends AnyMethodDef = AnyMethodDef> = {
  readonly _tag: "ResolvedMethod";
  readonly objectId: Spec["objectId"];
  readonly methodId: Spec["methodId"];
  readonly def: Spec;
  readonly metadata: MethodMetadata;
  readonly unsafeRaw: {
    readonly objectId: NodeId;
    readonly methodId: NodeId;
    readonly inputArguments: ReadonlyArray<Argument>;
    readonly outputArguments: ReadonlyArray<Argument>;
  };
};

export type CallManyItem<Def extends AnyMethodDef = AnyMethodDef> =
  | readonly [def: Def, input: InputOfMethodDef<Def>]
  | readonly [
      def: Def,
      input: InputOfMethodDef<Def>,
      options: MethodCallOptions,
    ];

export type AnyCallManyRecord = Record<
  string,
  | readonly [AnyMethodDef, unknown]
  | readonly [AnyMethodDef, unknown, MethodCallOptions]
>;

export type CallManyInput<Items extends AnyCallManyRecord> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends AnyMethodDef,
    unknown,
    MethodCallOptions,
  ]
    ? readonly [
        def: Def,
        input: InputOfMethodDef<Def>,
        options: MethodCallOptions,
      ]
    : Items[Key] extends readonly [infer Def extends AnyMethodDef, unknown]
      ? readonly [def: Def, input: InputOfMethodDef<Def>]
      : never;
};

export type CallManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends AnyMethodDef,
    unknown,
    ...ReadonlyArray<unknown>,
  ]
    ? MethodCallResult<OutputOfMethodDef<Def>, Def["objectId"], Def["methodId"]>
    : never;
};

export type AnyResolvedMethod = ResolvedMethod<AnyMethodDef>;

export type MethodCallEntry<M extends AnyResolvedMethod> = {
  readonly method: M;
  readonly input: InputOfResolvedMethod<M>;
  readonly options?: MethodCallOptions;
};

export type InputOfResolvedMethod<M> =
  M extends ResolvedMethod<infer Spec> ? InputOfMethodDef<Spec> : never;

export type OutputOfResolvedMethod<M> =
  M extends ResolvedMethod<infer Spec> ? OutputOfMethodDef<Spec> : never;

export type ObjectIdOfResolvedMethod<M> =
  M extends ResolvedMethod<infer Spec> ? Spec["objectId"] : never;

export type MethodIdOfResolvedMethod<M> =
  M extends ResolvedMethod<infer Spec> ? Spec["methodId"] : never;

type MethodPreflight = {
  readonly request: CallMethodRequestLike;
  readonly includeRaw: boolean;
};

type MethodInfo = {
  readonly objectId: NodeIdString;
  readonly methodId: NodeIdString;
  readonly metadata: MethodMetadata;
};

export const makeMethodArg = <
  C extends OpcuaCodec<unknown> = OpcuaCodec<OpcuaDynamicValue>,
>(
  options: {
    readonly codec?: C;
    readonly name?: string;
    readonly index?: number;
  } = {},
): MethodArg<CodecType<C>> => {
  if (options.name !== undefined && options.index !== undefined) {
    throw new TypeError("name and index are mutually exclusive");
  }
  return {
    _tag: "MethodArg",
    codec: (options.codec ?? dynamic()) as unknown as OpcuaCodec<unknown>,
    selector:
      options.name !== undefined
        ? { _tag: "Name", name: options.name }
        : options.index !== undefined
          ? { _tag: "Index", index: options.index }
          : undefined,
  };
};

export const arg = makeMethodArg;

export const makeMethodDef = <
  const ObjectId extends string,
  const MethodId extends string,
  const Input extends MethodArgRecord | undefined = undefined,
  const Output extends MethodArgRecord | undefined = undefined,
>(options: {
  readonly objectId: ObjectId;
  readonly methodId: MethodId;
  readonly input?: Input;
  readonly output?: Output;
  readonly includeRaw?: boolean;
}): MethodDef<ObjectId, MethodId, Input, Output> => ({
  _tag: "MethodDef",
  objectId: options.objectId,
  methodId: options.methodId,
  input: options.input,
  output: options.output,
  includeRaw: options.includeRaw,
});

export const make = makeMethodDef;

export const resolveMethod = <const Spec extends AnyMethodDef>(
  spec: Spec,
  metadata: MethodMetadata,
) =>
  Effect.gen(function* () {
    const objectId = yield* coerceNodeIdOrFail(
      "method.objectId",
      spec.objectId,
    );
    const methodId = yield* coerceNodeIdOrFail(
      "method.methodId",
      spec.methodId,
    );
    if (!metadata.executable || metadata.userExecutable === false) {
      return yield* Effect.fail(
        methodNotExecutableError({
          objectId: spec.objectId,
          methodId: spec.methodId,
          executable: metadata.executable,
          userExecutable: metadata.userExecutable,
        }),
      );
    }
    return {
      _tag: "ResolvedMethod" as const,
      objectId: spec.objectId,
      methodId: spec.methodId,
      def: spec,
      metadata,
      unsafeRaw: {
        objectId,
        methodId,
        inputArguments: metadata.inputArguments.map(
          (argument) => argument.unsafeRaw.argument,
        ),
        outputArguments: metadata.outputArguments.map(
          (argument) => argument.unsafeRaw.argument,
        ),
      },
    } as ResolvedMethod<Spec>;
  });

export const callResolvedMethod = <const Spec extends AnyMethodDef>(
  session: ClientSession,
  method: ResolvedMethod<Spec>,
  input: InputOfMethodDef<Spec>,
  structureRuntime: OpcuaStructureRuntime,
  options?: MethodCallOptions,
) =>
  Effect.gen(function* () {
    const preflight = yield* preflightMethodCall(
      method,
      input,
      structureRuntime,
      options,
    );
    const result = yield* Effect.tryPromise({
      try: () => session.call(preflight.request),
      catch: (cause) =>
        serviceError({
          operation: "call",
          nodeId: method.methodId,
          cause,
        }),
    });
    return yield* methodResultFromRaw(
      method,
      preflight,
      result,
      structureRuntime,
    );
  });

export const callMethods = (
  session: ClientSession,
  entries: ReadonlyArray<MethodCallEntry<AnyResolvedMethod>>,
  structureRuntime: OpcuaStructureRuntime,
  options?: BatchOptions,
) =>
  Effect.gen(function* () {
    const preflights = yield* Effect.forEach(entries, (entry) =>
      preflightMethodCall(
        entry.method,
        entry.input,
        structureRuntime,
        entry.options,
      ),
    );
    const rawResults = yield* runChunked(preflights, options, (chunk) =>
      Effect.gen(function* () {
        const results = yield* Effect.tryPromise({
          try: () => session.call(chunk.map((preflight) => preflight.request)),
          catch: (cause) =>
            serviceError({
              operation: "call",
              cause,
            }),
        });
        if (results.length !== chunk.length) {
          return yield* Effect.fail(
            serviceError({
              operation: "call",
              cause: `Expected ${chunk.length} CallMethodResults, got ${results.length}`,
            }),
          );
        }
        return results;
      }),
    );
    return yield* Effect.forEach(entries, (entry, index) =>
      methodResultFromRaw(
        entry.method,
        preflights[index]!,
        rawResults[index]!,
        structureRuntime,
      ),
    );
  });

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

export const methodResultFromRaw = <const Spec extends AnyMethodDef>(
  method: ResolvedMethod<Spec>,
  preflight: MethodPreflight,
  result: CallMethodResult,
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    const unsafeRaw = preflight.includeRaw
      ? { request: preflight.request, result }
      : undefined;
    const status = normalizeStatusCode(result.statusCode);
    const inputArgumentResults = normalizeInputArgumentResults(method, result);
    return yield* resultFromStatusAndDecode<
      Record<string, unknown>,
      typeof status,
      MethodCallResult<
        OutputOfMethodDef<Spec>,
        Spec["objectId"],
        Spec["methodId"]
      >
    >({
      statusCode: result.statusCode,
      status,
      decode: outputObjectFromResult(method, result, structureRuntime),
      nonGoodStatus: (status) => ({
        _tag: "NonGoodStatus",
        objectId: method.objectId,
        methodId: method.methodId,
        status,
        inputArgumentResults,
        unsafeRaw,
      }),
      decodeError: (error, status) => ({
        _tag: "DecodeError",
        objectId: method.objectId,
        methodId: method.methodId,
        status,
        error,
        unsafeRaw,
      }),
      value: (output) => ({
        _tag: "Called",
        objectId: method.objectId,
        methodId: method.methodId,
        output: output as OutputOfMethodDef<Spec>,
        status,
        inputArgumentResults,
        unsafeRaw,
      }),
    });
  }) as Effect.Effect<
    MethodCallResult<
      OutputOfMethodDef<Spec>,
      Spec["objectId"],
      Spec["methodId"]
    >
  >;

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

const outputObjectFromResult = (
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

const normalizeInputArgumentResults = (
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

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const coerceNodeIdOrFail = (operation: string, nodeId: unknown) =>
  Effect.try({
    try: () => coerceNodeId(nodeId),
    catch: (cause) =>
      configurationError({ operation, nodeId: String(nodeId), cause }),
  });

const argumentCodecMetadata = (
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
