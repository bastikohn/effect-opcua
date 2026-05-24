import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { Effect, PubSub, Schema } from "effect";
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

import * as Opcua from "../src/Opcua.js";
import { isOpcuaError } from "../src/OpcuaError.js";
import { makeSession } from "../src/OpcuaSession.js";
import type { OpcuaSessionEvent } from "../src/internal/events.js";
import {
  AttributeIds,
  DataType,
  StatusCodes,
  Variant,
  coerceNodeId,
} from "../src/node-opcua.js";

describe("keyed batch APIs", () => {
  it("returns empty dictionaries without server calls", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession();
          return {
            read: yield* fake.session.readMany({}),
            write: yield* fake.session.writeMany({}),
            call: yield* fake.session.callMany({}),
            calls: fake.calls,
          };
        }),
      ),
    );

    expect(result).toMatchObject({ read: {}, write: {}, call: {} });
    expect(result.calls.valueReads).toHaveLength(0);
    expect(result.calls.writes).toHaveLength(0);
    expect(result.calls.calls).toHaveLength(0);
  });

  it("reads keyed definitions without validation and preserves key mapping", async () => {
    const Temperature = Opcua.variable({
      nodeId: "ns=1;s=Batch.Read.A",
      codec: Opcua.schema(Schema.Number),
    });
    const Pressure = Opcua.variable({
      nodeId: "ns=1;s=Batch.Read.B",
      codec: Opcua.schema(Schema.Number),
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            readValues: (nodes) =>
              nodes.map((node) =>
                numberDataValue(
                  node.nodeId?.toString() === "ns=1;s=Batch.Read.A" ? 1 : 2,
                ),
              ),
          });
          const values = yield* fake.session.readMany(
            { pressure: Pressure, temperature: Temperature } as const,
            {
              validation: "none",
              service: { maxNodesPerRead: 1, maxConcurrentRequests: 2 },
            },
          );
          return { values, calls: fake.calls };
        }),
      ),
    );

    expect(result.calls.metadataReads).toHaveLength(0);
    expect(result.calls.valueReads.map((call) => call.length)).toEqual([1, 1]);
    expect(result.values.temperature).toMatchObject({ _tag: "Value", value: 1 });
    expect(result.values.pressure).toMatchObject({ _tag: "Value", value: 2 });
  });

  it("caches strict read validation until session_restored", async () => {
    const Temperature = Opcua.variable({
      nodeId: "ns=1;s=Batch.Strict",
      codec: Opcua.schema(Schema.Number),
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession();
          yield* fake.session.readMany({ temperature: Temperature } as const);
          yield* fake.session.readMany({ temperature: Temperature } as const);
          fake.raw.emit("session_restored");
          yield* fake.session.readMany({ temperature: Temperature } as const);
          return fake.calls;
        }),
      ),
    );

    expect(result.metadataReads).toHaveLength(2);
    expect(result.valueReads).toHaveLength(3);
  });

  it("rejects duplicate NodeIds for read and write", async () => {
    const A = Opcua.variable({ nodeId: "ns=1;s=Duplicate" });
    const B = Opcua.variable({ nodeId: "ns=1;s=Duplicate", access: "readWrite" });

    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fake = yield* makeFakeSession();
            return yield* fake.session.readMany({ a: A, b: A } as const);
          }),
        ),
      ),
    ).rejects.toSatisfy(isConfigurationError);

    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fake = yield* makeFakeSession();
            return yield* fake.session.writeMany({ a: [B, 1], b: [B, 2] } as const);
          }),
        ),
      ),
    ).rejects.toSatisfy(isConfigurationError);
  });

  it("preflights all writes before any write service call", async () => {
    const A = Opcua.variable({
      nodeId: "ns=1;s=Batch.Write.A",
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    });
    const B = Opcua.variable({
      nodeId: "ns=1;s=Batch.Write.B",
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession();
          const error = yield* fake.session
            .writeMany({ a: [A, 1], b: [B, "bad" as never] } as const)
            .pipe(Effect.flip);
          return { error, calls: fake.calls };
        }),
      ),
    );

    expect(isOpcuaError(result.error)).toBe(true);
    expect(isOpcuaError(result.error) && result.error.reason._tag).toBe("Encode");
    expect(result.calls.writes).toHaveLength(0);
  });

  it("calls duplicate method definitions and maps results by key", async () => {
    const Echo = Opcua.method({
      objectId: "ns=1;s=Object",
      methodId: "ns=1;s=Method",
      input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
      output: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession();
          const calls = yield* fake.session.callMany(
            {
              first: [Echo, { Value: 1 }],
              second: [Echo, { Value: 2 }, { includeRaw: true }],
            } as const,
            { service: { maxMethodsPerCall: 1, maxConcurrentRequests: 1 } },
          );
          return { calls, serviceCalls: fake.calls.calls };
        }),
      ),
    );

    expect(result.serviceCalls.map((call) => call.length)).toEqual([1, 1]);
    expect(result.calls.first).toMatchObject({
      _tag: "Called",
      output: { Value: 1 },
    });
    expect(result.calls.second).toMatchObject({
      _tag: "Called",
      output: { Value: 2 },
    });
    expect(result.calls.second.unsafeRaw).toBeDefined();
  });
});

