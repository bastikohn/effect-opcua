import { Data } from "effect";

import type { CodegenDiagnostic, NormalizedRootConfig } from "./types.js";

export class CodegenError extends Data.TaggedError("CodegenError")<{
  readonly reason: CodegenErrorReason;
  readonly diagnostics?: readonly CodegenDiagnostic[];
}> {}

export type CodegenErrorReason =
  | {
      readonly _tag: "InvalidConfig";
      readonly message: string;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "ConfigLoadFailed";
      readonly path: string;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "RootResolutionFailed";
      readonly root: NormalizedRootConfig;
      readonly message: string;
    }
  | {
      readonly _tag: "AmbiguousBrowsePath";
      readonly browsePath: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly _tag: "UnsupportedBrowsePathSegment";
      readonly segment: string;
      readonly browsePathSegments: readonly string[];
    }
  | {
      readonly _tag: "ExportNameCollision";
      readonly exportName: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly _tag: "OutputOwnershipViolation";
      readonly file: string;
    }
  | {
      readonly _tag: "Filesystem";
      readonly operation: "read" | "write" | "mkdir";
      readonly path: string;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "DiagnosticsPolicyViolation";
    };

export const codegenError = (
  reason: CodegenErrorReason,
  diagnostics?: readonly CodegenDiagnostic[],
) => new CodegenError({ reason, diagnostics });

export const invalidConfig = (message: string, cause?: unknown) =>
  codegenError({ _tag: "InvalidConfig", message, cause });
