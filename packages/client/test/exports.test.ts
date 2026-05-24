import { describe, expect, it } from "vitest";

import * as Root from "../src/index.js";
import * as Opcua from "../src/Opcua.js";
import * as OpcuaError from "../src/OpcuaError.js";
import { StatusCodes } from "../src/node-opcua.js";

describe("exports", () => {
  it("keeps the main API centered on definitions and direct operations", () => {
    expect(typeof Opcua.variable).toBe("function");
    expect(typeof Opcua.method).toBe("function");
    expect(typeof Opcua.arg).toBe("function");
    expect(Opcua.arg()).toMatchObject({ _tag: "MethodArg" });
    expect(typeof Opcua.schema).toBe("function");
    expect(typeof Opcua.structure).toBe("function");
    expect(typeof Opcua.structureArray).toBe("function");
    expect(Opcua).not.toHaveProperty("Structure");
    expect(typeof OpcuaError.OpcuaError).toBe("function");
    expect(typeof OpcuaError.isOpcuaError).toBe("function");
    expect(Root).toHaveProperty("OpcuaSession");
    expect(StatusCodes.Good.isGood()).toBe(true);
  });
});
