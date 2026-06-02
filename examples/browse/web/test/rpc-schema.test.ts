import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import {
  ConnectRequestSchema,
  JsonValueSchema,
  UaBrowserRpcs,
  WebRpcError,
} from "../src/shared/rpc.js";
import { parseJsonValue, toJsonValue } from "../src/shared/value.js";

describe("RPC schemas and value normalization", () => {
  it("defines the expected RPC surface", () => {
    expect([...UaBrowserRpcs.requests.keys()]).toEqual([
      "GetConfig",
      "Connect",
      "Disconnect",
      "Browse",
      "ReleaseBrowseContinuation",
      "ReadNode",
      "WriteNode",
      "MonitorValues",
    ]);
  });

  it("decodes connect payloads", () => {
    const decode = Schema.decodeUnknownSync(ConnectRequestSchema);
    expect(
      decode({
        endpointUrl: "opc.tcp://localhost:4840",
        startNodeId: "i=85",
        auth: { _tag: "Anonymous" },
      }),
    ).toMatchObject({
      endpointUrl: "opc.tcp://localhost:4840",
      auth: { _tag: "Anonymous" },
    });
  });

  it("keeps web RPC errors browser-safe", () => {
    const error = new WebRpcError({
      category: "Session",
      operation: "Session",
      message: "No active OPC UA session",
    });

    expect(error).toMatchObject({
      _tag: "WebRpcError",
      category: "Session",
      operation: "Session",
      message: "No active OPC UA session",
    });
    expect("cause" in error).toBe(false);
  });

  it("keeps values JSON safe", () => {
    const normalized = toJsonValue({
      ok: true,
      when: new Date("2026-05-31T10:00:00.000Z"),
      bytes: new Uint8Array([1, 2, 3]),
      nested: [1, Number.NaN, BigInt(7)],
    });
    expect(normalized).toEqual({
      ok: true,
      when: { _tag: "DateTime", iso: "2026-05-31T10:00:00.000Z" },
      bytes: { _tag: "ByteString", base64: "AQID" },
      nested: [1, null, { _tag: "BigInt", text: "7" }],
    });
    expect(Schema.decodeUnknownSync(JsonValueSchema)(normalized)).toEqual(
      normalized,
    );
  });

  it("parses write input through the shared serializer", () => {
    expect(parseJsonValue('{"value":42,"array":[true,null]}')).toEqual({
      value: 42,
      array: [true, null],
    });
  });
});
