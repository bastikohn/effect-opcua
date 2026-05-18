import {
  AttributeIds,
  DataType,
  NodeId,
  coerceNodeId,
  type Argument,
  type CallMethodRequestLike,
  type CallMethodResult,
  type ClientSession,
  type DataValue,
  type StatusCode,
  type Variant,
} from "node-opcua";
import { Effect, Schema } from "effect";

import { Capabilities, type NodeIdString } from "./capabilities.js";
import {
  decodeDynamicValue,
  decodeWithSchema,
  encodeDynamicValue,
  encodeWithSchema,
  makeVariantFromMetadata,
  type AnySchema,
  type SchemaType,
} from "./codecs.js";
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
  type OpcuaDynamicValueMetadata,
} from "./normalize.js";

export type OpcuaMethodArgumentMap = Readonly<Record<string, string | number>>;

export type OpcuaMethodSpec<
  ObjectId extends NodeIdString = NodeIdString,
  MethodId extends NodeIdString = NodeIdString,
  InputSchema extends AnySchema | undefined = AnySchema | undefined,
  OutputSchema extends AnySchema | undefined = AnySchema | undefined,
> = {
  readonly objectId: ObjectId;
  readonly methodId: MethodId;
  readonly inputSchema?: InputSchema;
  readonly outputSchema?: OutputSchema;
  readonly inputArgumentMap?: OpcuaMethodArgumentMap;
  readonly outputArgumentMap?: OpcuaMethodArgumentMap;
  readonly includeRaw?: boolean;
};

export type InputOfMethodSpec<Spec> = Spec extends {
  readonly inputSchema?: infer S;
}
  ? S extends AnySchema
    ? SchemaType<S>
    : Record<string, OpcuaDynamicValue>
  : Record<string, OpcuaDynamicValue>;

export type OutputOfMethodSpec<Spec> = Spec extends {
  readonly outputSchema?: infer S;
}
  ? S extends AnySchema
    ? SchemaType<S>
    : Record<string, OpcuaDynamicValue>
  : Record<string, OpcuaDynamicValue>;

export type OpcuaMethodMetadata = {
  readonly objectId: NodeIdString;
  readonly methodId: NodeIdString;
  readonly executable: boolean;
  readonly userExecutable?: boolean;
  readonly inputArguments: ReadonlyArray<OpcuaMethodArgumentMetadata>;
  readonly outputArguments: ReadonlyArray<OpcuaMethodArgumentMetadata>;
  readonly inputMapping: ReadonlyArray<OpcuaMethodArgumentMapping>;
  readonly outputMapping: ReadonlyArray<OpcuaMethodArgumentMapping>;
};

export type OpcuaMethodArgumentMapping = {
  readonly key: string;
  readonly index: number;
  readonly argumentName: string;
};

export type OpcuaMethodArgumentMetadata = {
  readonly name: string;
  readonly description?: OpcuaLocalizedTextInfo;
  readonly dataTypeNodeId: OpcuaNodeIdInfo;
  readonly dataType: string;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly raw: {
    readonly argument: Argument;
    readonly dataType: NodeId;
    readonly builtInDataType: DataType;
  };
};

export type OpcuaMethodCallRaw = {
  readonly request: CallMethodRequestLike;
  readonly result: CallMethodResult;
};

export type OpcuaMethodArgumentResult = {
  readonly key: string;
  readonly index: number;
  readonly argumentName: string;
  readonly status: OpcuaStatusInfo;
  readonly diagnosticInfo?: unknown;
};

export type OpcuaMethodCallOptions = {
  readonly includeRaw?: boolean;
};

export type OpcuaMethodCallResult<
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
      readonly inputArgumentResults?: ReadonlyArray<OpcuaMethodArgumentResult>;
      readonly raw?: OpcuaMethodCallRaw;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly objectId: ObjectId;
      readonly methodId: MethodId;
      readonly status: OpcuaStatusInfo;
      readonly inputArgumentResults?: ReadonlyArray<OpcuaMethodArgumentResult>;
      readonly raw?: OpcuaMethodCallRaw;
    }
  | {
      readonly _tag: "DecodeError";
      readonly objectId: ObjectId;
      readonly methodId: MethodId;
      readonly status: OpcuaStatusInfo;
      readonly error: Schema.SchemaError;
      readonly raw?: OpcuaMethodCallRaw;
    };

