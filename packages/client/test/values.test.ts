import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";

import * as Opcua from "../src/Opcua.js";
import * as OpcuaSession from "../src/OpcuaSession.js";
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
  it("reads dynamic and schema-backed variables through definitions", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return {
          dynamic: yield* session.read(
            Opcua.variable({ nodeId: "ns=1;s=MyMachine.Temperature" }),
          ),
          number: yield* session.read(
            Opcua.variable({
              nodeId: "ns=1;s=MyMachine.Temperature",
              codec: Opcua.schema(Schema.Number),
            }),
          ),
          mismatch: yield* session.read(
            Opcua.variable({
              nodeId: "ns=1;s=MyMachine.Temperature",
              codec: Opcua.schema(Schema.String),
            }),
          ),
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

  it("reads and writes access-shaped variable definitions", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        const readOnly = Opcua.variable({
          nodeId: "ns=1;s=MyMachine.Temperature",
        });
        const writable = Opcua.variable({
          nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
          codec: Opcua.schema(Schema.Number),
          access: "readWrite",
        });
        const writeOnly = Opcua.variable({
          nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
          codec: Opcua.schema(Schema.Number),
          access: "write",
        });
        return {
          sample: yield* session.read(readOnly),
          write: yield* session.write(writable, 1234),
          writeOnly: yield* session.write(writeOnly, 1235),
        };
      }),
    );

    expect(result.sample).toMatchObject({ _tag: "Value" });
    expect(result.write).toMatchObject({ _tag: "Written" });
    expect(result.writeOnly).toMatchObject({ _tag: "Written" });
  });

  it("returns write statuses as data", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.write(
          Opcua.variable({
            nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
            access: "readWrite",
          }),
          1400,
        );
      }),
    );

    expect(result).toMatchObject({
      _tag: "Written",
      status: { text: StatusCodes.Good.toString() },
    });
  });

  it("keeps keyed batch helpers thin and ordered", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        return yield* OpcuaSession.writeMany({
          speed: [
            Opcua.variable({
              nodeId: "ns=1;s=MyMachine.SpeedSetpoint",
              access: "readWrite",
            }),
            1001,
          ],
          enabled: [
            Opcua.variable({
              nodeId: "ns=1;s=MyMachine.Axis1.Enabled",
              access: "readWrite",
            }),
            false,
          ],
        } as const);
      }),
    );

    expect(result).toMatchObject({
      speed: { _tag: "Written", nodeId: "ns=1;s=MyMachine.SpeedSetpoint" },
      enabled: { _tag: "Written", nodeId: "ns=1;s=MyMachine.Axis1.Enabled" },
    });
  });

  it("enforces read/write access before direct writes", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.write(
            Opcua.variable({
              nodeId: "ns=1;s=MyMachine.ReadOnlyNumber",
              access: "readWrite",
            }),
            1,
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "AccessDenied", requestedCapability: "write" },
    });
  });

  it("reads and writes scalar structure values", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        const def = Opcua.variable({
          nodeId: "ns=1;s=MyMachine.ScanSettings",
          codec: ScanSettings,
          access: "readWrite",
          includeRaw: true,
        });
        const written = yield* session.write(def, {
          duration: 1500,
          cycles: 7,
          dataAvailable: true,
        });
        const sample = yield* session.read(def);
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
        const session = yield* OpcuaSession.OpcuaSession;
        const queue = Opcua.variable({
          nodeId: "ns=1;s=MyMachine.ScanSettingsQueue",
          codec: ScanSettingsQueue,
          access: "readWrite",
        });
        const written = yield* session.write(queue, values);
        const sample = yield* session.read(queue);
        return { written, sample };
      }),
    );

    expect(result.written).toMatchObject({ _tag: "Written" });
    expect(result.sample).toMatchObject({ _tag: "Value", value: values });
  });

  it("rejects structure metadata mismatches before reads", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.read(
            Opcua.variable({
              nodeId: "ns=1;s=MyMachine.Temperature",
              codec: ScanSettings,
            }),
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "Configuration" },
    });
  });
});
