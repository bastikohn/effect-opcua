import { describe, expect, it } from "vitest";

import * as root from "@effect-opcua/client";
import * as raw from "@effect-opcua/client/node-opcua";

describe("client exports", () => {
  it("keeps the root runtime surface small", () => {
    const expectedRootKeys = [
      "BufferPolicy",
      "MonitorDeadband",
      "MonitorFilter",
      "Opcua",
      "OpcuaClient",
      "OpcuaError",
      "OpcuaSession",
    ];

    expect(Object.keys(root).sort()).toEqual(expectedRootKeys);
    expect(root.Opcua).toBeDefined();
    expect(root.OpcuaClient).toBeDefined();
    expect(root.OpcuaError).toBeDefined();
    expect(root.OpcuaSession).toBeDefined();
    expect("OpcuaVariable" in root).toBe(false);
    expect("OpcuaMethod" in root).toBe(false);
    expect("OpcuaSubscription" in root).toBe(false);
  });

  it("keeps node-opcua available through the explicit subpath", () => {
    expect(raw.StatusCodes.Good.isGood()).toBe(true);
    expect(raw.DataType.Double).toBeDefined();
    expect(raw.Variant).toBeDefined();
  });
});
