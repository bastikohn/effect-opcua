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
import { Effect, Result } from "effect";

import { runChunked, type BatchOptions } from "./batch.js";
import type { NodeIdString } from "./capabilities.js";
import { Codec, dynamic, type CodecType, type OpcuaCodec } from "./codecs.js";
import {
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaMethodInputError,
  OpcuaMethodNotExecutableError,
  OpcuaServiceError,
} from "./errors.js";
import {
  isGood,
  normalizeLocalizedText,
  normalizeNodeId,
  normalizeStatusCode,
  type OpcuaDynamicValue,
  type OpcuaLocalizedTextInfo,
  type OpcuaNodeIdInfo,
  type OpcuaStatusInfo,
} from "./normalize.js";
import type { OpcuaStructureRuntime } from "./structure-runtime.js";

export type MethodArgSelector =
  | { readonly _tag: "Name"; readonly name: string }
  | { readonly _tag: "Index"; readonly index: number };

export type MethodArg<A> = {
  readonly _tag: "MethodArg";
  readonly codec: OpcuaCodec<A>;
  readonly selector?: MethodArgSelector;
  readonly selectorError?: string;
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
    : Record<string, OpcuaDynamicValue>
  : Record<string, OpcuaDynamicValue>;

export type OutputOfMethodDef<Spec> = Spec extends {
  readonly output?: infer Output;
}
  ? Output extends MethodArgRecord
    ? { readonly [Key in keyof Output]: ArgType<Output[Key]> }
    : Record<string, OpcuaDynamicValue>
  : Record<string, OpcuaDynamicValue>;

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

export type MethodCallOptions = {
  readonly includeRaw?: boolean;
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

export type MethodHandle<
  Input = Record<string, OpcuaDynamicValue>,
  Output = Record<string, OpcuaDynamicValue>,
  ObjectId extends NodeIdString = NodeIdString,
  MethodId extends NodeIdString = NodeIdString,
> = {
  readonly _tag: "MethodHandle";
  readonly objectId: ObjectId;
  readonly methodId: MethodId;
  readonly def: MethodDef<
    ObjectId,
    MethodId,
    MethodArgRecord | undefined,
    MethodArgRecord | undefined
  >;
  readonly metadata: MethodMetadata;
  readonly unsafeRaw: {
    readonly objectId: NodeId;
    readonly methodId: NodeId;
    readonly inputArguments: ReadonlyArray<Argument>;
    readonly outputArguments: ReadonlyArray<Argument>;
  };
  readonly call: (
    input: Input,
    options?: MethodCallOptions,
  ) => Effect.Effect<
    MethodCallResult<Output, ObjectId, MethodId>,
    | OpcuaConfigurationError
    | OpcuaServiceError
    | OpcuaMethodInputError
    | OpcuaMethodNotExecutableError
    | OpcuaAccessDeniedError
  >;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMethodHandle = MethodHandle<
  any,
  any,
  NodeIdString,
  NodeIdString
>;

export type MethodCallEntry<H extends AnyMethodHandle> = {
  readonly handle: H;
  readonly input: InputOfMethodHandle<H>;
  readonly options?: MethodCallOptions;
};

export type InputOfMethodHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends MethodHandle<infer Input, any, any, any> ? Input : never;

export type OutputOfMethodHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends MethodHandle<any, infer Output, any, any> ? Output : never;

export type ObjectIdOfMethodHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends MethodHandle<any, any, infer ObjectId, any> ? ObjectId : never;

export type MethodIdOfMethodHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends MethodHandle<any, any, any, infer MethodId> ? MethodId : never;

type MethodPreflight = {
  readonly request: CallMethodRequestLike;
  readonly includeRaw: boolean;
};

type MethodHandleInfo = {
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
): MethodArg<CodecType<C>> => ({
  _tag: "MethodArg",
  codec: (options.codec ?? dynamic()) as unknown as OpcuaCodec<CodecType<C>>,
  selector:
    options.name !== undefined
      ? { _tag: "Name", name: options.name }
      : options.index !== undefined
        ? { _tag: "Index", index: options.index }
        : undefined,
  selectorError:
    options.name !== undefined && options.index !== undefined
      ? "name and index are mutually exclusive"
      : undefined,
});

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

export const makeMethodHandle = <const Spec extends AnyMethodDef>(
  session: ClientSession,
  spec: Spec,
  metadata: MethodMetadata,
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    const objectId = yield* coerceNodeIdOrFail(
      "handle.method.objectId",
      spec.objectId,
    );
    const methodId = yield* coerceNodeIdOrFail(
      "handle.method.methodId",
      spec.methodId,
    );
    if (!metadata.executable || metadata.userExecutable === false) {
      return yield* Effect.fail(
        new OpcuaMethodNotExecutableError({
          objectId: spec.objectId,
          methodId: spec.methodId,
          executable: metadata.executable,
          userExecutable: metadata.userExecutable,
        }),
      );
    }
    const handle = {
      _tag: "MethodHandle" as const,
      objectId: spec.objectId,
      methodId: spec.methodId,
      def: spec,
      metadata,
      [methodHandleSession]: session,
      [methodHandleStructureRuntime]: structureRuntime,
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
      call: (input: InputOfMethodDef<Spec>, options?: MethodCallOptions) =>
        callHandle(session, handle, input, structureRuntime, options),
    } as unknown as MethodHandle<
      InputOfMethodDef<Spec>,
      OutputOfMethodDef<Spec>,
      Spec["objectId"],
      Spec["methodId"]
    >;
    return handle;
  });

const methodHandleSession = Symbol("@effect-opcua/client/MethodSession");
const methodHandleStructureRuntime = Symbol(
  "@effect-opcua/client/MethodStructureRuntime",
);

export const getMethodHandleSession = (handle: unknown) =>
  (handle as { readonly [methodHandleSession]?: ClientSession })[
    methodHandleSession
  ];

export const getMethodHandleStructureRuntime = (handle: unknown) =>
  (
    handle as {
      readonly [methodHandleStructureRuntime]?: OpcuaStructureRuntime;
    }
  )[methodHandleStructureRuntime];

export const callHandle = <
  Input,
  Output,
  ObjectId extends NodeIdString,
  MethodId extends NodeIdString,
>(
  session: ClientSession,
  handle: MethodHandle<Input, Output, ObjectId, MethodId>,
  input: Input,
  structureRuntime: OpcuaStructureRuntime,
  options?: MethodCallOptions,
) =>
  Effect.gen(function* () {
    const preflight = yield* preflightMethodCall(
      handle,
      input,
      structureRuntime,
      options,
    );
    const result = yield* Effect.tryPromise({
      try: () => session.call(preflight.request),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "call",
          nodeId: handle.methodId,
          cause,
        }),
    });
    return yield* methodResultFromRaw(
      handle,
      preflight,
      result,
      structureRuntime,
    );
  });