export type OpcuaMethodHandle<
  Input = Record<string, OpcuaDynamicValue>,
  Output = Record<string, OpcuaDynamicValue>,
  ObjectId extends NodeIdString = NodeIdString,
  MethodId extends NodeIdString = NodeIdString,
> = {
  readonly objectId: ObjectId;
  readonly methodId: MethodId;
  readonly inputSchema?: AnySchema;
  readonly outputSchema?: AnySchema;
  readonly metadata: OpcuaMethodMetadata;
  readonly capabilities: typeof Capabilities.call;
  readonly raw: {
    readonly objectId: NodeId;
    readonly methodId: NodeId;
    readonly inputArguments: ReadonlyArray<Argument>;
    readonly outputArguments: ReadonlyArray<Argument>;
  };
  readonly call: (
    input: Input,
    options?: OpcuaMethodCallOptions,
  ) => Effect.Effect<
    OpcuaMethodCallResult<Output, ObjectId, MethodId>,
    | OpcuaConfigurationError
    | OpcuaServiceError
    | OpcuaMethodInputError
    | OpcuaMethodNotExecutableError
    | OpcuaAccessDeniedError
  >;
};

type MethodPreflight = {
  readonly request: CallMethodRequestLike;
  readonly includeRaw: boolean;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMethodHandle = OpcuaMethodHandle<any, any, string, string>;

export type MethodCallEntry<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends OpcuaMethodHandle<any, any, string, string>,
> = {
  readonly handle: H;
  readonly input: InputOfMethodHandle<H>;
};

export type InputOfMethodHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends OpcuaMethodHandle<infer Input, any, string, string> ? Input : never;
export type OutputOfMethodHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends OpcuaMethodHandle<any, infer Output, string, string>
    ? Output
    : never;
export type ObjectIdOfMethodHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends OpcuaMethodHandle<any, any, infer ObjectId, string>
    ? ObjectId
    : never;
export type MethodIdOfMethodHandle<H> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  H extends OpcuaMethodHandle<any, any, string, infer MethodId>
    ? MethodId
    : never;
export type MethodCallHandlesResult<Handles extends ReadonlyArray<unknown>> = {
  readonly [Index in keyof Handles]: OpcuaMethodCallResult<
    OutputOfMethodHandle<Handles[Index]>,
    ObjectIdOfMethodHandle<Handles[Index]>,
    MethodIdOfMethodHandle<Handles[Index]>
  >;
};

export const makeMethodHandle = <const Spec extends OpcuaMethodSpec>(
  session: ClientSession,
  spec: Spec,
) =>
  Effect.gen(function* () {
    const objectId = coerceNodeId(spec.objectId);
    const methodId = coerceNodeId(spec.methodId);
    const argumentDefinition = yield* Effect.tryPromise({
      try: () => session.getArgumentDefinition(methodId),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "methodHandle.getArgumentDefinition",
          nodeId: spec.methodId,
          cause,
        }),
    });
    const [executable, userExecutable] = yield* readExecutableAttributes(
      session,
      spec,
      methodId,
    );
    const inputArguments = yield* normalizeArguments(
      session,
      spec.methodId,
      "inputArguments",
      argumentDefinition.inputArguments ?? [],
    );
    const outputArguments = yield* normalizeArguments(
      session,
      spec.methodId,
      "outputArguments",
      argumentDefinition.outputArguments ?? [],
    );
    const inputMapping = yield* mappingOrFail(
      "methodHandle.inputArgumentMap",
      spec.methodId,
      inputArguments,
      spec.inputArgumentMap,
    );
    const outputMapping = yield* mappingOrFail(
      "methodHandle.outputArgumentMap",
      spec.methodId,
      outputArguments,
      spec.outputArgumentMap,
    );
    if (!executable || userExecutable === false) {
      return yield* Effect.fail(
        new OpcuaMethodNotExecutableError({
          objectId: spec.objectId,
          methodId: spec.methodId,
          executable,
          userExecutable,
        }),
      );
    }

    const metadata: OpcuaMethodMetadata = {
      objectId: spec.objectId,
      methodId: spec.methodId,
      executable,
      userExecutable,
      inputArguments,
      outputArguments,
      inputMapping,
      outputMapping,
    };
    const handle = {
      objectId: spec.objectId,
      methodId: spec.methodId,
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      includeRaw: spec.includeRaw,
      metadata,
      capabilities: Capabilities.call,
      raw: {
        objectId,
        methodId,
        inputArguments: argumentDefinition.inputArguments ?? [],
        outputArguments: argumentDefinition.outputArguments ?? [],
      },
      call: (
        input: InputOfMethodSpec<Spec>,
        options?: OpcuaMethodCallOptions,
      ) => callMethodHandle(session, handle, input, options),
    } as OpcuaMethodHandle<
      InputOfMethodSpec<Spec>,
      OutputOfMethodSpec<Spec>,
      Spec["objectId"],
      Spec["methodId"]
    >;
    return handle;
  });

