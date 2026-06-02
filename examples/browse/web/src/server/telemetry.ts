import { NodeHttpClient } from "@effect/platform-node";
import { Layer } from "effect";
import { OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

import { readTelemetryConfig, type TelemetryConfig } from "./config.js";

export const telemetryLayer = (
  config: TelemetryConfig = readTelemetryConfig(),
): Layer.Layer<never> => {
  if (config._tag === "Disabled") return Layer.empty;
  const serialization =
    config.protocol === "json"
      ? OtlpSerialization.layerJson
      : OtlpSerialization.layerProtobuf;
  return OtlpTracer.layer({
    url: config.tracesUrl,
    resource: { serviceName: config.serviceName },
    headers: config.headers,
  }).pipe(
    Layer.provide(serialization),
    Layer.provide(NodeHttpClient.layerUndici),
  );
};
