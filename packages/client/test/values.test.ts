import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { StatusCodes } from "node-opcua";

import { Capabilities, OpcuaSession, OpcuaStructure } from "../src/index.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext(4842);
const ScanSettings = OpcuaStructure.make({
  name: "ScanSettings",
  dataTypeId: "ns=1;i=3010",
  schema: Schema.Struct({
    duration: Schema.Number,
    cycles: Schema.Number,
    dataAvailable: Schema.Boolean,
  }),
});

describe("values", () => {
  it("returns schema-less normalized samples", async () => {
    const sample = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.readValue({
          nodeId: "ns=1;s=MyMachine.Temperature",
        });
      }),
    );

    expect(sample).toMatchObject({
      _tag: "Value",
      nodeId: "ns=1;s=MyMachine.Temperature",
      status: { isGood: true },
      variant: { dataType: "Double" },
    });
    expect(sample._tag === "Value" ? typeof sample.value : "missing").toBe(
      "number",
    );
    expect(sample.raw).toBeUndefined();
  });

  it("returns typed samples and decode errors as values", async () => {
    const [typed, decoded] = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.readValues([
          { nodeId: "ns=1;s=MyMachine.Temperature", schema: Schema.Number },
          { nodeId: "ns=1;s=MyMachine.Temperature", schema: Schema.String },
        ] as const);
      }),
    );

    expect(typed).toMatchObject({
      _tag: "Value",
      value: expect.any(Number),
    });
    expect(decoded).toMatchObject({
      _tag: "DecodeError",
      status: { isGood: true },
    });
  });

  it("creates read-only handles by default and readWrite handles explicitly", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const readOnly = yield* session.valueHandle({
          nodeId: "ns=1;s=MyMachine.Temperature",
        });
        const writable = yield* session.valueHandle({
          nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
          schema: Schema.Number,
          capabilities: Capabilities.readWrite,
        });
        const sample = yield* readOnly.read();
        const write = yield* writable.write(1234);
        return { readOnly, writable, sample, write };
      }),
    );

    expect(result.readOnly.capabilities).toEqual(["read"]);
    expect("write" in result.readOnly).toBe(false);
    expect(result.writable.metadata.access.writable).toBe(true);
    expect(result.sample).toMatchObject({ _tag: "Value" });
    expect(result.write).toMatchObject({ _tag: "Written" });
  });

  it("keeps non-good write statuses in the returned result", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.writeValue({
          nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
          value: 1400,
        });
      }),
    );

    expect(result).toMatchObject({
      _tag: "Written",
      status: { text: StatusCodes.Good.toString() },
    });
  });

  it("returns writeHandleValues results in input order and rejects duplicates", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const a = yield* session.valueHandle({
          nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
          capabilities: Capabilities.readWrite,
        });
        const b = yield* session.valueHandle({
          nodeId: "ns=1;s=MyMachine.Axis1.Enabled",
          capabilities: Capabilities.readWrite,
        });
        const writes = yield* session.writeHandleValues([
          { handle: a, value: 1001 },
          { handle: b, value: false },
        ] as const);
        const duplicate = yield* session
          .writeHandleValues([
            { handle: a, value: 1002 },
            { handle: a, value: 1003 },
          ] as const)
          .pipe(Effect.flip);
        return { writes, duplicate };
      }),
    );

    expect(Array.isArray(result.writes)).toBe(true);
    expect(result.writes).toMatchObject([
      { _tag: "Written", nodeId: "ns=1;s=MyMachine.SpeedSetpoint" },
      { _tag: "Written", nodeId: "ns=1;s=MyMachine.Axis1.Enabled" },
    ]);
    expect(result.duplicate).toMatchObject({
      _tag: "OpcuaConfigurationError",
      operation: "writeHandleValues",
    });
  });

  it("enforces requested write access during handle creation", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.valueHandle({
            nodeId: "ns=1;s=MyMachine.ReadOnlyNumber",
            capabilities: Capabilities.readWrite,
          });
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaAccessDeniedError",
      requestedCapability: "write",
    });
  });

  it("reads and writes scalar structure values", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const written = yield* session.writeValue({
          nodeId: "ns=1;s=MyMachine.ScanSettings",
          structure: ScanSettings,
          value: { duration: 1500, cycles: 7, dataAvailable: true },
        });
        const sample = yield* session.readValue({
          nodeId: "ns=1;s=MyMachine.ScanSettings",
          structure: ScanSettings,
          includeRaw: true,
        });
        const handle = yield* session.valueHandle({
          nodeId: "ns=1;s=MyMachine.ScanSettings",
          structure: ScanSettings,
          capabilities: Capabilities.readWrite,
        });
        const handleWrite = yield* handle.write({
          duration: 500,
          cycles: 2,
          dataAvailable: false,
        });
        const handleRead = yield* handle.read();
        return { written, sample, handleWrite, handleRead };
      }),
    );

    expect(result.written).toMatchObject({ _tag: "Written" });
    expect(result.sample).toMatchObject({
      _tag: "Value",
      value: { duration: 1500, cycles: 7, dataAvailable: true },
    });
    expect(
      result.sample._tag === "Value" && result.sample.raw?.variant,
    ).toBeDefined();
    expect(result.handleWrite).toMatchObject({ _tag: "Written" });
    expect(result.handleRead).toMatchObject({
      _tag: "Value",
      value: { duration: 500, cycles: 2, dataAvailable: false },
    });
  });

  it("reads and writes structure arrays", async () => {
    const queue = OpcuaStructure.array(ScanSettings);
    const values = [
      { duration: 10, cycles: 1, dataAvailable: true },
      { duration: 20, cycles: 2, dataAvailable: false },
    ];
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const written = yield* session.writeValue({
          nodeId: "ns=1;s=MyMachine.ScanSettingsQueue",
          structure: queue,
          value: values,
        });
        const sample = yield* session.readValue({
          nodeId: "ns=1;s=MyMachine.ScanSettingsQueue",
          structure: queue,
        });
        return { written, sample };
      }),
    );

    expect(result.written).toMatchObject({ _tag: "Written" });
    expect(result.sample).toMatchObject({ _tag: "Value", value: values });
  });

  it("rejects structure metadata mismatches at handle creation", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.valueHandle({
            nodeId: "ns=1;s=MyMachine.Temperature",
            structure: ScanSettings,
          });
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaConfigurationError",
    });
  });
});