export const callMethodHandle = <
  Input,
  Output,
  ObjectId extends NodeIdString,
  MethodId extends NodeIdString,
>(
  session: ClientSession,
  handle: OpcuaMethodHandle<Input, Output, ObjectId, MethodId>,
  input: Input,
  options?: OpcuaMethodCallOptions,
) =>
  Effect.gen(function* () {
    const preflight = yield* preflightMethodCall(handle, input, options);
    const result = yield* Effect.tryPromise({
      try: () => session.call(preflight.request),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "callMethod",
          nodeId: handle.methodId,
          cause,
        }),
    });
    return methodResultFromRaw(handle, preflight, result);
  });

export const callMethodHandles = <
  const Handles extends ReadonlyArray<OpcuaMethodHandle>,
>(
  session: ClientSession,
  entries: {
    readonly [Index in keyof Handles]: MethodCallEntry<Handles[Index]>;
  },
) =>
  Effect.gen(function* () {
    const preflights: Array<MethodPreflight> = [];
    for (const entry of entries) {
      preflights.push(yield* preflightMethodCall(entry.handle, entry.input));
    }
    const results = yield* Effect.tryPromise({
      try: () => session.call(preflights.map((preflight) => preflight.request)),
      catch: (cause) =>
        new OpcuaServiceError({ operation: "callMethodHandles", cause }),
    });
    return entries.map((entry, index) =>
      methodResultFromRaw(entry.handle, preflights[index]!, results[index]!),
    ) as MethodCallHandlesResult<Handles>;
  });

const preflightMethodCall = <
  Input,
  Output,
  ObjectId extends NodeIdString,
  MethodId extends NodeIdString,
