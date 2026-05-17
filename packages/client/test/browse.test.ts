import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { BrowseDirection, makeResultMask } from "node-opcua";

import {
  BrowseDirection as ExportedBrowseDirection,
  OpcuaConfigurationError,
  OpcuaNonGoodStatusError,
  OpcuaSession,
  makeResultMask as exportedMakeResultMask,
} from "../src/index.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext(4841);

describe("browse", () => {
  it("keeps browse helper re-exports", () => {
    expect(ExportedBrowseDirection.Forward).toBe(BrowseDirection.Forward);
    expect(exportedMakeResultMask("BrowseName")).toBe(
      makeResultMask("BrowseName"),
    );
  });

  it("browses normalized child references from ObjectsFolder", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browseChildren("i=85");
      }),
    );

    const machine = result.references.find(
      (reference) => reference.browseName?.name === "MyMachine",
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
    expect(machine?.raw).toBeUndefined();
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

    expect(result.status).toMatchObject({ isGood: true });
    expect(result.raw).toBeDefined();
    expect(result.references[0]?.raw).toBeDefined();
    expect(result.references[0]?.browseName).toBeDefined();
  });

  it("fails invalid browse input before calling node-opcua", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browse({ nodeId: " " });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);

    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browse({ nodeId: "ns=1;s=missing" });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaNonGoodStatusError);
  });
});
