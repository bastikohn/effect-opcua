import type { NormalizedCodegenConfig } from "../types.js";

export const unsupportedTypeSeverity = (
  config: NormalizedCodegenConfig,
): "error" | "warning" =>
  config.diagnostics.unsupportedTypes === "error" ? "error" : "warning";
