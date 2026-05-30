import type { NormalizedCodegenConfig } from "../internal/types.js";

export const typeFallbackSeverity = (
  config: NormalizedCodegenConfig,
): "error" | "warning" =>
  config.diagnostics.typeFallback === "fail" ? "error" : "warning";
