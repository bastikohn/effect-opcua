import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";

import { Opcua, OpcuaSession } from "../src/index.js";
import { StatusCodes } from "../src/node-opcua.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext(4842);
const ScanSettingsSpec = Opcua.Structure.make({
  name: "ScanSettings",
  dataTypeId: "ns=1;i=3010",
  schema: Schema.Struct({
    duration: Schema.Number,
    cycles: Schema.Number,
    dataAvailable: Schema.Boolean,
  }),
});
const ScanSettings = Opcua.structure(ScanSettingsSpec);
const ScanSettingsQueue = Opcua.structureArray(
  Opcua.Structure.array(ScanSettingsSpec),
);

describe("values", () => {
  it("reads dynamic and schema-backed variables through handles", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const dynamic = yield* session.handle(
          Opcua.variable({ nodeId: "ns=1;s=MyMachine.Temperature" }),
        );
        const number = yield* session.handle(
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.Temperature",
            codec: Opcua.schema(Schema.Number),
          }),
        );
        const mismatch = yield* session.handle(
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.Temperature",
            codec: Opcua.schema(Schema.String),
          }),
        );
        return {
          dynamic: yield* dynamic.read(),
          number: yield* number.read(),
          mismatch: yield* mismatch.read(),
        };
      }),
    );

    expect(result.dynamic).toMatchObject({
      _tag: "Value",
      nodeId: "ns=1;s=MyMachine.Temperature",
      status: { isGood: true },
      variant: { dataType: "Double" },
    });
    expect(result.number).toMatchObject({
      _tag: "Value",
      value: expect.any(Number),
    });
    expect(result.mismatch).toMatchObject({
      _tag: "DecodeError",
      status: { isGood: true },
    });
  });

  it("creates access-shaped variable handles", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const readOnly = yield* session.handle(
          Opcua.variable({ nodeId: "ns=1;s=MyMachine.Temperature" }),
        );
        const writable = yield* session.handle(
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
            codec: Opcua.schema(Schema.Number),
            access: "readWrite",
          }),
        );
        const writeOnly = yield* session.handle(
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
            codec: Opcua.schema(Schema.Number),
            access: "write",
          }),
        );
        return {
          hasWrite: "write" in readOnly,
          hasRead: "read" in writable,
          writeOnlyHasRead: "read" in writeOnly,
          sample: yield* readOnly.read(),
          write: yield* writable.write(1234),
          writeOnly: yield* writeOnly.write(1235),
        };
      }),
    );

    expect(result.hasWrite).toBe(false);
    expect(result.hasRead).toBe(true);
    expect(result.writeOnlyHasRead).toBe(false);
    expect(result.sample).toMatchObject({ _tag: "Value" });
    expect(result.write).toMatchObject({ _tag: "Written" });
    expect(result.writeOnly).toMatchObject({ _tag: "Written" });
  });

  it("returns write statuses as data", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const setpoint = yield* session.handle(
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
            access: "readWrite",
          }),
        );
        return yield* setpoint.write(1400);
      }),
    );

    expect(result).toMatchObject({
      _tag: "Written",
      status: { text: StatusCodes.Good.toString() },
    });
  });

  it("keeps handle batch helpers thin and ordered", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const [speed, enabled] = yield* session.handleAll([
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
            access: "readWrite",
          }),
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.Axis1.Enabled",
            access: "readWrite",
          }),
        ] as const);
        return yield* Opcua.writeAll([
          { handle: speed, value: 1001 },
          { handle: enabled, value: false },
        ] as const);
      }),
    );

    expect(result).toMatchObject([
      { _tag: "Written", nodeId: "ns=1;s=MyMachine.SpeedSetpoint" },
      { _tag: "Written", nodeId: "ns=1;s=MyMachine.Axis1.Enabled" },
    ]);
  });

  it("enforces read/write access during handle creation", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.handle(
            Opcua.variable({
              nodeId: "ns=1;s=MyMachine.ReadOnlyNumber",
              access: "readWrite",
            }),
          );
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
        const handle = yield* session.handle(
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.ScanSettings",
            codec: ScanSettings,
            access: "readWrite",
            includeRaw: true,
          }),
        );
        const written = yield* handle.write({
          duration: 1500,
          cycles: 7,
          dataAvailable: true,
        });
        const sample = yield* handle.read();
        return { written, sample };
      }),
    );

    expect(result.written).toMatchObject({ _tag: "Written" });
    expect(result.sample).toMatchObject({
      _tag: "Value",
      value: { duration: 1500, cycles: 7, dataAvailable: true },
    });
    expect(
      result.sample._tag === "Value" && result.sample.unsafeRaw?.variant,
    ).toBeDefined();
  });

  it("reads and writes structure arrays", async () => {
    const values = [
      { duration: 10, cycles: 1, dataAvailable: true },
      { duration: 20, cycles: 2, dataAvailable: false },
    ];
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const queue = yield* session.handle(
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.ScanSettingsQueue",
            codec: ScanSettingsQueue,
            access: "readWrite",
          }),
        );
        const written = yield* queue.write(values);
        const sample = yield* queue.read();
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
          return yield* session.handle(
            Opcua.variable({
              nodeId: "ns=1;s=MyMachine.Temperature",
              codec: ScanSettings,
            }),
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaConfigurationError",
    });
  });
});
