import { describe, expect, it } from "vitest";

import { Capabilities, capabilities } from "../src/index.js";

describe("capabilities", () => {
  it("keeps capability presets", () => {
    expect(capabilities("read", "write")).toEqual(["read", "write"]);
    expect(Capabilities.read).toEqual(["read"]);
    expect(Capabilities.write).toEqual(["write"]);
    expect(Capabilities.readWrite).toEqual(["read", "write"]);
  });
});
