import { describe, expect, it } from "vitest";

import { normalizeConfig } from "../src/config.js";
import { metadataTargetNodeIds } from "../src/discover.js";
import { Effect } from "effect";

describe("discover", () => {
  it("does not read metadata for pruned or omitted children", async () => {
    const config = await Effect.runPromise(
      normalizeConfig({
        endpointUrl: "opc.tcp://fixture.invalid:4840",
        outputDir: "/tmp/effect-opcua-codegen-fixture",
        roots: [{ path: ["Root"] }],
        exclude: [
          { path: ["Root", "Pruned"], mode: "prune" },
          { path: ["Root", "Omitted"], mode: "omit" },
        ],
      }),
    );

    expect(
      metadataTargetNodeIds(
        [
          child("ns=2;s=Root.Kept", "Kept"),
          child("ns=2;s=Root.Pruned", "Pruned"),
          child("ns=2;s=Root.Omitted", "Omitted"),
        ],
        config.exclude,
        ["Root"],
      ),
    ).toEqual(["ns=2;s=Root.Kept"]);
  });
});

const child = (nodeId: string, browseName: string) => ({
  nodeId: { text: nodeId },
  browseName: { name: browseName },
});
