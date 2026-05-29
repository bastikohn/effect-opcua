import { resolve } from "node:path";
import { Effect } from "effect";
import { unrun } from "unrun";

import { codegenError, invalidConfig } from "./errors.js";
import type {
  CodegenConfig,
  ExcludeRuleConfig,
  NormalizedCodegenConfig,
  NormalizedExcludeRule,
  NormalizedRootConfig,
  RootConfig,
} from "./types.js";

export const defineConfig = (config: CodegenConfig): CodegenConfig => config;

export const loadConfig = (
  path = "effect-opcua.codegen.ts",
): Effect.Effect<NormalizedCodegenConfig, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    const resolved = resolve(path);
    const loaded = yield* Effect.tryPromise({
      try: () => unrun({ path: resolved }),
      catch: (cause) =>
        codegenError({ _tag: "ConfigLoadFailed", path: resolved, cause }),
    });
    const module = loaded.module as unknown;
    const exportedConfig =
      isRecord(module) && "default" in module ? module.default : module;
    if (exportedConfig === undefined) {
      return yield* Effect.fail(
        codegenError({
          _tag: "ConfigLoadFailed",
          path: resolved,
          cause: "Config module must have a default export",
        }),
      );
    }
    return yield* normalizeConfig(exportedConfig);
  });

export const normalizeConfig = (
  config: unknown,
): Effect.Effect<NormalizedCodegenConfig, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    if (!isRecord(config)) {
      return yield* Effect.fail(invalidConfig("Config must be an object"));
    }
    const unsupported = unsupportedKeys(config, [
      "connection",
      "outputDir",
      "roots",
      "exclude",
      "naming",
      "diagnostics",
    ]);
    if (unsupported.length > 0) {
      return yield* Effect.fail(
        invalidConfig(`Unsupported config keys: ${unsupported.join(", ")}`),
      );
    }

    const connection = config.connection;
    if (!isRecord(connection)) {
      return yield* Effect.fail(
        invalidConfig("Missing connection.endpointUrl"),
      );
    }
    const endpointUrl = connection.endpointUrl;
    if (typeof endpointUrl !== "string" || endpointUrl.trim() === "") {
      return yield* Effect.fail(
        invalidConfig("Missing connection.endpointUrl"),
      );
    }

    const outputDir = config.outputDir;
    if (typeof outputDir !== "string" || outputDir.trim() === "") {
      return yield* Effect.fail(invalidConfig("Missing outputDir"));
    }

    if (!Array.isArray(config.roots) || config.roots.length === 0) {
      return yield* Effect.fail(
        invalidConfig("Config roots must not be empty"),
      );
    }
    const roots = yield* Effect.forEach(config.roots, normalizeRoot);
    const naming = normalizeNaming(config.naming);
    if (naming instanceof Error) {
      return yield* Effect.fail(invalidConfig(naming.message));
    }
    if (roots.length > 1 && naming.rootStripping) {
      const missing = roots.find((root) => !root.exportPrefix);
      if (missing) {
        return yield* Effect.fail(
          invalidConfig(
            "Multiple root configs with rootStripping enabled must provide exportPrefix",
          ),
        );
      }
    }

    const excludeInput = config.exclude ?? [];
    if (!Array.isArray(excludeInput)) {
      return yield* Effect.fail(invalidConfig("exclude must be an array"));
    }
    const exclude = yield* Effect.forEach(excludeInput, normalizeExcludeRule);
    const diagnostics = normalizeDiagnostics(config.diagnostics);
    if (diagnostics instanceof Error) {
      return yield* Effect.fail(invalidConfig(diagnostics.message));
    }

    return {
      connection: {
        endpointUrl,
        clientOptions: connection.clientOptions as
          | NormalizedCodegenConfig["connection"]["clientOptions"]
          | undefined,
      },
      outputDir,
      roots,
      exclude,
      naming,
      diagnostics,
    };
  });

