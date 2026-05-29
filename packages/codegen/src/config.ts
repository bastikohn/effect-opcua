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
  PathPatternSegment,
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
        codegenError(
          { _tag: "ConfigLoadFailed", path: resolved },
          [
            {
              severity: "error",
              code: "config.loadFailed",
              message: `Failed to load config at ${resolved}`,
              file: resolved,
              cause,
            },
          ],
        ),
    });
    const module = loaded.module as unknown;
    const exportedConfig =
      isRecord(module) && "default" in module ? module.default : module;
    if (exportedConfig === undefined) {
      return yield* Effect.fail(
        codegenError(
          { _tag: "ConfigLoadFailed", path: resolved },
          [
            {
              severity: "error",
              code: "config.loadFailed",
              message: "Config module must have a default export",
              file: resolved,
            },
          ],
        ),
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
      "discovery",
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
    const discovery = normalizeDiscovery(config.discovery);
    if (discovery instanceof Error) {
      return yield* Effect.fail(invalidConfig(discovery.message));
    }

    return {
      connection: {
        endpointUrl,
        clientOptions: connection.clientOptions as
          | NormalizedCodegenConfig["connection"]["clientOptions"]
          | undefined,
        userIdentity: connection.userIdentity as
          | NormalizedCodegenConfig["connection"]["userIdentity"]
          | undefined,
      },
      outputDir,
      roots,
      exclude,
      discovery,
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
    const descriptors = [
      value.path !== undefined,
      value.nodeId !== undefined,
      value.browsePath !== undefined,
    ].filter(Boolean).length;
    if (descriptors !== 1) {
      return yield* Effect.fail(
        invalidConfig("A root must specify exactly one of path or nodeId"),
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
    if (value.path !== undefined) {
      const path = normalizePath(value.path, "root.path");
      if (path instanceof Error) return yield* Effect.fail(invalidConfig(path.message));
      return { path, exportPrefix: value.exportPrefix };
    }
    if (value.browsePath !== undefined) {
      if (
        typeof value.browsePath !== "string" ||
        value.browsePath.trim() === ""
      ) {
        return yield* Effect.fail(
          invalidConfig("root.browsePath must be a non-empty string"),
        );
      }
      return {
        path: splitLegacyBrowsePath(value.browsePath),
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
    const descriptors = [
      value.path !== undefined,
      value.pathPattern !== undefined,
      value.browsePath !== undefined,
    ].filter(Boolean).length;
    if (descriptors !== 1) {
      return yield* Effect.fail(
        invalidConfig(
          "Each exclude rule must specify exactly one of path or pathPattern",
        ),
      );
    }
    if (value.path !== undefined) {
      const path = normalizePath(value.path, "exclude.path");
      if (path instanceof Error) return yield* Effect.fail(invalidConfig(path.message));
      return { _tag: "Path", path, mode: value.mode };
    }
    if (value.pathPattern !== undefined) {
      const pathPattern = normalizePathPattern(value.pathPattern);
      if (pathPattern instanceof Error) {
        return yield* Effect.fail(invalidConfig(pathPattern.message));
      }
      return { _tag: "PathPattern", pathPattern, mode: value.mode };
    }
    const browsePath = value.browsePath;
    if (typeof browsePath === "string") {
      if (browsePath.trim() === "") {
        return yield* Effect.fail(
          invalidConfig("exclude browsePath strings must not be empty"),
        );
      }
      return {
        _tag: "Path",
        path: splitLegacyBrowsePath(browsePath),
        mode: value.mode,
      };
    }
    return yield* Effect.fail(
      invalidConfig("exclude RegExp browsePath is no longer supported"),
    );
  });

const normalizeDiscovery = (
  value: unknown,
): NormalizedCodegenConfig["discovery"] | Error => {
  if (value === undefined) {
    return {
      rootBase: "objectsFolder",
      includeVariableChildren: false,
      onBrowseFailure: "warn",
    };
  }
  if (!isRecord(value)) return new Error("discovery must be an object");
  const rootBase = value.rootBase ?? "objectsFolder";
  if (rootBase !== "objectsFolder") {
    return new Error('discovery.rootBase must be "objectsFolder"');
  }
  const includeVariableChildren = value.includeVariableChildren ?? false;
  if (typeof includeVariableChildren !== "boolean") {
    return new Error("discovery.includeVariableChildren must be a boolean");
  }
  const onBrowseFailure = value.onBrowseFailure ?? "warn";
  if (onBrowseFailure !== "warn" && onBrowseFailure !== "fail") {
    return new Error('discovery.onBrowseFailure must be "warn" or "fail"');
  }
  return { rootBase, includeVariableChildren, onBrowseFailure };
};

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

const normalizePath = (value: unknown, label: string): readonly string[] | Error => {
  if (!Array.isArray(value) || value.length === 0) {
    return new Error(`${label} must be a non-empty segment array`);
  }
  if (
    !value.every(
      (segment) => typeof segment === "string" && segment.trim() !== "",
    )
  ) {
    return new Error(`${label} segments must be non-empty strings`);
  }
  return [...value];
};

const normalizePathPattern = (
  value: unknown,
): readonly PathPatternSegment[] | Error => {
  if (!Array.isArray(value) || value.length === 0) {
    return new Error("exclude.pathPattern must be a non-empty segment array");
  }
  if (
    !value.every(
      (segment) =>
        segment === "**" ||
        segment instanceof RegExp ||
        (typeof segment === "string" && segment.trim() !== ""),
    )
  ) {
    return new Error(
      'exclude.pathPattern segments must be non-empty strings, RegExp, or "**"',
    );
  }
  return [...value];
};

const splitLegacyBrowsePath = (browsePath: string) =>
  browsePath.split(".").filter((segment) => segment.length > 0);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unsupportedKeys = (
  record: Record<string, unknown>,
  supported: readonly string[],
) => Object.keys(record).filter((key) => !supported.includes(key));