export const callMethods = (
  session: ClientSession,
  entries: ReadonlyArray<MethodCallEntry<AnyMethodHandle>>,
  structureRuntime: OpcuaStructureRuntime,
  options?: BatchOptions,
) =>
  Effect.gen(function* () {
    const preflights = yield* Effect.forEach(entries, (entry) =>
      preflightMethodCall(
        entry.handle,
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
            new OpcuaServiceError({
              operation: "call",
              cause,
            }),
        });
        if (results.length !== chunk.length) {
          return yield* Effect.fail(
            new OpcuaServiceError({
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
        entry.handle,
        preflights[index]!,
        rawResults[index]!,
        structureRuntime,
      ),
    );
  });

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
      : defaultMapping(arguments_);
    if (mapping instanceof OpcuaConfigurationError) {
      return yield* Effect.fail(
        new OpcuaConfigurationError({
          operation,
          nodeId,
          cause: mapping.cause,
        }),
      );
    }
    for (const entry of mapping) {
      const argument = arguments_[entry.index]!;
      yield* Codec.validateMetadata(
        entry.arg.codec,
        argumentCodecMetadata(nodeId, argument),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new OpcuaConfigurationError({
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
  return new OpcuaConfigurationError({
    operation,
    nodeId,
    cause: "method boolean attribute is unreadable",
  });
};

export const preflightMethodCall = <
  Input,
  Output,
  ObjectId extends NodeIdString,
  MethodId extends NodeIdString,
>(
  handle: MethodHandle<Input, Output, ObjectId, MethodId>,
  input: Input,
  structureRuntime: OpcuaStructureRuntime,
  options?: MethodCallOptions,
): Effect.Effect<MethodPreflight, OpcuaMethodInputError | OpcuaServiceError> =>
  Effect.gen(function* () {
    if (
      handle.metadata.inputMapping.some((mapping) =>
        Codec.requiresStructureRuntime(mapping.arg.codec),
      ) ||
      handle.metadata.outputMapping.some((mapping) =>
        Codec.requiresStructureRuntime(mapping.arg.codec),
      )
    ) {
      yield* structureRuntime.ensureInitialized();
    }
    const inputRecord = objectRecord(input);
    if (!inputRecord) {
      return yield* Effect.fail(
        new OpcuaMethodInputError({
          objectId: handle.objectId,
          methodId: handle.methodId,
          input,
          phase: "ArgumentMapping",
          cause: "input must be an object",
        }),
      );
    }
    const keyError = validateInputKeys(handle, inputRecord, input);
    if (keyError) return yield* Effect.fail(keyError);

    const inputArguments: Array<Variant> = [];
    for (const mapping of handle.metadata.inputMapping) {
      const argument = handle.metadata.inputArguments[mapping.index]!;
      const rawValue = inputRecord[mapping.key];
      const variant = yield* Codec.encode(
        mapping.arg.codec,
        rawValue,
        argumentCodecMetadata(handle.methodId, argument),
        structureRuntime,
      ).pipe(
        Effect.mapError(
          (error) =>
            new OpcuaMethodInputError({
              objectId: handle.objectId,
              methodId: handle.methodId,
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
        objectId: handle.unsafeRaw.objectId,
        methodId: handle.unsafeRaw.methodId,
        inputArguments,
      },
      includeRaw: options?.includeRaw ?? handle.def.includeRaw ?? false,
    };
  });

export const methodResultFromRaw = <
  Input,
  Output,
  ObjectId extends NodeIdString,
  MethodId extends NodeIdString,
>(
  handle: MethodHandle<Input, Output, ObjectId, MethodId>,
  preflight: MethodPreflight,
  result: CallMethodResult,
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    const unsafeRaw = preflight.includeRaw
      ? { request: preflight.request, result }
      : undefined;
    const status = normalizeStatusCode(result.statusCode);
    const inputArgumentResults = normalizeInputArgumentResults(handle, result);
    if (!isGood(result.statusCode)) {
      return {
        _tag: "NonGoodStatus",
        objectId: handle.objectId,
        methodId: handle.methodId,
        status,
        inputArgumentResults,
        unsafeRaw,
      } as MethodCallResult<Output, ObjectId, MethodId>;
    }

    const output = yield* Effect.result(
      outputObjectFromResult(handle, result, structureRuntime),
    );
    if (Result.isFailure(output)) {
      return {
        _tag: "DecodeError",
        objectId: handle.objectId,
        methodId: handle.methodId,
        status,
        error: output.failure,
        unsafeRaw,
      } as MethodCallResult<Output, ObjectId, MethodId>;
    }
    return {
      _tag: "Called",
      objectId: handle.objectId,
      methodId: handle.methodId,
      output: output.success as Output,
      status,
      inputArgumentResults,
      unsafeRaw,
    } as MethodCallResult<Output, ObjectId, MethodId>;
  }) as Effect.Effect<MethodCallResult<Output, ObjectId, MethodId>>;

const defaultMapping = (arguments_: ReadonlyArray<MethodArgumentMetadata>) => {
  const seenNames = new Set<string>();
  const mapping: Array<MethodArgumentMapping> = [];
  for (let index = 0; index < arguments_.length; index++) {
    const argumentName = arguments_[index]!.name;
    if (!argumentName || seenNames.has(argumentName)) {
      return new OpcuaConfigurationError({
        operation: "handle.method.argumentMap",
        cause: "Argument names must be non-empty and unique",
      });
    }
    seenNames.add(argumentName);
    mapping.push({
      key: argumentName,
      index,
      argumentName,
      arg: makeMethodArg(),
    });
  }
  return mapping;
};

const explicitMapping = (
  _operation: string,
  _nodeId: NodeIdString,
  arguments_: ReadonlyArray<MethodArgumentMetadata>,
  fields: MethodArgRecord,
) => {
  const usedIndexes = new Set<number>();
  const mapping: Array<MethodArgumentMapping> = [];
  for (const [key, arg] of Object.entries(fields)) {
    if (arg.selectorError) {
      return new OpcuaConfigurationError({
        operation: "handle.method.argumentMap",
        cause: `Argument field ${key}: ${arg.selectorError}`,
      });
    }
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
      return new OpcuaConfigurationError({
        operation: "handle.method.argumentMap",
        cause: `Argument selector for ${key} did not resolve`,
      });
    }
    if (matches.length !== 1) {
      return new OpcuaConfigurationError({
        operation: "handle.method.argumentMap",
        cause: `Argument selector for ${key} did not resolve exactly once`,
      });
    }
    if (usedIndexes.has(index)) {
      return new OpcuaConfigurationError({
        operation: "handle.method.argumentMap",
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
    return new OpcuaConfigurationError({
      operation: "handle.method.argumentMap",
      cause: "Method arguments must cover every OPC UA argument",
    });
  }
  return mapping;
};

const validateInputKeys = (
  handle: MethodHandleInfo,
  inputRecord: Record<string, unknown>,
  input: unknown,
) => {
  const expected = new Set(
    handle.metadata.inputMapping.map((mapping) => mapping.key),
  );
  for (const key of expected) {
    if (!(key in inputRecord)) {
      const mapping = handle.metadata.inputMapping.find((m) => m.key === key);
      return new OpcuaMethodInputError({
        objectId: handle.objectId,
        methodId: handle.methodId,
        input,
        phase: "MissingInputKey",
        argumentKey: key,
        argumentIndex: mapping?.index,
      });
    }
  }
  for (const key of Object.keys(inputRecord)) {
    if (!expected.has(key)) {
      return new OpcuaMethodInputError({
        objectId: handle.objectId,
        methodId: handle.methodId,
        input,
        phase: "UnknownInputKey",
        argumentKey: key,
      });
    }
  }
  return undefined;
};

const outputObjectFromResult = (
  handle: MethodHandleInfo,
  result: CallMethodResult,
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    const output: Record<string, unknown> = {};
    const outputArguments = result.outputArguments ?? [];
    for (const mapping of handle.metadata.outputMapping) {
      const argument = handle.metadata.outputArguments[mapping.index]!;
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
  handle: MethodHandleInfo,
  result: CallMethodResult,
) => {
  const statuses = result.inputArgumentResults;
  if (!statuses || statuses.length === 0) return undefined;
  const diagnostics = (
    result as { readonly inputArgumentDiagnosticInfos?: ReadonlyArray<unknown> }
  ).inputArgumentDiagnosticInfos;
  return statuses.map((statusCode: StatusCode, index: number) => {
    const mapping = handle.metadata.inputMapping.find(
      (candidate) => candidate.index === index,
    );
    return {
      key: mapping?.key ?? String(index),
      index,
      argumentName:
        mapping?.argumentName ??
        handle.metadata.inputArguments[index]?.name ??
        "",
      status: normalizeStatusCode(statusCode),
      diagnosticInfo: diagnostics?.[index],
    };
  });
};

const objectRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const coerceNodeIdOrFail = (operation: string, nodeId: unknown) =>
  Effect.try({
    try: () => coerceNodeId(nodeId),
    catch: (cause) =>
      new OpcuaConfigurationError({ operation, nodeId: String(nodeId), cause }),
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
