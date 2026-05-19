import {
  AttributeIds,
  BrowseDirection,
  DataType,
  DataTypeIds,
  NodeId,
  NodeIdType,
  ReferenceTypeIds,
  VariantArrayType,
  coerceNodeId,
  type Argument,
  type BrowseDescriptionOptions,
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
} from "./codecs.js";
import {
  validateStructureMetadata,
  type OpcuaStructureRuntime,
} from "./structure-runtime.js";
import {
  isOpcuaStructureArrayCodec,
  isOpcuaStructureCodec,
  type AnyStructureSpec,
  type OpcuaStructureArrayCodec,
  type OpcuaStructureCodec,
} from "./structures.js";
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

export type OpcuaMethodSpec<
  ObjectId extends NodeIdString = NodeIdString,
  MethodId extends NodeIdString = NodeIdString,
> = {
  readonly objectId: ObjectId;
  readonly methodId: MethodId;
  readonly input?: Readonly<Record<string, OpcuaMethodFieldSpec<unknown>>>;
  readonly output?: Readonly<Record<string, OpcuaMethodFieldSpec<unknown>>>;
  readonly includeRaw?: boolean;
};

export type OpcuaMethodFieldSpec<A> =
  | AnySchema
  | OpcuaStructureCodec<A>
  | OpcuaStructureArrayCodec<A>
  | {
      readonly opcuaArgumentName?: string;
      readonly opcuaArgumentIndex?: number;
      readonly schema: AnySchema;
      readonly structure?: never;
    }
  | {
      readonly opcuaArgumentName?: string;
      readonly opcuaArgumentIndex?: number;
      readonly structure: AnyStructureSpec;
      readonly schema?: never;
    };

export type FieldType<Spec> =
  Spec extends OpcuaStructureCodec<infer A>
    ? A
    : Spec extends OpcuaStructureArrayCodec<infer A>
      ? ReadonlyArray<A>
      : Spec extends { readonly structure: OpcuaStructureCodec<infer A> }
        ? A
        : Spec extends {
              readonly structure: OpcuaStructureArrayCodec<infer A>;
            }
          ? ReadonlyArray<A>
          : Spec extends Schema.Codec<unknown, infer A, never, never>
            ? A
            : Spec extends { readonly schema: infer S }
              ? S extends Schema.Codec<unknown, infer A, never, never>
                ? A
                : OpcuaDynamicValue
              : OpcuaDynamicValue;

export type InputOfMethodSpec<Spec> = Spec extends {
  readonly input: infer Fields extends Readonly<Record<string, unknown>>;
}
  ? { readonly [Key in keyof Fields]: FieldType<Fields[Key]> }
  : Record<string, OpcuaDynamicValue>;

export type OutputOfMethodSpec<Spec> = Spec extends {
  readonly output: infer Fields extends Readonly<Record<string, unknown>>;
}
  ? { readonly [Key in keyof Fields]: FieldType<Fields[Key]> }
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
  readonly field: NormalizedMethodFieldSpec;
};

export type NormalizedMethodFieldSpec =
  | { readonly _tag: "Dynamic" }
  | { readonly _tag: "Schema"; readonly schema: AnySchema }
  | { readonly _tag: "Structure"; readonly structure: AnyStructureSpec };

