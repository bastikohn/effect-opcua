import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import type {
  Argument,
  CallMethodRequestLike,
  CallMethodResult,
  ClientSession,
  DataValue,
  ReadValueIdOptions,
  StatusCode,
  WriteValueOptions,
} from "node-opcua";

import { Opcua, OpcuaMethodInputError } from "../src/index.js";
import {
  makeMethodHandle,
  methodArgumentMetadataFromRaw,
  type MethodArg,
  type MethodHandle,
  type MethodMetadata,
} from "../src/methods.js";
import {
  coerceNodeId,
  DataType,
  StatusCodes,
  Variant,
} from "../src/node-opcua.js";
import type { OpcuaStructureRuntime } from "../src/structure-runtime.js";
import {
  makeVariableHandle,
  variableMetadataFromRaw,
  type WritableVariableHandle,
} from "../src/values.js";

const fakeStructureRuntime = {
  ensureInitialized: () => Effect.void,
  invalidate: Effect.void,
  encodeStructure: () => Effect.die("unused"),
  encodeStructureArray: () => Effect.die("unused"),
  decodeStructure: () => {
    throw new Error("unused");
  },
  decodeStructureArray: () => {
    throw new Error("unused");
  },
  variantFromStructure: () => Effect.die("unused"),
} as unknown as OpcuaStructureRuntime;

