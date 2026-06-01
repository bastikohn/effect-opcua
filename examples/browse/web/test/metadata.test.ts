import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { browseNode, readNode, writeNode } from "../src/server/dto.js";
import {
  goodStatus,
  makeFakeSession,
  objectMetadata,
  variableMetadata,
} from "./support/fake-session.js";

describe("metadata enrichment", () => {
  it("adds metadata to browsed children", async () => {
    const session = makeFakeSession({
      metadata: {
        "i=85": objectMetadata("i=85"),
        "ns=1;s=Temperature": variableMetadata("ns=1;s=Temperature"),
      },
    });

    const result = await Effect.runPromise(browseNode(session, "i=85"));

    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      nodeId: "ns=1;s=Temperature",
      displayName: "Temperature",
      metadata: {
        nodeClass: "Variable",
        dataType: "i=11",
        namespaceUri: "urn:test",
      },
    });
  });

  it("reads selected variable details with value and data type definition", async () => {
    const session = makeFakeSession({
      metadata: {
        "ns=1;s=Temperature": variableMetadata("ns=1;s=Temperature"),
      },
      values: {
        "ns=1;s=Temperature": {
          _tag: "Value",
          nodeId: "ns=1;s=Temperature",
          value: 21.5,
          status: goodStatus,
        },
      },
      definitions: {
        "i=11": {
          _tag: "Success",
          dataTypeNodeId: "i=11",
          definition: {
            _tag: "Enum",
            dataTypeNodeId: "i=11",
            name: "Double",
            fields: [],
          },
        },
      },
    });

    const result = await Effect.runPromise(
      readNode(session, "ns=1;s=Temperature"),
    );

    expect(result.value).toMatchObject({ _tag: "Value", value: 21.5 });
    expect(result.dataTypeDefinition).toMatchObject({
      _tag: "Success",
      dataTypeNodeId: "i=11",
    });
  });

  it("surfaces missing and failed data type definitions as DTOs", async () => {
    const missing = makeFakeSession({
      metadata: {
        "ns=1;s=Missing": variableMetadata("ns=1;s=Missing"),
      },
    });
    await expect(Effect.runPromise(readNode(missing, "ns=1;s=Missing")))
      .resolves.toMatchObject({
        dataTypeDefinition: {
          _tag: "Missing",
          dataTypeNodeId: "i=11",
        },
      });

    const failed = {
      ...missing,
      readDataTypeDefinition: () => Effect.fail(new Error("boom") as never),
    };
    await expect(Effect.runPromise(readNode(failed, "ns=1;s=Missing")))
      .resolves.toMatchObject({
        dataTypeDefinition: {
          _tag: "Failure",
          reason: "boom",
        },
      });
  });

  it("writes and refreshes the selected value", async () => {
    const writes: Array<unknown> = [];
    const session = makeFakeSession({
      metadata: {
        "ns=1;s=Setpoint": variableMetadata("ns=1;s=Setpoint"),
      },
      onWrite: (_nodeId, value) => writes.push(value),
    });

    const result = await Effect.runPromise(
      writeNode(session, "ns=1;s=Setpoint", 12),
    );

    expect(writes).toEqual([12]);
    expect(result.write).toMatchObject({ _tag: "Written" });
    expect(result.refreshed.value).toMatchObject({ value: 12 });
  });
});
