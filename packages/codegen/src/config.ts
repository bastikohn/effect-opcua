import { resolve } from "node:path";
import { Effect } from "effect";
import { unrun } from "unrun";

import { codegenError, invalidConfig } from "./errors.js";
import type {
  CodegenConfig,
  ExcludeRuleConfig,
  PathPatternSegment,
  RootConfig,
} from "./types.js";
import type {
  NormalizedCodegenConfig,
  NormalizedExcludeRule,
  NormalizedRootConfig,
} from "./internal/types.js";

export const defineConfig = (config: CodegenConfig): CodegenConfig => config;

export const loadConfig = (
  path = "effect-opcua.codegen.ts",
): Effect.Effect<NormalizedCodegenConfig, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    const resolved = resolve(path);
    const loaded = yield* Effect.tryPromise({
      try: () => unrun({ path: resolved }),
      catch: (cause) =>
        codegenError({ _tag: "Config", path: resolved }, [
          {
            severity: "error",
            code: "config.loadFailed",
            message: `Failed to load config at ${resolved}`,
            file: resolved,
            cause,
          },
        ]),
    });
    const module = loaded.module as unknown;
    const exportedConfig =
      isRecord(module) && "default" in module ? module.default : module;
    if (exportedConfig === undefined) {
      return yield* Effect.fail(
        codegenError({ _tag: "Config", path: resolved }, [
          {
            severity: "error",
            code: "config.loadFailed",
            message: "Config module must have a default export",
            file: resolved,
          },
        ]),
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
      "endpointUrl",
      "clientOptions",
      "userIdentity",
      "outputDir",
      "roots",
      "exclude",
      "discovery",
      "diagnostics",
    ]);
    if (unsupported.length > 0) {
      return yield* Effect.fail(
        invalidConfig(`Unsupported config keys: ${unsupported.join(", ")}`),
      );
    }

    const endpointUrl = config.endpointUrl;
    if (typeof endpointUrl !== "string" || endpointUrl.trim() === "") {
      return yield* Effect.fail(invalidConfig("Missing endpointUrl"));
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
      endpointUrl,
      clientOptions: config.clientOptions as
        | NormalizedCodegenConfig["clientOptions"]
        | undefined,
      userIdentity: config.userIdentity as
        | NormalizedCodegenConfig["userIdentity"]
        | undefined,
      outputDir,
      roots,
      exclude,
      discovery,
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
    const unsupported = unsupportedKeys(root, [
      "path",
      "nodeId",
      "exportPrefix",
    ]);
    if (unsupported.length > 0) {
      return yield* Effect.fail(
        invalidConfig(`Unsupported root keys: ${unsupported.join(", ")}`),
      );
    }
    const value = root as RootConfig;
    const descriptors = [
      value.path !== undefined,
      value.nodeId !== undefined,
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
      if (path instanceof Error)
        return yield* Effect.fail(invalidConfig(path.message));
      return { path, exportPrefix: value.exportPrefix };
    }
    if (typeof value.nodeId !== "string" || value.nodeId.trim() === "") {
      return yield* Effect.fail(
        invalidConfig("root.nodeId must be a non-empty string"),
      );
    }
    if (
      typeof value.exportPrefix !== "string" ||
      value.exportPrefix.trim() === ""
    ) {
      return yield* Effect.fail(
        invalidConfig("root.exportPrefix is required for nodeId roots"),
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
    const unsupported = unsupportedKeys(rule, ["path", "mode"]);
    if (unsupported.length > 0) {
      return yield* Effect.fail(
        invalidConfig(`Unsupported exclude keys: ${unsupported.join(", ")}`),
      );
    }
    const value = rule as ExcludeRuleConfig;
    if (value.mode !== "prune" && value.mode !== "omit") {
      return yield* Effect.fail(
        invalidConfig('Each exclude rule must specify mode "prune" or "omit"'),
      );
    }
    if (value.path === undefined) {
      return yield* Effect.fail(
        invalidConfig("Each exclude rule must specify path"),
      );
    }
    const path = normalizeExcludePath(value.path);
    if (path instanceof Error)
      return yield* Effect.fail(invalidConfig(path.message));
    return path.some((segment) => segment instanceof RegExp || segment === "**")
      ? { _tag: "PathPattern", pathPattern: path, mode: value.mode }
      : { _tag: "Path", path: path as readonly string[], mode: value.mode };
  });

const normalizeDiscovery = (
  value: unknown,
): NormalizedCodegenConfig["discovery"] | Error => {
  if (value === undefined) {
    return {
      onBrowseFailure: "warn",
    };
  }
  if (!isRecord(value)) return new Error("discovery must be an object");
  const unsupported = unsupportedKeys(value, ["onBrowseFailure"]);
  if (unsupported.length > 0) {
    return new Error(`Unsupported discovery keys: ${unsupported.join(", ")}`);
  }
  const onBrowseFailure = value.onBrowseFailure ?? "warn";
  if (onBrowseFailure !== "warn" && onBrowseFailure !== "fail") {
    return new Error('discovery.onBrowseFailure must be "warn" or "fail"');
  }
  return { onBrowseFailure };
};

const normalizeDiagnostics = (
  value: unknown,
): NormalizedCodegenConfig["diagnostics"] | Error => {
  if (value === undefined) {
    return { warningsAsErrors: false, typeFallback: "fail" };
  }
  if (!isRecord(value)) return new Error("diagnostics must be an object");
  const unsupported = unsupportedKeys(value, [
    "warningsAsErrors",
    "typeFallback",
  ]);
  if (unsupported.length > 0) {
    return new Error(`Unsupported diagnostics keys: ${unsupported.join(", ")}`);
  }
  const warningsAsErrors = value.warningsAsErrors ?? false;
  if (typeof warningsAsErrors !== "boolean") {
    return new Error("diagnostics.warningsAsErrors must be a boolean");
  }
  const typeFallback = value.typeFallback ?? "fail";
  if (typeFallback !== "fail" && typeFallback !== "dynamic") {
    return new Error('diagnostics.typeFallback must be "fail" or "dynamic"');
  }
  return { warningsAsErrors, typeFallback };
};

const normalizePath = (
  value: unknown,
  label: string,
): readonly string[] | Error => {
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

const normalizeExcludePath = (
  value: unknown,
): readonly PathPatternSegment[] | Error => {
  if (!Array.isArray(value) || value.length === 0) {
    return new Error("exclude.path must be a non-empty segment array");
  }
  if (
    !value.every(
      (segment) =>
        segment instanceof RegExp ||
        (typeof segment === "string" && segment.trim() !== ""),
    )
  ) {
    return new Error(
      'exclude.path segments must be non-empty strings, RegExp, or "**"',
    );
  }
  return [...value];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const unsupportedKeys = (
  record: Record<string, unknown>,
  supported: readonly string[],
) => Object.keys(record).filter((key) => !supported.includes(key));
