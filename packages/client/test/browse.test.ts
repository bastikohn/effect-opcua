import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { OpcuaSession, type OpcuaBrowseReference } from "../src/index.js";
import { OpcuaConfigurationError } from "../src/errors.js";
import {
  BrowseDirection,
  makeNodeClassMask,
  makeResultMask,
} from "../src/node-opcua.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext(4841);

describe("browse", () => {
  it("moves node-opcua helpers to the node-opcua subpath", () => {
    expect(BrowseDirection.Forward).toBe(0);
    expect(makeResultMask("BrowseName")).toBeGreaterThan(0);
  });

  it("browses normalized child references from ObjectsFolder", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browseChildren("i=85");
      }),
    );

    expect(result._tag).toBe("Browsed");
    const references = result._tag === "Browsed" ? result.references : [];
    const machine = references.find(
      (reference: OpcuaBrowseReference) =>
        reference.browseName?.name === "MyMachine",
    );
    expect(machine).toMatchObject({
      nodeId: {
        text: expect.stringContaining("MyMachine"),
        namespace: expect.any(Number),
        isLocal: true,
        isRemote: false,
      },
      nodeClass: "Object",
      browseName: {
        name: "MyMachine",
      },
      displayName: {
        text: "MyMachine",
      },
    });
    expect(machine?.unsafeRaw).toBeUndefined();
  });

  it("keeps lower-level browse raw fields opt-in", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browse({
          nodeId: "ns=1;s=MyMachine",
          resultMask: makeResultMask("BrowseName"),
          includeRaw: true,
        });
      }),
    );

    expect(result).toMatchObject({ _tag: "Browsed" });
    if (result._tag !== "Browsed") return;
    expect(result.status).toMatchObject({ isGood: true });
    expect(result.unsafeRaw).toBeDefined();
    expect(result.references[0]?.unsafeRaw).toBeDefined();
    expect(result.references[0]?.browseName).toBeDefined();
  });

  it("discovers method nodes through browseChildren", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browseChildren("ns=1;s=MyMachine", {
          nodeClassMask: makeNodeClassMask("Method"),
        });
      }),
    );

    expect(result._tag).toBe("Browsed");
    if (result._tag !== "Browsed") return;
    expect(
      result.references.map((reference) => reference.browseName?.name),
    ).toEqual(
      expect.arrayContaining([
        "Start",
        "Reset",
        "Echo",
        "RejectIfNegative",
        "DisabledCommand",
      ]),
    );
    expect(
      result.references.every((reference) => reference.nodeClass === "Method"),
    ).toBe(true);
  });

  it("returns browse non-good statuses as data", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browse({ nodeId: " " });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);

    const missing = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browse({ nodeId: "ns=1;s=missing" });
      }),
    );
    expect(missing).toMatchObject({
      _tag: "NonGoodStatus",
      status: { isGood: false },
    });
  });
});
