import { Effect } from "effect";

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
  type MethodCallEntry,
  type MethodCallResult,
  type MethodHandle,
  type MethodIdOfMethodHandle,
  type ObjectIdOfMethodHandle,
  type OutputOfMethodHandle,
} from "./methods.js";
import { BufferPolicy, MonitorDeadband, MonitorFilter } from "./monitoring.js";
import { OpcuaStructure } from "./structures.js";
import {
  makeVariableDef,
  type NodeIdOfVariableHandle,
  type ReadResult,
  type ReadableVariableHandle,
  type ValueOfVariableHandle,
  type VariableAccess,
  type WritableVariableHandle,
  type WriteEntry,
  type WriteResult,
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
    readonly handle: WritableVariableHandle<unknown, infer Id>;
  }
    ? WriteResult<Id>
    : never;
};

export type CallAllResult<Entries extends ReadonlyArray<unknown>> = {
  readonly [Index in keyof Entries]: Entries[Index] extends {
    readonly handle: infer H;
  }
    ? H extends MethodHandle
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
  ) =>
    Effect.forEach(handles, (handle) => handle.read()) as Effect.Effect<
      ReadAllResult<Handles>,
      OpcuaServiceError
    >,
  writeAll: <
    const Handles extends ReadonlyArray<WritableVariableHandle>,
  >(entries: {
    readonly [Index in keyof Handles]: WriteEntry<Handles[Index]>;
  }) =>
    Effect.forEach(
      entries as ReadonlyArray<WriteEntry<WritableVariableHandle>>,
      (entry) => entry.handle.write(entry.value),
    ) as Effect.Effect<
      WriteAllResult<typeof entries>,
      OpcuaEncodeError | OpcuaServiceError
    >,
  callAll: <const Handles extends ReadonlyArray<MethodHandle>>(entries: {
    readonly [Index in keyof Handles]: MethodCallEntry<Handles[Index]>;
  }) =>
    Effect.forEach(
      entries as ReadonlyArray<MethodCallEntry<MethodHandle>>,
      (entry) => entry.handle.call(entry.input, entry.options),
    ) as Effect.Effect<
      CallAllResult<typeof entries>,
      | OpcuaConfigurationError
      | OpcuaServiceError
      | OpcuaMethodInputError
      | OpcuaMethodNotExecutableError
      | OpcuaAccessDeniedError
    >,
};

export type { NodeIdOfVariableHandle, ValueOfVariableHandle, VariableAccess };
