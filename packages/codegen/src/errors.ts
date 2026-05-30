import { Data } from "effect";

import type { CodegenIssue } from "./types.js";

export class CodegenError extends Data.TaggedError("CodegenError")<{
  readonly reason: CodegenErrorReason;
  readonly issues: readonly CodegenIssue[];
}> {}

export type CodegenErrorReason =
  | { readonly _tag: "InvalidConfig" }
  | { readonly _tag: "ConfigLoadFailed"; readonly path: string }
  | { readonly _tag: "DiscoveryFailed" }
  | { readonly _tag: "CompileFailed" }
  | { readonly _tag: "EmitFailed" }
  | { readonly _tag: "OutputOwnershipViolation" }
  | { readonly _tag: "Filesystem" }
  | { readonly _tag: "IssuePolicyViolation" };

export const codegenError = (
  reason: CodegenErrorReason,
  issues: readonly CodegenIssue[] = [],
) => new CodegenError({ reason, issues });

export const invalidConfig = (message: string, cause?: unknown) =>
  codegenError({ _tag: "InvalidConfig" }, [
    {
      severity: "error",
      code: "config.invalid",
      message,
      cause,
    },
  ]);
