import { describe, expect, it } from "vitest";

import { readServerConfig, readTelemetryConfig } from "../src/server/config.js";

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

  it("keeps telemetry disabled without an OTLP endpoint", () => {
    expect(readTelemetryConfig({})).toEqual({ _tag: "Disabled" });
  });

  it("reads OTLP trace export settings", () => {
    expect(
      readTelemetryConfig({
        EFFECT_OPCUA_WEB_OTLP_ENDPOINT: "http://127.0.0.1:4318",
        EFFECT_OPCUA_WEB_OTLP_HEADERS: "x-api-key=secret,tenant=demo",
        EFFECT_OPCUA_WEB_OTLP_PROTOCOL: "http/json",
        OTEL_SERVICE_NAME: "effect-opcua-web",
      }),
    ).toEqual({
      _tag: "Otlp",
      protocol: "json",
      serviceName: "effect-opcua-web",
      tracesUrl: "http://127.0.0.1:4318/v1/traces",
      headers: {
        "x-api-key": "secret",
        tenant: "demo",
      },
    });
  });
});
