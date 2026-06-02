import { describe, expect, it } from "vitest";

import { readServerConfig } from "../src/server/config.js";

describe("web server config", () => {
  it("reads explicit web env names", () => {
    expect(
      readServerConfig({
        EFFECT_OPCUA_WEB_HOST: "0.0.0.0",
        EFFECT_OPCUA_WEB_PORT: "5123",
        EFFECT_OPCUA_WEB_WRITES: "disabled",
      }),
    ).toEqual({
      host: "0.0.0.0",
      port: 5123,
      writePolicy: { _tag: "Disabled" },
    });
  });

  it("falls back to defaults for invalid ports", () => {
    expect(
      readServerConfig({
        EFFECT_OPCUA_WEB_PORT: "not-a-port",
      }).port,
    ).toBe(4123);
  });
});
