import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import * as OpcuaSession from "../src/OpcuaSession.js";
import { isOpcuaError } from "../src/OpcuaError.js";
import type { OpcuaBrowseReference } from "../src/internal/browse.js";
import {
  BrowseDirection,
  makeNodeClassMask,
  makeResultMask,
} from "../src/node-opcua.js";
import { makeLiveTestContext } from "./live.js";
import { demoNodeId } from "./support/demo-model.js";

const { runLive } = makeLiveTestContext("browse", 1);

const isConfigurationReason = (error: unknown) =>
  isOpcuaError(error) && error.reason._tag === "Configuration";

describe("browse", () => {
  it("moves node-opcua helpers to the node-opcua subpath", () => {
    expect(BrowseDirection.Forward).toBe(0);
    expect(makeResultMask("BrowseName")).toBeGreaterThan(0);
  });

  it("browses normalized child references from ObjectsFolder", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.browseChildren("i=85");
      }),
    );

    expect(result._tag).toBe("Browsed");
    const references = result._tag === "Browsed" ? result.references : [];
    const machine = references.find(
      (reference: OpcuaBrowseReference) =>
        reference.browseName?.name === "DemoFillingCell",
    );
    expect(machine).toMatchObject({
      nodeId: {
        text: expect.stringContaining("DemoFillingCell"),
        namespace: expect.any(Number),
        isLocal: true,
        isRemote: false,
      },
      nodeClass: "Object",
      browseName: {
        name: "DemoFillingCell",
      },
      displayName: {
        text: "DemoFillingCell",
      },
    });
    expect(machine?.unsafeRaw).toBeUndefined();
  });

  it("keeps lower-level browse raw fields opt-in", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.browse({
          nodeId: "ns=1;s=DemoFillingCell",
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

  it("discovers variable nodes through browseChildren", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.browseChildren(demoNodeId("State"), {
          nodeClassMask: makeNodeClassMask("Variable"),
        });
      }),
    );

    expect(result._tag).toBe("Browsed");
    if (result._tag !== "Browsed") return;
    expect(
      result.references.map((reference) => reference.browseName?.name),
    ).toEqual(
      expect.arrayContaining([
        "MachineState",
        "OperatingMode",
        "CyclePhase",
        "Ready",
        "ConfigurationValid",
      ]),
    );
    expect(
      result.references.every(
        (reference) => reference.nodeClass === "Variable",
      ),
    ).toBe(true);
  });

  it("returns browse non-good statuses as data", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.browse({ nodeId: " " });
        }),
      ),
    ).rejects.toSatisfy(isConfigurationReason);

    const missing = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.browse({ nodeId: "ns=1;s=missing" });
      }),
    );
    expect(missing).toMatchObject({
      _tag: "NonGoodStatus",
      status: { isGood: false },
    });
  });
});
