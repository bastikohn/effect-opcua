import { Effect } from "effect";

import type { BatchOptions } from "./batch.js";
import { Codec, dynamic, schema, structure, structureArray } from "./codecs.js";
import {
  OpcuaAccessDeniedError,
  OpcuaConfigurationError,
  OpcuaEncodeError,
  OpcuaMethodInputError,
  OpcuaMethodNotExecutableError,
  OpcuaServiceError,
} from "./errors.js";
import {
  makeMethodArg,
  makeMethodDef,
  callMethods,
  getMethodHandleSession,
  getMethodHandleStructureRuntime,
  type AnyMethodHandle,
  type MethodCallEntry,
  type MethodCallResult,
  type MethodIdOfMethodHandle,
  type ObjectIdOfMethodHandle,
  type OutputOfMethodHandle,
} from "./methods.js";
import { BufferPolicy, MonitorDeadband, MonitorFilter } from "./monitoring.js";
import { OpcuaStructure } from "./structures.js";
import {
  getVariableHandleSession,
  getVariableHandleStructureRuntime,
  makeVariableDef,
  readVariables,
  type NodeIdOfVariableHandle,
  type ReadResult,
  type ReadableVariableHandle,
  type ValueOfVariableHandle,
  type VariableAccess,
  type WritableVariableHandle,
  type WriteEntry,
  type WriteResult,
  writeVariables,
} from "./values.js";

export type ReadAllResult<Handles extends ReadonlyArray<unknown>> = {
  readonly [Index in keyof Handles]: Handles[Index] extends ReadableVariableHandle<
    infer A,
    infer Id
  >
    ? ReadResult<A, Id>
    : never;
};

export type WriteAllResult<Entries extends ReadonlyArray<unknown>> = {
  readonly [Index in keyof Entries]: Entries[Index] extends {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readonly handle: WritableVariableHandle<any, infer Id>;
  }
    ? WriteResult<Id>
    : never;
};

export type CallAllResult<Entries extends ReadonlyArray<unknown>> = {
  readonly [Index in keyof Entries]: Entries[Index] extends {
    readonly handle: infer H;
  }
    ? H extends AnyMethodHandle
      ? MethodCallResult<
          OutputOfMethodHandle<H>,
          ObjectIdOfMethodHandle<H>,
          MethodIdOfMethodHandle<H>
        >
      : never
    : never;
};

export const Opcua = {
  Codec,
  BufferPolicy,
  MonitorDeadband,
  MonitorFilter,
  Structure: OpcuaStructure,
  dynamic,
  schema,
  structure,
  structureArray,
  variable: makeVariableDef,
  arg: makeMethodArg,
  method: makeMethodDef,
  readAll: <const Handles extends ReadonlyArray<ReadableVariableHandle>>(
    handles: Handles,
    options?: BatchOptions,
  ) =>
    Effect.gen(function* () {
      if (handles.length === 0) return [] as unknown as ReadAllResult<Handles>;
      const context = yield* variableBatchContext("readAll", handles);
      return yield* readVariables(
        context.session,
        handles,
        context.structureRuntime,
        options,
      );
    }) as Effect.Effect<
      ReadAllResult<Handles>,
      OpcuaConfigurationError | OpcuaServiceError
    >,
  writeAll: <const Handles extends ReadonlyArray<WritableVariableHandle>>(
    entries: {
      readonly [Index in keyof Handles]: WriteEntry<Handles[Index]>;
    },
    options?: BatchOptions,
  ) =>
    Effect.gen(function* () {
      if (entries.length === 0) {
        return [] as unknown as WriteAllResult<typeof entries>;
      }
      const context = yield* variableBatchContext(
        "writeAll",
        entries.map((entry) => entry.handle),
      );
      return yield* writeVariables(
        context.session,
        entries as ReadonlyArray<WriteEntry<WritableVariableHandle>>,
        context.structureRuntime,
        options,
      );
    }) as Effect.Effect<
      WriteAllResult<typeof entries>,
      OpcuaConfigurationError | OpcuaEncodeError | OpcuaServiceError
    >,
  callAll: <const Handles extends ReadonlyArray<AnyMethodHandle>>(
    entries: {
      readonly [Index in keyof Handles]: MethodCallEntry<Handles[Index]>;
    },
    options?: BatchOptions,
  ) =>
    Effect.gen(function* () {
      if (entries.length === 0) {
        return [] as unknown as CallAllResult<typeof entries>;
      }
      const context = yield* methodBatchContext(
        "callAll",
        entries.map((entry) => entry.handle),
      );
      return yield* callMethods(
        context.session,
        entries as ReadonlyArray<MethodCallEntry<AnyMethodHandle>>,
        context.structureRuntime,
        options,
      );
    }) as Effect.Effect<
      CallAllResult<typeof entries>,
      | OpcuaConfigurationError
      | OpcuaServiceError
      | OpcuaMethodInputError
      | OpcuaMethodNotExecutableError
      | OpcuaAccessDeniedError
    >,
};

const variableBatchContext = (
  operation: string,
  handles: ReadonlyArray<ReadableVariableHandle | WritableVariableHandle>,
) =>
  Effect.suspend(() => {
    const first = handles[0];
    const session = getVariableHandleSession(first);
    const structureRuntime = getVariableHandleStructureRuntime(first);
    if (!session || !structureRuntime) {
      return Effect.fail(
        new OpcuaConfigurationError({
          operation,
          cause: "Batch helpers require handles created by OpcuaSession.handle",
        }),
      );
    }
    if (
      handles.some(
        (handle) =>
          getVariableHandleSession(handle) !== session ||
          getVariableHandleStructureRuntime(handle) !== structureRuntime,
      )
    ) {
      return Effect.fail(
        new OpcuaConfigurationError({
          operation,
          cause: "Batch helpers require handles from the same session",
        }),
      );
    }
    return Effect.succeed({ session, structureRuntime });
  });

const methodBatchContext = (
  operation: string,
  handles: ReadonlyArray<AnyMethodHandle>,
) =>
  Effect.suspend(() => {
    const first = handles[0];
    const session = getMethodHandleSession(first);
    const structureRuntime = getMethodHandleStructureRuntime(first);
    if (!session || !structureRuntime) {
      return Effect.fail(
        new OpcuaConfigurationError({
          operation,
          cause: "Batch helpers require handles created by OpcuaSession.handle",
        }),
      );
    }
    if (
      handles.some(
        (handle) =>
          getMethodHandleSession(handle) !== session ||
          getMethodHandleStructureRuntime(handle) !== structureRuntime,
      )
    ) {
      return Effect.fail(
        new OpcuaConfigurationError({
          operation,
          cause: "Batch helpers require handles from the same session",
        }),
      );
    }
    return Effect.succeed({ session, structureRuntime });
  });

export type { BatchOptions };

export type { NodeIdOfVariableHandle, ValueOfVariableHandle, VariableAccess };
