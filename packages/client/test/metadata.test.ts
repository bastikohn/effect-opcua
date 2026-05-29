import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import * as OpcuaSession from "../src/OpcuaSession.js";
import { NodeClass } from "../src/node-opcua.js";
import { makeLiveTestContext } from "./live.js";
import { demoNodeId } from "./support/demo-model.js";
import { makeFakeSession } from "./support/fake-session.js";

const { runLive } = makeLiveTestContext("metadata", 3);

describe("metadata", () => {
  it("reads and caches the namespace array", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            namespaceArray: [
              "http://opcfoundation.org/UA/",
              "urn:effect-opcua:metadata-test",
            ],
          });
          const first = yield* fake.session.readNamespaceArray();
          const second = yield* fake.session.readNamespaceArray();
          return { first, second, calls: fake.calls.valueReads.length };
        }),
      ),
    );

    expect(result.first).toEqual([
      "http://opcfoundation.org/UA/",
      "urn:effect-opcua:metadata-test",
    ]);
    expect(result.second).toEqual(result.first);
    expect(result.calls).toBe(1);
  });

  it("reads namespace array values from the demo server", async () => {
    const namespaces = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.readNamespaceArray();
      }),
    );

    expect(namespaces[0]).toBe("http://opcfoundation.org/UA/");
    expect(namespaces.length).toBeGreaterThan(1);
  });

  it("reads basic node and variable metadata from the demo server", async () => {
    const nodeId = demoNodeId("Filling.Tank.LevelMl");
    const metadata = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.readNodeMetadata(nodeId);
      }),
    );

    expect(metadata).toMatchObject({
      nodeId,
      nodeClass: "Variable",
      browseName: "LevelMl",
      displayName: "LevelMl",
      valueRank: -1,
      accessLevel: { readable: true },
      namespaceIndex: 1,
    });
    expect(metadata.dataType).toMatch(/i=11$/);
    expect(metadata.arrayDimensions).toBeUndefined();
    expect(metadata.userAccessLevel?.readable).toBe(true);
    expect(metadata.namespaceUri).toEqual(expect.any(String));
  });

  it("preserves input order and returns per-node failures in batch metadata reads", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            namespaceArray: ["http://opcfoundation.org/UA/", "urn:test"],
            nodeMetadata: {
              "ns=1;s=First": {
                nodeClass: NodeClass.Object,
                browseName: "First",
              },
              "ns=1;s=Second": {
                nodeClass: NodeClass.Variable,
                browseName: "Second",
              },
            },
            variableMetadata: {
              "ns=1;s=Second": {
                dataType: "i=12",
                valueRank: -1,
                accessLevel: 1,
                userAccessLevel: 1,
              },
            },
            missingNodeIds: ["ns=1;s=Missing"],
          });
          return yield* fake.session.readManyNodeMetadata([
            "ns=1;s=Second",
            "ns=1;s=Missing",
            "ns=1;s=First",
          ]);
        }),
      ),
    );

    expect(result.map((entry) => entry.nodeId)).toEqual([
      "ns=1;s=Second",
      "ns=1;s=Missing",
      "ns=1;s=First",
    ]);
    expect(result[0]).toMatchObject({
      _tag: "Success",
      metadata: {
        browseName: "Second",
        accessLevel: { readable: true, writable: false },
      },
    });
    expect(
      result[0]._tag === "Success" ? result[0].metadata.dataType : "",
    ).toMatch(/i=12$/);
    expect(result[1]).toMatchObject({
      _tag: "Failure",
      reason: { _tag: "NonGoodStatus", attribute: "NodeClass" },
    });
    expect(result[2]).toMatchObject({
      _tag: "Success",
      metadata: { browseName: "First", nodeClass: "Object" },
    });
  });

  it("chunks large batch metadata reads", async () => {
    const nodeIds = Array.from(
      { length: 51 },
      (_, index) => `ns=1;s=Node${index}`,
    );
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            namespaceArray: ["http://opcfoundation.org/UA/", "urn:test"],
          });
          const empty = yield* fake.session.readManyNodeMetadata([]);
          const large = yield* fake.session.readManyNodeMetadata(nodeIds);
          return { empty, large, calls: fake.calls.metadataReads };
        }),
      ),
    );

    expect(result.empty).toEqual([]);
    expect(result.large.map((entry) => entry.nodeId)).toEqual(nodeIds);
    expect(result.calls.map((batch) => batch.length)).toEqual([450, 9]);
  });
});
