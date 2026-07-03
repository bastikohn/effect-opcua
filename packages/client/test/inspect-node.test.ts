import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { coerceNodeId, NodeClass } from "@effect-opcua/client/node-opcua";
import { makeFakeSession } from "./support/fake-session.js";

const isNamespaceArrayRead = (nodeId: string | undefined) =>
  nodeId === "i=2255" || nodeId === "ns=0;i=2255";

describe("inspectNode", () => {
  it("reads metadata only by default and skips value reads", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            nodeMetadata: {
              "ns=1;s=Temperature": { browseName: "Temperature" },
            },
          });
          const inspection =
            yield* fake.session.inspectNode("ns=1;s=Temperature");
          return { inspection, valueReads: fake.calls.valueReads };
        }),
      ),
    );

    expect(result.inspection.metadata).toMatchObject({
      nodeId: "ns=1;s=Temperature",
      nodeClass: "Variable",
      browseName: "Temperature",
      accessLevel: { readable: true, writable: true },
    });
    expect(result.inspection.value).toBeUndefined();
    expect(result.inspection.dataTypeDefinition).toBeUndefined();
    expect(
      result.valueReads
        .flat()
        .every((node) => isNamespaceArrayRead(node.nodeId?.toString())),
    ).toBe(true);
  });

  it("reads the value when requested", async () => {
    const inspection = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            nodeMetadata: {
              "ns=1;s=Temperature": { browseName: "Temperature" },
            },
          });
          return yield* fake.session.inspectNode("ns=1;s=Temperature", {
            value: true,
          });
        }),
      ),
    );

    expect(inspection.value).toMatchObject({
      _tag: "Value",
      nodeId: "ns=1;s=Temperature",
      value: 0,
      status: { isGood: true },
    });
  });

  it("reports unreadable variables without reading the value", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            nodeMetadata: {
              "ns=1;s=Sealed": { browseName: "Sealed" },
            },
            variableMetadata: {
              "ns=1;s=Sealed": { accessLevel: 0, userAccessLevel: 0 },
            },
          });
          const inspection = yield* fake.session.inspectNode("ns=1;s=Sealed", {
            value: true,
          });
          return { inspection, valueReads: fake.calls.valueReads };
        }),
      ),
    );

    expect(result.inspection.value).toEqual({
      _tag: "NotReadable",
      nodeId: "ns=1;s=Sealed",
    });
    expect(
      result.valueReads
        .flat()
        .every((node) => isNamespaceArrayRead(node.nodeId?.toString())),
    ).toBe(true);
  });

  it("captures value read failures without failing the inspection", async () => {
    const inspection = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            nodeMetadata: {
              "ns=1;s=Broken": { browseName: "Broken" },
            },
            readValues: () => {
              throw new Error("read exploded");
            },
          });
          return yield* fake.session.inspectNode("ns=1;s=Broken", {
            value: true,
          });
        }),
      ),
    );

    expect(inspection.metadata.browseName).toBe("Broken");
    expect(inspection.value).toMatchObject({
      _tag: "ReadFailed",
      nodeId: "ns=1;s=Broken",
    });
  });

  it("resolves the data type definition when requested", async () => {
    const inspection = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            nodeMetadata: {
              "ns=1;s=Command": { browseName: "Command" },
              "ns=1;i=4001": {
                nodeClass: NodeClass.DataType,
                browseName: "Command.Payload",
              },
            },
            variableMetadata: {
              "ns=1;s=Command": { dataType: "ns=1;i=4001" },
            },
            dataTypeDefinitions: {
              "ns=1;i=4001": {
                structureType: 0,
                fields: [
                  {
                    name: "state",
                    dataType: coerceNodeId("i=6"),
                    valueRank: -1,
                  },
                ],
              },
            },
          });
          return yield* fake.session.inspectNode("ns=1;s=Command", {
            dataTypeDefinition: true,
          });
        }),
      ),
    );

    expect(inspection.value).toBeUndefined();
    expect(inspection.dataTypeDefinition).toMatchObject({
      _tag: "Success",
      dataTypeNodeId: "ns=1;i=4001",
      definition: {
        _tag: "Structure",
        name: "Command.Payload",
        fields: [{ name: "state" }],
      },
    });
  });
});