>(
  handle: OpcuaMethodHandle<Input, Output, ObjectId, MethodId>,
  input: Input,
  options?: OpcuaMethodCallOptions,
): Effect.Effect<MethodPreflight, OpcuaMethodInputError> =>
  Effect.suspend(() => {
    const inputRecord = objectRecord(input);
    if (!inputRecord) {
      return Effect.fail(
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
    if (keyError) return Effect.fail(keyError);

    let encodedRecord: Record<string, unknown>;
    try {
      const encoded = handle.inputSchema
        ? encodeWithSchema(handle.inputSchema, input)
        : inputRecord;
      const record = objectRecord(encoded);
      if (!record) {
        throw new TypeError("encoded input must be an object");
      }
      encodedRecord = record;
    } catch (error) {
      return Effect.fail(
        new OpcuaMethodInputError({
          objectId: handle.objectId,
          methodId: handle.methodId,
          input,
          phase: handle.inputSchema ? "SchemaValidation" : "Encoding",
          error,
        }),
      );
    }

    const inputArguments: Array<Variant> = [];
    for (const mapping of handle.metadata.inputMapping) {
      const argument = handle.metadata.inputArguments[mapping.index]!;
      try {
        const value = handle.inputSchema
          ? encodedRecord[mapping.key]
          : encodeDynamicValue(
              encodedRecord[mapping.key],
              codecMetadata(argument),
            );
        inputArguments[mapping.index] = makeVariantFromMetadata(
          codecMetadata(argument),
          value,
        );
      } catch (error) {
        return Effect.fail(
          new OpcuaMethodInputError({
            objectId: handle.objectId,
            methodId: handle.methodId,
            input,
            phase: "Encoding",
            argumentKey: mapping.key,
            argumentIndex: mapping.index,
            error,
          }),
        );
      }
    }

    return Effect.succeed({
      request: {
        objectId: handle.raw.objectId,
        methodId: handle.raw.methodId,
        inputArguments,
      },
      includeRaw:
        options?.includeRaw ??
        (handle as { readonly includeRaw?: boolean }).includeRaw ??
        false,
    });
  });

const methodResultFromRaw = <
  Input,
  Output,
  ObjectId extends NodeIdString,
  MethodId extends NodeIdString,
>(
  handle: OpcuaMethodHandle<Input, Output, ObjectId, MethodId>,
  preflight: MethodPreflight,
  result: CallMethodResult,
): OpcuaMethodCallResult<Output, ObjectId, MethodId> => {
  const raw = preflight.includeRaw
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
      raw,
    };
  }

  try {
    const outputObject = outputObjectFromResult(handle, result);
    const output = handle.outputSchema
      ? decodeWithSchema(handle.outputSchema, outputObject)
      : outputObject;
    return {
      _tag: "Called",
      objectId: handle.objectId,
      methodId: handle.methodId,
      output: output as Output,
      status,
      inputArgumentResults,
      raw,
    };
  } catch (error) {
    return {
      _tag: "DecodeError",
      objectId: handle.objectId,
      methodId: handle.methodId,
      status,
      error: error as Schema.SchemaError,
      raw,
    };
  }
};

const readExecutableAttributes = (
  session: ClientSession,
  spec: OpcuaMethodSpec,
  methodId: NodeId,
) =>
  Effect.gen(function* () {
    const [executableValue, userExecutableValue] = yield* Effect.tryPromise({
      try: () =>
        session.read(
          [
            { nodeId: methodId, attributeId: AttributeIds.Executable },
            { nodeId: methodId, attributeId: AttributeIds.UserExecutable },
          ],
          0,
        ),
      catch: (cause) =>
        new OpcuaServiceError({
          operation: "methodHandle.executable",
          nodeId: spec.methodId,
          cause,
        }),
    });
    const executable = readBooleanAttribute(
      executableValue,
      "methodHandle.executable",
      spec.methodId,
      true,
    );
    const userExecutable = readBooleanAttribute(
      userExecutableValue,
      "methodHandle.userExecutable",
      spec.methodId,
      false,
    );
    if (executable instanceof OpcuaConfigurationError) {
      return yield* Effect.fail(executable);
    }
    if (userExecutable instanceof OpcuaConfigurationError) {
      return yield* Effect.fail(userExecutable);
    }
    return [executable, userExecutable] as const;
  });

