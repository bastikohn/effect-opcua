import { Data } from "effect";

import type { CodegenIssue } from "./types.js";

export class CodegenError extends Data.TaggedError("CodegenError")<{
  readonly reason: CodegenErrorReason;
  readonly issues: readonly CodegenIssue[];
}> {}

export type CodegenErrorReason =
  | { readonly _tag: "Config"; readonly path?: string }
  | { readonly _tag: "Discovery" }
  | { readonly _tag: "Compile" }
  | { readonly _tag: "Output" };

export const codegenError = (
  reason: CodegenErrorReason,
  issues: readonly CodegenIssue[] = [],
) => new CodegenError({ reason, issues });

export const invalidConfig = (message: string, cause?: unknown) =>
  codegenError({ _tag: "Config" }, [
    {
      severity: "error",
      code: "config.invalid",
      message,
      cause,
    },
  ]);
