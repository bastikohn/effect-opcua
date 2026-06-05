import { describe, expect, it } from "vitest";

import { Opcua } from "@effect-opcua/client";
import * as Root from "@effect-opcua/client";
import { StatusCodes, UserTokenType } from "@effect-opcua/client/node-opcua";

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