describe("batch helpers", () => {
  it("batches readAll into one read service call and preserves order", async () => {
    const valuesByNodeId = new Map([
      ["ns=1;s=Batch.Read.A", 1],
      ["ns=1;s=Batch.Read.B", 2],
      ["ns=1;s=Batch.Read.C", 3],
    ]);
    const { session, readCalls } = makeFakeVariableSession({
      read: (nodesToRead) =>
        nodesToRead.map((node) =>
          numberDataValue(valuesByNodeId.get(node.nodeId?.toString() ?? "")),
        ),
    });
    const a = makeNumberHandle(session, "ns=1;s=Batch.Read.A");
    const b = makeNumberHandle(session, "ns=1;s=Batch.Read.B");
    const c = makeNumberHandle(session, "ns=1;s=Batch.Read.C");

    const result = await Effect.runPromise(Opcua.readAll([c, a, b] as const));

    expect(readCalls).toHaveLength(1);
    expect(readCalls[0]).toHaveLength(3);
    expect(result.map((entry) => entry._tag)).toEqual([
      "Value",
      "Value",
      "Value",
    ]);
    expect(
      result.map((entry) => entry._tag === "Value" && entry.value),
    ).toEqual([3, 1, 2]);
  });

  it("chunks readAll requests", async () => {
    const { session, readCalls } = makeFakeVariableSession();
    const handles = Array.from({ length: 251 }, (_, index) =>
      makeNumberHandle(session, `ns=1;s=Batch.Chunk.${index}`),
    );

    const result = await Effect.runPromise(
      Opcua.readAll(handles, { maxItemsPerRequest: 250 }),
    );

    expect(result).toHaveLength(251);
    expect(readCalls.map((call) => call.length)).toEqual([250, 1]);
  });

  it("keeps readAll decode errors and non-good statuses as data", async () => {
    const { session, readCalls } = makeFakeVariableSession({
      read: () => [
        numberDataValue(1),
        numberDataValue("not-a-number"),
        numberDataValue(3, StatusCodes.BadNodeIdUnknown),
      ],
    });
    const a = makeNumberHandle(session, "ns=1;s=Batch.Mixed.A");
    const b = makeNumberHandle(session, "ns=1;s=Batch.Mixed.B");
    const c = makeNumberHandle(session, "ns=1;s=Batch.Mixed.C");

    const result = await Effect.runPromise(Opcua.readAll([a, b, c] as const));

    expect(readCalls).toHaveLength(1);
    expect(result.map((entry) => entry._tag)).toEqual([
      "Value",
      "DecodeError",
      "NonGoodStatus",
    ]);
  });

  it("batches writeAll into one write service call and returns mixed statuses", async () => {
    const { session, writeCalls } = makeFakeVariableSession({
      write: () => [StatusCodes.Good, StatusCodes.BadNodeIdUnknown],
    });
    const a = makeNumberHandle(session, "ns=1;s=Batch.Write.A");
    const b = makeNumberHandle(session, "ns=1;s=Batch.Write.B");

    const result = await Effect.runPromise(
      Opcua.writeAll([
        { handle: a, value: 11 },
        { handle: b, value: 12 },
      ] as const),
    );

    expect(writeCalls).toHaveLength(1);
    expect(writeCalls[0]).toHaveLength(2);
    expect(writeCalls[0]?.map((write) => write.value?.value?.value)).toEqual([
      11, 12,
    ]);
    expect(result.map((entry) => entry._tag)).toEqual([
      "Written",
      "NonGoodStatus",
    ]);
  });

  it("encodes all writeAll entries before any service call", async () => {
    const { session, writeCalls } = makeFakeVariableSession();
    const a = makeNumberHandle(session, "ns=1;s=Batch.Preflight.A");
    const b = makeNumberHandle(session, "ns=1;s=Batch.Preflight.B");
    const entries = [
      { handle: a, value: 1 },
      { handle: b, value: "not-a-number" },
    ] as unknown as ReadonlyArray<{
      readonly handle: WritableVariableHandle<number>;
      readonly value: number;
    }>;

    await expect(
      Effect.runPromise(
        Opcua.writeAll(entries, {
          maxItemsPerRequest: 1,
        }),
      ),
    ).rejects.toMatchObject({ _tag: "OpcuaEncodeError" });
    expect(writeCalls).toHaveLength(0);
  });

  it("batches callAll into one call service request and preserves order", async () => {
    const { session, callRequests } = makeFakeMethodSession({
      call: (methodsToCall) =>
        methodsToCall.map((request) =>
          methodResult(
            (((request.inputArguments?.[0] as Variant | undefined)?.value ??
              0) as number) + 10,
          ),
        ),
    });
    const a = await makeNumberMethodHandle(session, "ns=1;s=Batch.Call.A");
    const b = await makeNumberMethodHandle(session, "ns=1;s=Batch.Call.B");

    const result = await Effect.runPromise(
      Opcua.callAll([
        { handle: b, input: { Value: 2 } },
        { handle: a, input: { Value: 1 } },
      ] as const),
    );

    expect(callRequests).toHaveLength(1);
    expect(callRequests[0]).toHaveLength(2);
    expect(result.map((entry) => entry._tag)).toEqual(["Called", "Called"]);
    expect(
      result.map((entry) => entry._tag === "Called" && entry.output),
    ).toEqual([{ Value: 12 }, { Value: 11 }]);
  });

  it("keeps callAll non-good statuses and decode errors as data", async () => {
    const { session, callRequests } = makeFakeMethodSession({
      call: () => [
        methodResult(1),
        methodResult(2, StatusCodes.BadInvalidArgument),
        methodResult("not-a-number"),
      ],
    });
    const a = await makeNumberMethodHandle(session, "ns=1;s=Batch.Mixed.A");
    const b = await makeNumberMethodHandle(session, "ns=1;s=Batch.Mixed.B");
    const c = await makeNumberMethodHandle(session, "ns=1;s=Batch.Mixed.C");

    const result = await Effect.runPromise(
      Opcua.callAll([
        { handle: a, input: { Value: 1 } },
        { handle: b, input: { Value: 2 } },
        { handle: c, input: { Value: 3 } },
      ] as const),
    );

    expect(callRequests).toHaveLength(1);
    expect(result.map((entry) => entry._tag)).toEqual([
      "Called",
      "NonGoodStatus",
      "DecodeError",
    ]);
  });

  it("preflights all callAll entries before any service call", async () => {
    const { session, callRequests } = makeFakeMethodSession();
    const handle = await makeNumberMethodHandle(
      session,
      "ns=1;s=Batch.Preflight",
    );
    const entries = [
      { handle, input: { Value: 1 } },
      { handle, input: { Wrong: 2 } },
    ] as ReadonlyArray<{
      readonly handle: MethodHandle<
        { readonly Value: number },
        { readonly Value: number }
      >;
      readonly input: { readonly Value: number };
    }>;

    await expect(
      Effect.runPromise(
        Opcua.callAll(entries, {
          maxItemsPerRequest: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaMethodInputError);
    expect(callRequests).toHaveLength(0);
  });
});

const makeFakeVariableSession = (
  options: {
    readonly read?: (
      nodesToRead: ReadonlyArray<ReadValueIdOptions>,
    ) => ReadonlyArray<DataValue>;
    readonly write?: (
      nodesToWrite: ReadonlyArray<WriteValueOptions>,
    ) => ReadonlyArray<StatusCode>;
  } = {},
) => {
  const readCalls: Array<ReadonlyArray<ReadValueIdOptions>> = [];
  const writeCalls: Array<ReadonlyArray<WriteValueOptions>> = [];
  const session = {
    read: async (
      nodesToRead: ReadValueIdOptions | Array<ReadValueIdOptions>,
    ) => {
      const batch = Array.isArray(nodesToRead) ? nodesToRead : [nodesToRead];
      readCalls.push([...batch]);
      return (
        options.read?.(batch) ?? batch.map((_, index) => numberDataValue(index))
      );
    },
    write: async (
      nodesToWrite: WriteValueOptions | Array<WriteValueOptions>,
    ) => {
      const batch = Array.isArray(nodesToWrite) ? nodesToWrite : [nodesToWrite];
      writeCalls.push([...batch]);
      return options.write?.(batch) ?? batch.map(() => StatusCodes.Good);
    },
  } as unknown as ClientSession;
  return { session, readCalls, writeCalls };
};

const makeNumberHandle = (session: ClientSession, nodeId: string) =>
  makeVariableHandle(
    session,
    Opcua.variable({
      nodeId,
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    }),
    variableMetadataFromRaw({
      nodeId,
      dataTypeNodeId: coerceNodeId("i=11"),
      builtInDataType: DataType.Double,
      valueRank: -1,
      accessLevel: 3,
    }),
    fakeStructureRuntime,
  );

const numberDataValue = (
  value: unknown,
  statusCode: StatusCode = StatusCodes.Good,
): DataValue =>
  ({
    statusCode,
    value: new Variant({
      dataType: DataType.Double,
      value,
    }),
  }) as DataValue;

const makeFakeMethodSession = (
  options: {
    readonly call?: (
      methodsToCall: ReadonlyArray<CallMethodRequestLike>,
    ) => ReadonlyArray<CallMethodResult>;
  } = {},
) => {
  const callRequests: Array<ReadonlyArray<CallMethodRequestLike>> = [];
  const session = {
    call: async (
      methodsToCall: CallMethodRequestLike | Array<CallMethodRequestLike>,
    ) => {
      const batch = Array.isArray(methodsToCall)
        ? methodsToCall
        : [methodsToCall];
      callRequests.push([...batch]);
      return (
        options.call?.(batch) ??
        batch.map((request) =>
          methodResult(
            ((request.inputArguments?.[0] as Variant | undefined)?.value ??
              0) as number,
          ),
        )
      );
    },
  } as unknown as ClientSession;
  return { session, callRequests };
};

const makeNumberMethodHandle = (session: ClientSession, methodId: string) => {
  const input = {
    Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }),
  };
  const output = {
    Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }),
  };
  const def = Opcua.method({
    objectId: "ns=1;s=Batch.MethodObject",
    methodId,
    input,
    output,
  });
  return Effect.runPromise(
    makeMethodHandle(
      session,
      def,
      methodMetadata(input.Value, output.Value, methodId),
      fakeStructureRuntime,
    ),
  );
};

const methodMetadata = (
  inputArg: MethodArg<number>,
  outputArg: MethodArg<number>,
  methodId: string,
): MethodMetadata => ({
  objectId: "ns=1;s=Batch.MethodObject",
  methodId,
  executable: true,
  userExecutable: true,
  inputArguments: [numberArgument("Value")],
  outputArguments: [numberArgument("Value")],
  inputMapping: [
    { key: "Value", index: 0, argumentName: "Value", arg: inputArg },
  ],
  outputMapping: [
    { key: "Value", index: 0, argumentName: "Value", arg: outputArg },
  ],
});

const numberArgument = (name: string) =>
  methodArgumentMetadataFromRaw(
    {
      name,
      dataType: coerceNodeId("i=11"),
      valueRank: -1,
      arrayDimensions: [],
    } as unknown as Argument,
    coerceNodeId("i=11"),
    DataType.Double,
  );

const methodResult = (
  value: unknown,
  statusCode: StatusCode = StatusCodes.Good,
): CallMethodResult =>
  ({
    statusCode,
    outputArguments: [
      new Variant({
        dataType: DataType.Double,
        value,
      }),
    ],
  }) as CallMethodResult;