export type OpcuaMethodArgumentMetadata = {
  readonly name: string;
  readonly description?: OpcuaLocalizedTextInfo;
  readonly declaredDataType: OpcuaNodeIdInfo;
  readonly builtInDataType: string;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly raw: {
    readonly argument: Argument;
    readonly declaredDataType: NodeId;
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
      readonly error: unknown;
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
  readonly input?: Readonly<Record<string, OpcuaMethodFieldSpec<unknown>>>;
  readonly output?: Readonly<Record<string, OpcuaMethodFieldSpec<unknown>>>;
  readonly includeRaw?: boolean;
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
  readonly options?: OpcuaMethodCallOptions;
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
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    const objectId = yield* coerceNodeIdOrFail(
      "methodHandle.objectId",
      spec.objectId,
    );
    const methodId = yield* coerceNodeIdOrFail(
      "methodHandle.methodId",
      spec.methodId,
    );
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
      "methodHandle.input",
      spec.methodId,
      inputArguments,
      spec.input,
    );
    const outputMapping = yield* mappingOrFail(
      "methodHandle.output",
      spec.methodId,
      outputArguments,
      spec.output,
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
      input: spec.input,
      output: spec.output,
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
      ) => callMethodHandle(session, handle, input, structureRuntime, options),
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
  structureRuntime: OpcuaStructureRuntime,
  options?: OpcuaMethodCallOptions,
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
          operation: "callMethod",
          nodeId: handle.methodId,
          cause,
        }),
    });
    return methodResultFromRaw(handle, preflight, result, structureRuntime);
  });

export const callMethodHandles = <
  const Handles extends ReadonlyArray<OpcuaMethodHandle>,
