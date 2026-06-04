import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { browseNode, readNode, writeNode } from "../src/server/dto.js";
import {
  badStatus,
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

    const result = await Effect.runPromise(browseNode(session, "i=85", 100));

    expect(result.response._tag).toBe("Browsed");
    if (result.response._tag !== "Browsed")
      throw new Error("expected browsed result");
    expect(result.response.references).toHaveLength(1);
    expect(result.response.references[0]).toMatchObject({
      nodeId: "ns=1;s=Temperature",
      displayName: "Temperature",
      metadata: {
        nodeClass: "Variable",
        dataType: "i=11",
        namespaceUri: "urn:test",
      },
    });
  });

  it("returns non-good browse status as result data", async () => {
    const session = makeFakeSession({
      metadata: {
        "i=85": objectMetadata("i=85"),
      },
      browseStatus: badStatus,
    });

    await expect(
      Effect.runPromise(browseNode(session, "i=85", 100)),
    ).resolves.toEqual({
      response: {
        _tag: "NonGoodStatus",
        nodeId: "i=85",
        status: badStatus,
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
    await expect(
      Effect.runPromise(readNode(missing, "ns=1;s=Missing")),
    ).resolves.toMatchObject({
      dataTypeDefinition: {
        _tag: "Missing",
        dataTypeNodeId: "i=11",
      },
    });

    const failed = {
      ...missing,
      readDataTypeDefinition: () => Effect.fail(new Error("boom") as never),
    };
    await expect(
      Effect.runPromise(readNode(failed, "ns=1;s=Missing")),
    ).resolves.toMatchObject({
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
    expect(result.attemptedValue).toBe(12);
    expect(result.writtenAt).toEqual(expect.any(String));
    expect(result.refreshed.value).toMatchObject({ value: 12 });
  });

  it("returns non-good write status as data", async () => {
    const session = makeFakeSession({
      metadata: {
        "ns=1;s=Setpoint": variableMetadata("ns=1;s=Setpoint"),
      },
      writeStatus: {
        _tag: "NonGoodStatus",
        nodeId: "ns=1;s=Setpoint",
        status: badStatus,
      },
    });

    const result = await Effect.runPromise(
      writeNode(session, "ns=1;s=Setpoint", 12),
    );

    expect(result.write).toEqual({
      _tag: "NonGoodStatus",
      nodeId: "ns=1;s=Setpoint",
      status: badStatus,
    });
  });

  it("fails write RPC DTOs for write operation failures", async () => {
    const session = makeFakeSession({
      metadata: {
        "ns=1;s=Setpoint": variableMetadata("ns=1;s=Setpoint"),
      },
      writeFailure: new Error("socket closed"),
    });

    await expect(
      Effect.runPromise(writeNode(session, "ns=1;s=Setpoint", 12)),
    ).rejects.toMatchObject({
      _tag: "WebRpcError",
      category: "Unexpected",
      operation: "WriteNode",
      nodeId: "ns=1;s=Setpoint",
      message: "socket closed",
    });
  });
});
