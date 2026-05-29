import { Effect } from "effect";

import { codegenError } from "./errors.js";
import type { CodegenDiagnostic, CodegenDiagnosticCode } from "./types.js";

const warningCodes = new Set<CodegenDiagnosticCode>([
  "codec.dynamicFallback",
  "codec.unsupportedArrayRank",
  "variable.writeOnlySkipped",
  "method.malformedArgumentsSkipped",
  "enum.metadataMissing",
  "enum.memberNameCollision",
]);

export const diagnostic = (
  code: CodegenDiagnosticCode,
  input: Omit<CodegenDiagnostic, "severity" | "code">,
): CodegenDiagnostic => ({
  severity: warningCodes.has(code) ? "warning" : "info",
  code,
  ...input,
});

export const sortDiagnostics = (
  diagnostics: readonly CodegenDiagnostic[],
): readonly CodegenDiagnostic[] =>
  [...diagnostics].sort(
    (left, right) =>
      [
        severityRank(left.severity) - severityRank(right.severity),
        (left.browsePath ?? "").localeCompare(right.browsePath ?? ""),
        (left.file ?? "").localeCompare(right.file ?? ""),
        left.code.localeCompare(right.code),
        (left.nodeId ?? "").localeCompare(right.nodeId ?? ""),
        left.message.localeCompare(right.message),
      ].find((value) => value !== 0) ?? 0,
  );

export const enforceDiagnosticsPolicy = (
  warningsAsErrors: boolean,
  diagnostics: readonly CodegenDiagnostic[],
) =>
  warningsAsErrors && diagnostics.some((item) => item.severity === "warning")
    ? Effect.fail(
        codegenError({ _tag: "DiagnosticsPolicyViolation" }, diagnostics),
      )
    : Effect.succeed(diagnostics);

const severityRank = (severity: CodegenDiagnostic["severity"]) =>
  severity === "warning" ? 0 : 1;