const normalizeRoot = (
  root: unknown,
): Effect.Effect<NormalizedRootConfig, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    if (!isRecord(root)) {
      return yield* Effect.fail(invalidConfig("Each root must be an object"));
    }
    const value = root as RootConfig;
    const hasBrowsePath = value.browsePath !== undefined;
    const hasNodeId = value.nodeId !== undefined;
    if (hasBrowsePath && hasNodeId) {
      return yield* Effect.fail(
        invalidConfig("A root must not specify both browsePath and nodeId"),
      );
    }
    if (!hasBrowsePath && !hasNodeId) {
      return yield* Effect.fail(
        invalidConfig("A root must specify browsePath or nodeId"),
      );
    }
    if (
      value.exportPrefix !== undefined &&
      (typeof value.exportPrefix !== "string" ||
        value.exportPrefix.trim() === "")
    ) {
      return yield* Effect.fail(
        invalidConfig("root.exportPrefix must be a non-empty string"),
      );
    }
    if (hasBrowsePath) {
      if (
        typeof value.browsePath !== "string" ||
        value.browsePath.trim() === ""
      ) {
        return yield* Effect.fail(
          invalidConfig("root.browsePath must be a non-empty string"),
        );
      }
      return {
        browsePath: value.browsePath,
        browsePathSegments: splitBrowsePath(value.browsePath),
        exportPrefix: value.exportPrefix,
      };
    }
    if (typeof value.nodeId !== "string" || value.nodeId.trim() === "") {
      return yield* Effect.fail(
        invalidConfig("root.nodeId must be a non-empty string"),
      );
    }
    return { nodeId: value.nodeId, exportPrefix: value.exportPrefix };
  });

const normalizeExcludeRule = (
  rule: unknown,
): Effect.Effect<NormalizedExcludeRule, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    if (!isRecord(rule)) {
      return yield* Effect.fail(
        invalidConfig("Each exclude rule must be an object"),
      );
    }
    const value = rule as ExcludeRuleConfig;
    if (value.mode !== "prune" && value.mode !== "omit") {
      return yield* Effect.fail(
        invalidConfig('Each exclude rule must specify mode "prune" or "omit"'),
      );
    }
    const browsePath = value.browsePath;
    if (!(typeof browsePath === "string" || browsePath instanceof RegExp)) {
      return yield* Effect.fail(
        invalidConfig(
          "Each exclude rule must specify browsePath as string or RegExp",
        ),
      );
    }
    if (typeof browsePath === "string" && browsePath.trim() === "") {
      return yield* Effect.fail(
        invalidConfig("exclude browsePath strings must not be empty"),
      );
    }
    return { browsePath, mode: value.mode };
  });

const normalizeNaming = (
  value: unknown,
): NormalizedCodegenConfig["naming"] | Error => {
  if (value === undefined) {
    return { rootStripping: true, case: "pascal" as const };
  }
  if (!isRecord(value)) return new Error("naming must be an object");
  const rootStripping = value.rootStripping ?? true;
  if (typeof rootStripping !== "boolean") {
    return new Error("naming.rootStripping must be a boolean");
  }
  const casing = value.case ?? "pascal";
  if (casing !== "pascal") {
    return new Error('naming.case must be "pascal"');
  }
  return { rootStripping, case: "pascal" };
};

const normalizeDiagnostics = (
  value: unknown,
): NormalizedCodegenConfig["diagnostics"] | Error => {
  if (value === undefined) {
    return { warningsAsErrors: false };
  }
  if (!isRecord(value)) return new Error("diagnostics must be an object");
  const warningsAsErrors = value.warningsAsErrors ?? false;
  if (typeof warningsAsErrors !== "boolean") {
    return new Error("diagnostics.warningsAsErrors must be a boolean");
  }
  return { warningsAsErrors };
};

const splitBrowsePath = (browsePath: string) =>
  browsePath.split(".").filter((segment) => segment.length > 0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unsupportedKeys = (
  record: Record<string, unknown>,
  supported: readonly string[],
) => Object.keys(record).filter((key) => !supported.includes(key));