const readBooleanAttribute = (
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

const normalizeArguments = (
  session: ClientSession,
  nodeId: NodeIdString,
  operation: string,
  arguments_: ReadonlyArray<Argument>,
) =>
  Effect.forEach(arguments_, (argument) =>
    Effect.gen(function* () {
      const dataTypeNodeId =
        argument.dataType instanceof NodeId
          ? argument.dataType
          : coerceNodeId(argument.dataType);
      const builtInDataType =
        dataTypeNodeId.namespace === 0 &&
        typeof dataTypeNodeId.value === "number" &&
        DataType[dataTypeNodeId.value] !== undefined
          ? (dataTypeNodeId.value as DataType)
          : yield* Effect.tryPromise({
              try: () => session.getBuiltInDataType(dataTypeNodeId),
              catch: (cause) =>
                new OpcuaServiceError({
                  operation: `methodHandle.${operation}.getBuiltInDataType`,
                  nodeId,
                  cause,
                }),
            });
      return {
        name: argument.name ?? "",
        description: argument.description
          ? normalizeLocalizedText(argument.description)
          : undefined,
        dataTypeNodeId: normalizeNodeId(dataTypeNodeId),
        dataType: DataType[builtInDataType] ?? String(builtInDataType),
        valueRank: argument.valueRank ?? -1,
        arrayDimensions: argument.arrayDimensions ?? undefined,
        raw: {
          argument,
          dataType: dataTypeNodeId,
          builtInDataType,
        },
      } satisfies OpcuaMethodArgumentMetadata;
    }),
  );

const mappingOrFail = (
  operation: string,
  nodeId: NodeIdString,
  arguments_: ReadonlyArray<OpcuaMethodArgumentMetadata>,
  explicitMap: OpcuaMethodArgumentMap | undefined,
) =>
  Effect.suspend(() => {
    const result = explicitMap
      ? explicitMapping(arguments_, explicitMap)
      : defaultMapping(arguments_);
    if (result instanceof OpcuaConfigurationError) {
      return Effect.fail(
        new OpcuaConfigurationError({
          operation,
          nodeId,
          cause: result.cause,
        }),
      );
    }
    return Effect.succeed(result);
  });

const defaultMapping = (
  arguments_: ReadonlyArray<OpcuaMethodArgumentMetadata>,
) => {
  const seenNames = new Set<string>();
  const mapping: Array<OpcuaMethodArgumentMapping> = [];
  for (let index = 0; index < arguments_.length; index++) {
    const argumentName = arguments_[index]!.name;
    if (!argumentName || seenNames.has(argumentName)) {
      return new OpcuaConfigurationError({
        operation: "methodHandle.argumentMap",
        cause: "Argument names must be non-empty and unique",
      });
    }
    seenNames.add(argumentName);
    mapping.push({ key: argumentName, index, argumentName });
  }
  return mapping;
};

const explicitMapping = (
  arguments_: ReadonlyArray<OpcuaMethodArgumentMetadata>,
  explicitMap: OpcuaMethodArgumentMap,
) => {
  const usedIndexes = new Set<number>();
  const mapping: Array<OpcuaMethodArgumentMapping> = [];
  for (const [key, selector] of Object.entries(explicitMap)) {
    const matches =
      typeof selector === "number"
        ? [selector]
        : arguments_
            .map((argument, index) =>
              argument.name === selector ? index : undefined,
            )
            .filter((index): index is number => index !== undefined);
    const index = matches[0] ?? -1;
    if (!Number.isInteger(index) || index < 0 || index >= arguments_.length) {
      return new OpcuaConfigurationError({
        operation: "methodHandle.argumentMap",
        cause: `Argument selector for ${key} did not resolve`,
      });
    }
    if (matches.length !== 1) {
      return new OpcuaConfigurationError({
        operation: "methodHandle.argumentMap",
        cause: `Argument selector for ${key} did not resolve exactly once`,
      });
    }
    if (usedIndexes.has(index)) {
      return new OpcuaConfigurationError({
        operation: "methodHandle.argumentMap",
        cause: "Two public keys target the same argument",
      });
    }
    usedIndexes.add(index);
    mapping.push({
      key,
      index,
      argumentName: arguments_[index]!.name,
    });
  }
  return mapping;
};

const validateInputKeys = (
  handle: AnyMethodHandle,
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
  handle: AnyMethodHandle,
  result: CallMethodResult,
) => {
  const output: Record<string, unknown> = {};
  const outputArguments = result.outputArguments ?? [];
  for (const mapping of handle.metadata.outputMapping) {
    const variant = outputArguments[mapping.index];
    output[mapping.key] = handle.outputSchema
      ? variant?.value
      : decodeDynamicValue(variant?.value, variant);
  }
  return output;
};

const normalizeInputArgumentResults = (
  handle: AnyMethodHandle,
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

const codecMetadata = (
  metadata: OpcuaMethodArgumentMetadata,
): OpcuaDynamicValueMetadata => ({
  raw: { dataType: metadata.raw.builtInDataType },
  valueRank: metadata.valueRank,
  arrayDimensions: metadata.arrayDimensions,
});
