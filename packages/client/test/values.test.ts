import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import { StatusCodes } from "node-opcua";

import { Capabilities, OpcuaSession } from "../src/index.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext(4842);

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
});
