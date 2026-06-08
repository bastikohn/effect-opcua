import {
  coerceNodeId,
  type CallMethodResult,
  type ClientSession,
} from "node-opcua";
import { Effect } from "effect";

import {
  configurationError,
  methodNotExecutableError,
  serviceError,
} from "../../OpcuaError.js";
import { runChunked, type BatchOptions } from "../batch.js";
import { normalizeStatusCode } from "../values/normalize.js";
import { resultFromStatusAndDecode } from "../values/result.js";
import type { OpcuaStructureRuntime } from "../structures/runtime.js";
import type { MethodCallOptions } from "../session-operations.js";
import {
  normalizeInputArgumentResults,
  outputObjectFromResult,
  preflightMethodCall,
  type MethodPreflight,
} from "./arguments.js";
import type {
  AnyMethodDef,
  AnyResolvedMethod,
  InputOfMethodDef,
  MethodCallEntry,
  MethodCallResult,
  MethodMetadata,
  OutputOfMethodDef,
  ResolvedMethod,
} from "../../OpcuaMethod.js";

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

const coerceNodeIdOrFail = (operation: string, nodeId: unknown) =>
  Effect.try({
    try: () => coerceNodeId(nodeId),
    catch: (cause) =>
      configurationError({ operation, nodeId: String(nodeId), cause }),
  });
