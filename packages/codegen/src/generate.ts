import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Effect, Layer, Scope } from "effect";
import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";
import type * as Client from "@effect-opcua/client";

import { compile } from "./compile.js";
import { normalizeConfig } from "./config.js";
import { enforceIssuePolicy, issue, sortIssues } from "./diagnostics.js";
import { discover } from "./discover.js";
import { emit, generatedHeader } from "./emit.js";
import { codegenError } from "./errors.js";
import type {
  CheckResult,
  CodegenConfig,
  CodegenIssue,
  GenerateResult,
} from "./types.js";
import type {
  CodegenPlan,
  DiscoveryModel,
  GeneratedFile,
  NormalizedCodegenConfig,
} from "./internal/types.js";

type OpcuaError = Client.OpcuaError.OpcuaError;

export const generate = (
  config: CodegenConfig,
): Effect.Effect<
  GenerateResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const normalized = yield* normalizeConfig(config);
    return yield* generateFromNormalizedConfig(normalized);
  });

export const check = (
  config: CodegenConfig,
): Effect.Effect<
  CheckResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const normalized = yield* normalizeConfig(config);
    return yield* checkFromNormalizedConfig(normalized);
  });

export const generateFromNormalizedConfig = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  GenerateResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const plan = yield* planFromServer(config);
    const writeResult = yield* writeGeneratedFiles(
      config.outputDir,
      plan.files,
    );
    const issues = sortIssues([...plan.issues, ...writeResult.issues]);
    return {
      issues,
      writtenFiles: writeResult.writtenFiles,
    };
  });

export const checkFromNormalizedConfig = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  CheckResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const plan = yield* planFromServer(config);
    const checked = yield* checkGeneratedFiles(config.outputDir, plan.files);
    const issues = sortIssues([...plan.issues, ...checked.issues]);
    return {
      issues,
      staleFiles: checked.staleFiles,
      missingFiles: checked.missingFiles,
      ok: checked.staleFiles.length === 0 && checked.missingFiles.length === 0,
    };
  });

const writeGeneratedFiles = (
  outputDir: string,
  files: readonly GeneratedFile[],
) =>
  Effect.gen(function* () {
    const absoluteOutputDir = resolve(outputDir);
    yield* mkdirEffect(absoluteOutputDir);
    const writtenFiles: string[] = [];
    const issues: CodegenIssue[] = [];
    for (const file of files) {
      const path = join(absoluteOutputDir, file.path);
      yield* assertGeneratedOwnership(path);
      yield* mkdirEffect(dirname(path));
      yield* Effect.tryPromise({
        try: () => writeFile(path, file.contents, "utf8"),
        catch: (cause) =>
          codegenError({ _tag: "Output" }, [
            {
              severity: "error",
              code: "file.writeFailed",
              message: `Failed to write ${path}`,
              file: path,
              cause,
            },
          ]),
      });
      writtenFiles.push(path);
      issues.push(
        issue("file.written", {
          message: `Wrote ${path}`,
          file: path,
        }),
      );
    }
    return { writtenFiles, issues };
  });

const checkGeneratedFiles = (
  outputDir: string,
  files: readonly GeneratedFile[],
) =>
  Effect.gen(function* () {
    const absoluteOutputDir = resolve(outputDir);
    const staleFiles: string[] = [];
    const missingFiles: string[] = [];
    const issues: CodegenIssue[] = [];
    const expectedPaths = new Set(files.map((file) => file.path));
    for (const file of files) {
      const path = join(absoluteOutputDir, file.path);
      const existing = yield* readExistingFile(path);
      if (existing === undefined) {
        missingFiles.push(path);
      } else if (existing !== file.contents) {
        staleFiles.push(path);
      }
      issues.push(
        issue("file.checked", {
          message: `Checked ${path}`,
          file: path,
        }),
      );
    }
    for (const file of yield* obsoleteGeneratedFiles(
      absoluteOutputDir,
      expectedPaths,
    )) {
      staleFiles.push(file);
    }
    return { staleFiles, missingFiles, issues };
  });

export const planFromDiscovery = (
  config: NormalizedCodegenConfig,
  discovery: DiscoveryModel,
): Effect.Effect<CodegenPlan, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    const model = yield* compile(config, discovery);
    const issues = yield* enforceIssuePolicy(
      config.diagnostics.warningsAsErrors,
      model.issues,
    );
    return {
      model,
      files: emit(model),
      issues,
    };
  });

export const discoverFromServer = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  DiscoveryModel,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  discover(config).pipe(
    Effect.provide(
      OpcuaSession.layer({
        userIdentity: config.userIdentity,
      }).pipe(
        Layer.provideMerge(
          OpcuaClient.layer({
            endpointUrl: config.endpointUrl,
            clientOptions: config.clientOptions,
          }),
        ),
      ),
    ),
  );

export const planFromServer = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  CodegenPlan,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const discovery = yield* discoverFromServer(config);
    return yield* planFromDiscovery(config, discovery);
  });

const mkdirEffect = (path: string) =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      codegenError({ _tag: "Output" }, [
        {
          severity: "error",
          code: "file.mkdirFailed",
          message: `Failed to create directory ${path}`,
          file: path,
          cause,
        },
      ]),
  });

const assertGeneratedOwnership = (path: string) =>
  Effect.gen(function* () {
    const existing = yield* readExistingFile(path);
    if (existing !== undefined && !existing.startsWith(generatedHeader)) {
      return yield* Effect.fail(
        codegenError({ _tag: "Output" }, [
          {
            severity: "error",
            code: "file.ownershipViolation",
            message: `Refusing to overwrite non-generated file ${path}`,
            file: path,
          },
        ]),
      );
    }
  });

const obsoleteGeneratedFiles = (
  outputDir: string,
  expectedPaths: ReadonlySet<string>,
) =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: async () => {
        try {
          return await readdir(outputDir, { withFileTypes: true });
        } catch (cause) {
          if (isNodeError(cause) && cause.code === "ENOENT") return [];
          throw cause;
        }
      },
      catch: (cause) =>
        codegenError({ _tag: "Output" }, [
          {
            severity: "error",
            code: "file.readFailed",
            message: `Failed to read directory ${outputDir}`,
            file: outputDir,
            cause,
          },
        ]),
    });
    const stale: string[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || expectedPaths.has(entry.name)) continue;
      const path = join(outputDir, entry.name);
      const existing = yield* readExistingFile(path);
      if (existing?.startsWith(generatedHeader)) stale.push(path);
    }
    return stale;
  });

const readExistingFile = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      try {
        return await readFile(path, "utf8");
      } catch (cause) {
        if (isNodeError(cause) && cause.code === "ENOENT") return undefined;
        throw cause;
      }
    },
    catch: (cause) =>
      codegenError({ _tag: "Output" }, [
        {
          severity: "error",
          code: "file.readFailed",
          message: `Failed to read ${path}`,
          file: path,
          cause,
        },
      ]),
  });

const isNodeError = (cause: unknown): cause is NodeJS.ErrnoException =>
  typeof cause === "object" && cause !== null && "code" in cause;
