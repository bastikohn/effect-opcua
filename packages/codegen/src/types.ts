import type {
  OPCUAClientOptions,
  UserIdentityInfo,
} from "@effect-opcua/client/node-opcua";
import type { CodegenIssueCode, CodegenIssueSeverity } from "./issue-codes.js";

export type CodegenConfig = {
  readonly endpointUrl: string;
  readonly clientOptions?: OPCUAClientOptions;
  readonly userIdentity?: UserIdentityInfo;
  readonly outputDir: string;
  readonly roots: readonly RootConfig[];
  readonly exclude?: readonly ExcludeRuleConfig[];
  readonly discovery?: DiscoveryConfig;
  readonly diagnostics?: {
    readonly warningsAsErrors?: boolean;
    readonly typeFallback?: "fail" | "dynamic";
  };
};

export type RootConfig =
  | {
      readonly path: readonly string[];
      readonly nodeId?: never;
      readonly exportPrefix?: string;
    }
  | {
      readonly path?: never;
      readonly nodeId: string;
      readonly exportPrefix: string;
    };

export type PathPatternSegment = string | RegExp;

export type ExcludeRuleConfig = {
  readonly path: readonly PathPatternSegment[];
  readonly mode: "prune" | "omit";
};

export type DiscoveryConfig = {
  readonly onBrowseFailure?: "warn" | "fail";
};

export type CodegenIssue = {
  readonly severity: CodegenIssueSeverity;
  readonly code: CodegenIssueCode;
  readonly message: string;
  readonly nodeId?: string;
  readonly path?: readonly string[];
  readonly generatedPath?: readonly string[];
  readonly file?: string;
  readonly cause?: unknown;
};

export type GenerateResult = {
  readonly issues: readonly CodegenIssue[];
  readonly writtenFiles: readonly string[];
};

export type CheckResult = {
  readonly issues: readonly CodegenIssue[];
  readonly staleFiles: readonly string[];
  readonly missingFiles: readonly string[];
  readonly ok: boolean;
};
