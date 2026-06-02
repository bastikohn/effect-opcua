import type { WritePolicy } from "../shared/rpc.js";

export type ServerConfig = {
  readonly host: string;
  readonly port: number;
  readonly writePolicy: WritePolicy;
};

export type TelemetryConfig =
  | {
      readonly _tag: "Disabled";
    }
  | {
      readonly _tag: "Otlp";
      readonly protocol: "json" | "protobuf";
      readonly serviceName: string;
      readonly tracesUrl: string;
      readonly headers?: Record<string, string>;
    };

export const readServerConfig = (env = process.env): ServerConfig => ({
  host: env.EFFECT_OPCUA_WEB_HOST ?? env.HOST ?? "127.0.0.1",
  port: readPort(env.EFFECT_OPCUA_WEB_PORT ?? env.PORT, 4123),
  writePolicy: readWritePolicyFromEnv(env),
});

export const readWritePolicy = (): WritePolicy =>
  readWritePolicyFromEnv(process.env);

export const readTelemetryConfig = (env = process.env): TelemetryConfig => {
  const explicit = nonEmpty(env.EFFECT_OPCUA_WEB_OTLP_TRACES_URL);
  const standard = nonEmpty(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT);
  const base =
    nonEmpty(env.EFFECT_OPCUA_WEB_OTLP_ENDPOINT) ??
    nonEmpty(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  const tracesUrl =
    explicit ?? standard ?? (base ? tracesEndpoint(base) : undefined);
  if (!tracesUrl) return { _tag: "Disabled" };
  return {
    _tag: "Otlp",
    protocol:
      readProtocol(env.EFFECT_OPCUA_WEB_OTLP_PROTOCOL) ??
      readProtocol(env.OTEL_EXPORTER_OTLP_PROTOCOL) ??
      "protobuf",
    serviceName: nonEmpty(env.OTEL_SERVICE_NAME) ?? "@effect-opcua/web-server",
    tracesUrl,
    headers: readHeaders(
      env.EFFECT_OPCUA_WEB_OTLP_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS,
    ),
  };
};

const readWritePolicyFromEnv = (env: NodeJS.ProcessEnv): WritePolicy =>
  env.EFFECT_OPCUA_WEB_WRITES === "disabled"
    ? { _tag: "Disabled" }
    : { _tag: "Enabled", reason: "RuntimeConfig" };

const readPort = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === "") return fallback;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
};

const nonEmpty = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const tracesEndpoint = (baseUrl: string) => {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1/traces") ? trimmed : `${trimmed}/v1/traces`;
};

const readProtocol = (value: string | undefined) => {
  switch (value) {
    case "json":
    case "http/json":
      return "json";
    case "protobuf":
    case "http/protobuf":
      return "protobuf";
    default:
      return undefined;
  }
};

const readHeaders = (
  value: string | undefined,
): Record<string, string> | undefined => {
  const headers = Object.fromEntries(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .flatMap((entry) => {
        const separator = entry.indexOf("=");
        if (separator <= 0) return [];
        return [
          [
            decodeURIComponent(entry.slice(0, separator).trim()),
            decodeURIComponent(entry.slice(separator + 1).trim()),
          ],
        ];
      }),
  );
  return Object.keys(headers).length > 0 ? headers : undefined;
};
