import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { coerceNodeId } from "../src/node-opcua.js";
import { makeFakeSession } from "./support/fake-session.js";

describe("data type definitions", () => {
  it("normalizes enum and structure definitions in input order", async () => {
    const results = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            nodeMetadata: {
              "ns=1;i=3001": { browseName: "Machine.State" },
              "ns=1;i=4001": { browseName: "Command.Payload" },
            },
            dataTypeDefinitions: {
              "ns=1;i=3001": {
                fields: [
                  {
                    name: "Idle",
                    value: [0, 0],
                    description: { text: "Machine is idle." },
                  },
                  { name: "Running", value: [0, 1] },
                  { name: "Faulted", value: [-1, 0xffffffff] },
                ],
              },
              "ns=1;i=4001": {
                structureType: 0,
                fields: [
                  {
                    name: "state",
                    dataType: coerceNodeId("ns=1;i=3001"),
                    valueRank: -1,
                    description: { text: "Current command state." },
                  },
                  {
                    name: "samples",
                    dataType: coerceNodeId("i=11"),
                    valueRank: 1,
                    arrayDimensions: [3],
                    isOptional: true,
                  },
                ],
              },
            },
          });
          return yield* fake.session.readManyDataTypeDefinitions([
            "ns=1;i=4001",
            "ns=1;i=3001",
          ]);
        }),
      ),
    );

    expect(results[0]).toMatchObject({
      _tag: "Success",
      dataTypeNodeId: "ns=1;i=4001",
      definition: {
        _tag: "Structure",
        name: "Command.Payload",
        structureType: "Structure",
        fields: [
          {
            name: "state",
            dataTypeNodeId: "ns=1;i=3001",
            valueRank: -1,
            description: "Current command state.",
          },
          {
            name: "samples",
            valueRank: 1,
            arrayDimensions: [3],
            isOptional: true,
          },
        ],
      },
    });
    expect(
      results[0]._tag === "Success"
        ? results[0].definition._tag === "Structure"
          ? results[0].definition.fields[1]?.dataTypeNodeId
          : ""
        : "",
    ).toMatch(/i=11$/);

    expect(results[1]).toMatchObject({
      _tag: "Success",
      dataTypeNodeId: "ns=1;i=3001",
      definition: {
        _tag: "Enum",
        name: "Machine.State",
        fields: [
          { name: "Idle", value: 0, description: "Machine is idle." },
          { name: "Running", value: 1 },
          { name: "Faulted", value: -1 },
        ],
      },
    });
  });

  it("returns per-node missing, unsupported, and failure results", async () => {
    const results = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            dataTypeDefinitions: {
              "ns=1;i=5001": 42,
              "ns=1;i=5002": {
                fields: [{ name: "Broken", value: "not numeric" }],
              },
            },
          });
          return yield* fake.session.readManyDataTypeDefinitions([
            "ns=1;i=5000",
            "ns=1;i=5001",
            "ns=1;i=5002",
          ]);
        }),
      ),
    );

    expect(results.map((result) => result._tag)).toEqual([
      "Missing",
      "Unsupported",
      "Failure",
    ]);
    expect(results[0]).toMatchObject({
      _tag: "Missing",
      dataTypeNodeId: "ns=1;i=5000",
    });
    expect(results[1]).toMatchObject({
      _tag: "Unsupported",
      reason: "DataTypeDefinition is not an object",
    });
    expect(results[2]).toMatchObject({
      _tag: "Failure",
      reason: "Enum value is not numeric: not numeric",
    });
  });

  it("falls back to EnumValues and EnumStrings properties for enum definitions", async () => {
    const results = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            nodeMetadata: {
              "ns=1;i=6001": { browseName: "Machine.Mode" },
              "ns=1;i=6002": { browseName: "Legacy.State" },
            },
            dataTypeEnumValues: {
              "ns=1;i=6001": [
                { value: [0, 10], displayName: { text: "Setup" } },
                {
                  value: [0, 20],
                  displayName: { text: "Automatic" },
                  description: { text: "Automatic operation" },
                },
              ],
            },
            dataTypeEnumStrings: {
              "ns=1;i=6002": [{ text: "Idle" }, { text: "Running" }],
            },
          });
          return yield* fake.session.readManyDataTypeDefinitions([
            "ns=1;i=6001",
            "ns=1;i=6002",
          ]);
        }),
      ),
    );

    expect(results).toMatchObject([
      {
        _tag: "Success",
        definition: {
          _tag: "Enum",
          name: "Machine.Mode",
          fields: [
            { name: "Setup", value: 10 },
            {
              name: "Automatic",
              value: 20,
              description: "Automatic operation",
            },
          ],
        },
      },
      {
        _tag: "Success",
        definition: {
          _tag: "Enum",
          name: "Legacy.State",
          fields: [
            { name: "Idle", value: 0, description: "Idle" },
            { name: "Running", value: 1, description: "Running" },
          ],
        },
      },
    ]);
  });
});
