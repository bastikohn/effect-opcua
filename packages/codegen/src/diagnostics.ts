import { Effect } from "effect";

import { codegenError } from "./errors.js";
import type { CodegenIssue } from "./types.js";

const warningCodes = new Set([
  "browse.failure",
  "branch.pruned",
  "node.omitted",
  "node.multiPath",
  "variable.writeOnlySkipped",
  "codec.dynamicFallback",
  "codec.unsupportedArrayRank",
  "datatype.definitionMissing",
  "datatype.definitionUnsupported",
  "datatype.definitionFailure",
  "datatype.unionUnsupported",
  "enum.emptyName",
  "enum.nameCollision",
  "enum.memberEmptyName",
  "enum.memberNameCollision",
  "structure.emptyName",
  "structure.nameCollision",
  "structure.fieldEmptyName",
  "structure.fieldNameCollision",
  "structure.unsupportedField",
  "structure.recursiveField",
]);

export const issue = (
  code: string,
  input: Omit<CodegenIssue, "severity" | "code"> & {
    readonly severity?: CodegenIssue["severity"];
  },
): CodegenIssue => {
  const { severity, ...rest } = input;
  return {
    severity: severity ?? (warningCodes.has(code) ? "warning" : "info"),
    code,
    ...rest,
  };
};

export const errorIssue = (
  code: string,
  input: Omit<CodegenIssue, "severity" | "code">,
): CodegenIssue => issue(code, { ...input, severity: "error" });

export const sortIssues = (
  issues: readonly CodegenIssue[],
): readonly CodegenIssue[] =>
  [...issues].sort(
    (left, right) =>
      [
        severityRank(left.severity) - severityRank(right.severity),
        displayPath(left.path).localeCompare(displayPath(right.path)),
        displayPath(left.generatedPath).localeCompare(
          displayPath(right.generatedPath),
        ),
        (left.file ?? "").localeCompare(right.file ?? ""),
        left.code.localeCompare(right.code),
        (left.nodeId ?? "").localeCompare(right.nodeId ?? ""),
        left.message.localeCompare(right.message),
      ].find((value) => value !== 0) ?? 0,
  );

export const enforceIssuePolicy = (
  warningsAsErrors: boolean,
  issues: readonly CodegenIssue[],
) => {
  const promoted = warningsAsErrors
    ? issues.map((item) =>
        item.severity === "warning"
          ? ({ ...item, severity: "error" as const })
          : item,
      )
    : issues;
  return promoted.some((item) => item.severity === "error")
    ? Effect.fail(codegenError({ _tag: "IssuePolicyViolation" }, promoted))
    : Effect.succeed(sortIssues(promoted));
};

export const displayPath = (path: readonly string[] | undefined) =>
  path?.join(" / ") ?? "";

const severityRank = (severity: CodegenIssue["severity"]) => {
  switch (severity) {
    case "error":
      return 0;
    case "warning":
      return 1;
    case "info":
      return 2;
  }
};
