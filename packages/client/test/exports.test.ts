import { describe, expect, it } from "vitest";

import * as Opcua from "../src/Opcua.js";
import * as Root from "../src/index.js";
import { StatusCodes, UserTokenType } from "../src/node-opcua.js";

describe("exports", () => {
  it("keeps the root API small and intentional", () => {
    expect(Object.keys(Root).sort()).toEqual([
      "BufferPolicy",
      "MonitorDeadband",
      "MonitorFilter",
      "Opcua",
      "OpcuaClient",
      "OpcuaError",
      "OpcuaSession",
    ]);
    expect(Root).not.toHaveProperty("OpcuaMethod");
    expect(Root).not.toHaveProperty("OpcuaSubscription");
    expect(Root).not.toHaveProperty("OpcuaVariable");
    expect(Root.Opcua).not.toHaveProperty("Codec");
    expect(Root.OpcuaSession).not.toHaveProperty("makeSession");
    expect(Root.OpcuaClient).not.toHaveProperty("makeOpcuaClient");
    expect(typeof Root.OpcuaError.OpcuaError).toBe("function");
    expect(typeof Root.OpcuaError.isOpcuaError).toBe("function");
  });

  it("keeps the definition namespace centered on public definitions", () => {
    expect(typeof Opcua.variable).toBe("function");
    expect(typeof Opcua.method).toBe("function");
    expect(typeof Opcua.arg).toBe("function");
    expect(Opcua.arg()).toMatchObject({ _tag: "MethodArg" });
    expect(typeof Opcua.schema).toBe("function");
    expect(typeof Opcua.structure).toBe("function");
    expect(typeof Opcua.structureArray).toBe("function");
    expect(Opcua).not.toHaveProperty("Structure");
    expect(Opcua).not.toHaveProperty("Codec");
    expect(StatusCodes.Good.isGood()).toBe(true);
    expect(UserTokenType.Anonymous).toBe(0);
  });
});