const isConfigurationError = (error: unknown) =>
  isOpcuaError(error) && error.reason._tag === "Configuration";

const makeFakeSession = (
  options: {
    readonly readValues?: (
      nodesToRead: ReadonlyArray<ReadValueIdOptions>,
    ) => ReadonlyArray<DataValue>;
  } = {},
) =>
  Effect.gen(function* () {
    const events = yield* PubSub.sliding<OpcuaSessionEvent>(16);
    const calls = {
      valueReads: [] as Array<ReadonlyArray<ReadValueIdOptions>>,
      metadataReads: [] as Array<ReadonlyArray<ReadValueIdOptions>>,
      writes: [] as Array<ReadonlyArray<WriteValueOptions>>,
      calls: [] as Array<ReadonlyArray<CallMethodRequestLike>>,
    };
    const raw = Object.assign(new EventEmitter(), {
      read: async (
        nodesToRead: ReadValueIdOptions | Array<ReadValueIdOptions>,
      ) => {
        const batch = Array.isArray(nodesToRead) ? nodesToRead : [nodesToRead];
        if (batch.every((node) => node.attributeId === AttributeIds.Value)) {
          calls.valueReads.push([...batch]);
          return (
            options.readValues?.(batch) ??
            batch.map((_, index) => numberDataValue(index))
          );
        }
        calls.metadataReads.push([...batch]);
        return batch.map(metadataDataValue);
      },
      write: async (
        nodesToWrite: WriteValueOptions | Array<WriteValueOptions>,
      ) => {
        const batch = Array.isArray(nodesToWrite) ? nodesToWrite : [nodesToWrite];
        calls.writes.push([...batch]);
        return batch.map(() => StatusCodes.Good);
      },
      call: async (
        methodsToCall: CallMethodRequestLike | Array<CallMethodRequestLike>,
      ) => {
        const batch = Array.isArray(methodsToCall)
          ? methodsToCall
          : [methodsToCall];
        calls.calls.push([...batch]);
        return batch.map((request) =>
          methodResult(
            ((request.inputArguments?.[0] as Variant | undefined)?.value ??
              0) as number,
          ),
        );
      },
      getArgumentDefinition: async () => ({
        inputArguments: [numberArgument("Value")],
        outputArguments: [numberArgument("Value")],
      }),
    }) as unknown as ClientSession & EventEmitter;

    const session = yield* makeSession(raw, events);
    return { raw, session, calls };
  });

const metadataDataValue = (node: ReadValueIdOptions): DataValue => {
  switch (node.attributeId) {
    case AttributeIds.DataType:
      return variantDataValue(DataType.NodeId, coerceNodeId("i=11"));
    case AttributeIds.ValueRank:
      return variantDataValue(DataType.Int32, -1);
    case AttributeIds.ArrayDimensions:
      return {
        statusCode: StatusCodes.BadAttributeIdInvalid,
      } as unknown as DataValue;
    case AttributeIds.AccessLevel:
    case AttributeIds.UserAccessLevel:
      return variantDataValue(DataType.Byte, 3);
    case AttributeIds.Executable:
    case AttributeIds.UserExecutable:
      return variantDataValue(DataType.Boolean, true);
    default:
      return numberDataValue(0);
  }
};

const numberDataValue = (
  value: unknown,
  statusCode: StatusCode = StatusCodes.Good,
): DataValue =>
  variantDataValue(DataType.Double, value, statusCode);

const variantDataValue = (
  dataType: DataType,
  value: unknown,
  statusCode: StatusCode = StatusCodes.Good,
): DataValue =>
  ({
    statusCode,
    value: new Variant({ dataType, value }),
  }) as DataValue;

const numberArgument = (name: string): Argument =>
  ({
    name,
    dataType: coerceNodeId("i=11"),
    valueRank: -1,
    arrayDimensions: [],
  }) as unknown as Argument;

const methodResult = (
  value: unknown,
  statusCode: StatusCode = StatusCodes.Good,
): CallMethodResult =>
  ({
    statusCode,
    outputArguments: [new Variant({ dataType: DataType.Double, value })],
  }) as CallMethodResult;