>(
  session: ClientSession,
  entries: {
    readonly [Index in keyof Handles]: MethodCallEntry<Handles[Index]>;
  },
  structureRuntime: OpcuaStructureRuntime,
) =>
  Effect.gen(function* () {
    const preflights: Array<MethodPreflight> = [];
    for (const entry of entries) {
      preflights.push(
        yield* preflightMethodCall(
          entry.handle,
          entry.input,
          structureRuntime,
          entry.options,
        ),
      );
    }
    const results = yield* Effect.tryPromise({
      try: () => session.call(preflights.map((preflight) => preflight.request)),
      catch: (cause) =>
        new OpcuaServiceError({ operation: "callMethodHandles", cause }),
    });
    if (!Array.isArray(results) || results.length !== entries.length) {
      return yield* Effect.fail(
        new OpcuaServiceError({
          operation: "callMethodHandles",
          cause: `Expected ${entries.length} call results, got ${
            Array.isArray(results) ? results.length : "non-array"
          }`,
        }),
      );
    }
    return entries.map((entry, index) =>
      methodResultFromRaw(
        entry.handle,
        preflights[index]!,
        results[index]!,
        structureRuntime,
      ),
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
  structureRuntime: OpcuaStructureRuntime,
  options?: OpcuaMethodCallOptions,
): Effect.Effect<MethodPreflight, OpcuaMethodInputError | OpcuaServiceError> =>
  Effect.gen(function* () {
    if (
      handle.metadata.inputMapping.some(
        (mapping) => mapping.field._tag === "Structure",
      ) ||
      handle.metadata.outputMapping.some(
        (mapping) => mapping.field._tag === "Structure",
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
      const variant = yield* (
        encodeMethodArgument(
          handle,
          input,
          mapping,
          argument,
          rawValue,
          structureRuntime,
        ) as Effect.Effect<Variant, unknown>
      ).pipe(
        Effect.mapError((error) =>
          isOpcuaMethodInputError(error)
            ? error
            : new OpcuaMethodInputError({
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
        objectId: handle.raw.objectId,
        methodId: handle.raw.methodId,
        inputArguments,
      },
      includeRaw: options?.includeRaw ?? handle.includeRaw ?? false,
    };
  }) as Effect.Effect<
    MethodPreflight,
    OpcuaMethodInputError | OpcuaServiceError
  >;

const encodeMethodArgument = (
  handle: AnyMethodHandle,
  input: unknown,
  mapping: OpcuaMethodArgumentMapping,
  argument: OpcuaMethodArgumentMetadata,
  value: unknown,
  structureRuntime: OpcuaStructureRuntime,
) => {
  const field = mapping.field;
  switch (field._tag) {
    case "Schema":
      return Effect.try({
        try: () =>
          makeVariantFromMetadata(
            codecMetadata(argument),
            encodeWithSchema(field.schema, value),
          ),
        catch: (error) =>
          new OpcuaMethodInputError({
            objectId: handle.objectId,
            methodId: handle.methodId,
            input,
            phase: "SchemaEncoding",
            argumentKey: mapping.key,
            argumentIndex: mapping.index,
            error,
          }),
      });
    case "Structure":
      return structureRuntime.variantFromStructure(
        handle.methodId,
        field.structure,
        value,
      );
    case "Dynamic":
      return Effect.try({
        try: () =>
          makeVariantFromMetadata(
            codecMetadata(argument),
            encodeDynamicValue(value, codecMetadata(argument)),
          ),
        catch: (error) =>
          new OpcuaMethodInputError({
            objectId: handle.objectId,
            methodId: handle.methodId,
            input,
            phase: "Encoding",
            argumentKey: mapping.key,
            argumentIndex: mapping.index,
            error,
          }),
      });
  }
};

const isOpcuaMethodInputError = (
  error: unknown,
): error is OpcuaMethodInputError =>
  Boolean(
    error &&
    typeof error === "object" &&
    (error as { readonly _tag?: string })._tag === "OpcuaMethodInputError",
  );

const methodResultFromRaw = <
  Input,
  Output,
  ObjectId extends NodeIdString,
  MethodId extends NodeIdString,
>(
  handle: OpcuaMethodHandle<Input, Output, ObjectId, MethodId>,
  preflight: MethodPreflight,
  result: CallMethodResult,
  structureRuntime: OpcuaStructureRuntime,
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
    const output = outputObjectFromResult(handle, result, structureRuntime);
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
      error,
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
          : yield* coerceNodeIdOrFail(
              `methodHandle.${operation}.dataType`,
              String(argument.dataType),
            );
      const builtInDataType = yield* resolveBuiltInDataTypeFromArgumentDataType(
        session,
        dataTypeNodeId,
        nodeId,
        operation,
      );
      return {
        name: argument.name ?? "",
        description: argument.description
          ? normalizeLocalizedText(argument.description)
          : undefined,
        declaredDataType: normalizeNodeId(dataTypeNodeId),
        builtInDataType: DataType[builtInDataType] ?? String(builtInDataType),
        valueRank: argument.valueRank ?? -1,
        arrayDimensions: argument.arrayDimensions ?? undefined,
        raw: {
          argument,
          declaredDataType: dataTypeNodeId,
          builtInDataType,
        },
      } satisfies OpcuaMethodArgumentMetadata;
    }),
  );

const mappingOrFail = (
  operation: string,
  nodeId: NodeIdString,
  arguments_: ReadonlyArray<OpcuaMethodArgumentMetadata>,
  fields: Readonly<Record<string, OpcuaMethodFieldSpec<unknown>>> | undefined,
) =>
  Effect.suspend(() => {
    const result = fields
      ? explicitMapping(operation, nodeId, arguments_, fields)
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
    mapping.push({
      key: argumentName,
      index,
      argumentName,
      field: { _tag: "Dynamic" },
    });
  }
  return mapping;
};

const explicitMapping = (
  operation: string,
  nodeId: NodeIdString,
  arguments_: ReadonlyArray<OpcuaMethodArgumentMetadata>,
  fields: Readonly<Record<string, OpcuaMethodFieldSpec<unknown>>>,
) => {
  const usedIndexes = new Set<number>();
  const mapping: Array<OpcuaMethodArgumentMapping> = [];
  for (const [key, fieldSpec] of Object.entries(fields)) {
    const field = normalizeMethodFieldSpec(fieldSpec);
    const selectorError = methodFieldSelectorError(key, field);
    if (selectorError) return selectorError;
    const selector = field.opcuaArgumentIndex ?? field.opcuaArgumentName ?? key;
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
    const normalized = field.normalized;
    if (normalized._tag === "Structure") {
      const argument = arguments_[index]!;
      const structureError = validateStructureMetadata(
        operation,
        nodeId,
        {
          valueRank: argument.valueRank,
          raw: {
            declaredDataType: argument.raw.declaredDataType,
            builtInDataType: argument.raw.builtInDataType,
          },
        },
        normalized.structure,
      );
      if (structureError) {
        return new OpcuaConfigurationError({
          operation,
          nodeId,
          cause: {
            argumentName: argument.name,
            argumentIndex: index,
            cause: structureError.cause,
          },
        });
      }
    }
    mapping.push({
      key,
      index,
      argumentName: arguments_[index]!.name,
      field: normalized,
    });
  }
  if (usedIndexes.size !== arguments_.length) {
    return new OpcuaConfigurationError({
      operation: "methodHandle.argumentMap",
      cause: "Method field specs must cover every argument",
    });
  }
  return mapping;
};

const normalizeMethodFieldSpec = (
  spec: OpcuaMethodFieldSpec<unknown>,
): {
  readonly opcuaArgumentName?: string;
  readonly opcuaArgumentIndex?: number;
  readonly normalized: NormalizedMethodFieldSpec;
} => {
  if (isOpcuaStructureCodec(spec) || isOpcuaStructureArrayCodec(spec)) {
    return { normalized: { _tag: "Structure", structure: spec } };
  }
  const record = objectRecord(spec);
  if (record && ("schema" in record || "structure" in record)) {
    if (record.structure) {
      return {
        opcuaArgumentName:
          typeof record.opcuaArgumentName === "string"
            ? record.opcuaArgumentName
            : undefined,
        opcuaArgumentIndex:
          typeof record.opcuaArgumentIndex === "number"
            ? record.opcuaArgumentIndex
            : undefined,
        normalized: {
          _tag: "Structure",
          structure: record.structure as AnyStructureSpec,
        },
      };
    }
    return {
      opcuaArgumentName:
        typeof record.opcuaArgumentName === "string"
          ? record.opcuaArgumentName
          : undefined,
      opcuaArgumentIndex:
        typeof record.opcuaArgumentIndex === "number"
          ? record.opcuaArgumentIndex
          : undefined,
      normalized: { _tag: "Schema", schema: record.schema as AnySchema },
    };
  }
  return { normalized: { _tag: "Schema", schema: spec as AnySchema } };
};

const methodFieldSelectorError = (
  key: string,
  field: {
    readonly opcuaArgumentName?: string;
    readonly opcuaArgumentIndex?: number;
  },
) => {
  if (
    field.opcuaArgumentName !== undefined &&
    field.opcuaArgumentIndex !== undefined
  ) {
    return new OpcuaConfigurationError({
      operation: "methodHandle.argumentMap",
      cause: `Argument field ${key} cannot use both opcuaArgumentName and opcuaArgumentIndex`,
    });
  }
  return undefined;
};

const coerceNodeIdOrFail = (operation: string, nodeId: unknown) =>
  Effect.try({
    try: () => coerceNodeId(nodeId),
    catch: (cause) =>
      new OpcuaConfigurationError({ operation, nodeId: String(nodeId), cause }),
  });

const resolveBuiltInDataTypeFromArgumentDataType = (
  session: ClientSession,
  dataTypeNodeId: NodeId,
  methodNodeId: NodeIdString,
  operation: string,
): Effect.Effect<DataType, OpcuaConfigurationError | OpcuaServiceError> =>
  Effect.gen(function* () {
    let current = dataTypeNodeId;
    const visited = new Set<string>();
    while (true) {
      const builtIn = builtInDataTypeFromNodeId(current);
      if (builtIn !== undefined) return builtIn;

      const key = current.toString();
      if (visited.has(key)) {
        return yield* Effect.fail(
          new OpcuaConfigurationError({
            operation: `methodHandle.${operation}.dataType`,
            nodeId: methodNodeId,
            cause: `DataType hierarchy contains a cycle at ${key}`,
          }),
        );
      }
      visited.add(key);

      const superType = yield* browseDataTypeSuperType(
        session,
        current,
        methodNodeId,
        operation,
      );
      if (!superType) {
        return yield* Effect.fail(
          new OpcuaConfigurationError({
            operation: `methodHandle.${operation}.dataType`,
            nodeId: methodNodeId,
            cause: `Could not resolve built-in DataType for ${dataTypeNodeId.toString()}`,
          }),
        );
      }
      current = superType;
    }
  });

const builtInDataTypeFromNodeId = (nodeId: NodeId): DataType | undefined => {
  if (
    nodeId.identifierType === NodeIdType.NUMERIC &&
    nodeId.namespace === 0 &&
    nodeId.value === DataTypeIds.Enumeration
  ) {
    return DataType.Int32;
  }
  if (
    nodeId.identifierType === NodeIdType.NUMERIC &&
    nodeId.namespace === 0 &&
    typeof nodeId.value === "number" &&
    nodeId.value <= DataType.DiagnosticInfo &&
    DataType[nodeId.value] !== undefined
  ) {
    return nodeId.value as DataType;
  }
  return undefined;
};

const browseDataTypeSuperType = (
  session: ClientSession,
  dataTypeNodeId: NodeId,
  methodNodeId: NodeIdString,
  operation: string,
) =>
  Effect.tryPromise({
    try: async () => {
      const browse: BrowseDescriptionOptions = {
        browseDirection: BrowseDirection.Inverse,
        includeSubtypes: false,
        nodeId: dataTypeNodeId,
        referenceTypeId: coerceNodeId(ReferenceTypeIds.HasSubtype),
        resultMask: 1,
      };
      const result = await session.browse(browse);
      if (!isGood(result.statusCode)) {
        throw new Error(result.statusCode.toString());
      }
      const nodeId = result.references?.[0]?.nodeId;
      return nodeId ? coerceNodeId(nodeId) : undefined;
    },
    catch: (cause) =>
      new OpcuaServiceError({
        operation: `methodHandle.${operation}.browseDataTypeSuperType`,
        nodeId: methodNodeId,
        cause,
      }),
  });

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
  structureRuntime: OpcuaStructureRuntime,
) => {
  const output: Record<string, unknown> = {};
  const outputArguments = result.outputArguments ?? [];
  for (const mapping of handle.metadata.outputMapping) {
    const variant = outputArguments[mapping.index];
    switch (mapping.field._tag) {
      case "Schema":
        output[mapping.key] = decodeWithSchema(
          mapping.field.schema,
          variant?.value,
        );
        break;
      case "Structure":
        output[mapping.key] = decodeStructureOutput(
          mapping,
          mapping.field.structure,
          variant,
          structureRuntime,
        );
        break;
      case "Dynamic":
        output[mapping.key] = decodeDynamicValue(variant?.value, variant);
        break;
    }
  }
  return output;
};

const decodeStructureOutput = (
  mapping: OpcuaMethodArgumentMapping,
  structure: AnyStructureSpec,
  variant: Variant | undefined,
  structureRuntime: OpcuaStructureRuntime,
) => {
  if (variant?.dataType !== DataType.ExtensionObject) {
    throw new TypeError(
      `Expected ExtensionObject output Variant for ${mapping.argumentName}`,
    );
  }
  if (isOpcuaStructureArrayCodec(structure)) {
    if (variant.arrayType !== VariantArrayType.Array) {
      throw new TypeError(
        `Expected ExtensionObject array output Variant for ${mapping.argumentName}`,
      );
    }
    return structureRuntime.decodeStructureArray(structure, variant.value);
  }
  if (variant.arrayType !== VariantArrayType.Scalar) {
    throw new TypeError(
      `Expected scalar ExtensionObject output Variant for ${mapping.argumentName}`,
    );
  }
  return structureRuntime.decodeStructure(structure, variant.value);
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
