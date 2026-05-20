import { describe, expect, it } from "vitest";

import { Opcua } from "../src/index.js";
import { StatusCodes } from "../src/node-opcua.js";

describe("exports", () => {
  it("keeps the main API centered on definitions and handles", () => {
    expect(typeof Opcua.variable).toBe("function");
    expect(typeof Opcua.method).toBe("function");
    expect(typeof Opcua.arg).toBe("function");
    expect(typeof Opcua.schema).toBe("function");
    expect(StatusCodes.Good.isGood()).toBe(true);
  });
});
