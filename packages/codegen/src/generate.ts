import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Effect, Layer, Scope } from "effect";
import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";
import type { OpcuaError } from "@effect-opcua/client/OpcuaError";

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
  GeneratedFile,
  NormalizedCodegenConfig,
} from "./types.js";

export const generate = (
  config: CodegenConfig,
): Effect.Effect<
  GenerateResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const normalized = yield* normalizeConfig(config);
    return yield* generateNormalized(normalized);
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
    return yield* checkNormalized(normalized);
  });

export const generateNormalized = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  GenerateResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const model = yield* buildModel(config);
    const policyIssues = yield* enforceIssuePolicy(
      config.diagnostics.warningsAsErrors,
      model.issues,
    );
    const files = emit(model);
    const writeResult = yield* writeGeneratedFiles(config.outputDir, files);
    const issues = sortIssues([...policyIssues, ...writeResult.issues]);
    return {
      files,
      issues,
      writtenFiles: writeResult.writtenFiles,
    };
  });

export const checkNormalized = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  CheckResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const model = yield* buildModel(config);
    const policyIssues = yield* enforceIssuePolicy(
      config.diagnostics.warningsAsErrors,
      model.issues,
    );
    const files = emit(model);
    const checked = yield* checkGeneratedFiles(config.outputDir, files);
    const issues = sortIssues([...policyIssues, ...checked.issues]);
    return {
      files,
      issues,
      staleFiles: checked.staleFiles,
      missingFiles: checked.missingFiles,
      ok: checked.staleFiles.length === 0 && checked.missingFiles.length === 0,
    };
  });

const buildModel = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  import("./types.js").CodegenModel,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> => {
  const layer = OpcuaSession.layer({
    userIdentity: config.connection.userIdentity,
  }).pipe(
    Layer.provideMerge(
      OpcuaClient.layer({
        endpointUrl: config.connection.endpointUrl,
        clientOptions: config.connection.clientOptions,
      }),
    ),
  );
  return Effect.gen(function* () {
    const discovery = yield* discover(config);
    return yield* compile(config, discovery);
  }).pipe(Effect.provide(layer));
};

export const writeGeneratedFiles = (
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
          codegenError(
            { _tag: "Filesystem" },
            [
              {
                severity: "error",
                code: "file.writeFailed",
                message: `Failed to write ${path}`,
                file: path,
                cause,
              },
            ],
          ),
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
    return { staleFiles, missingFiles, issues };
  });

const mkdirEffect = (path: string) =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      codegenError(
        { _tag: "Filesystem" },
        [
          {
            severity: "error",
            code: "file.mkdirFailed",
            message: `Failed to create directory ${path}`,
            file: path,
            cause,
          },
        ],
      ),
  });

const assertGeneratedOwnership = (path: string) =>
  Effect.gen(function* () {
    const existing = yield* readExistingFile(path);
    if (existing !== undefined && !existing.startsWith(generatedHeader)) {
      return yield* Effect.fail(
        codegenError(
          { _tag: "OutputOwnershipViolation" },
          [
            {
              severity: "error",
              code: "file.ownershipViolation",
              message: `Refusing to overwrite non-generated file ${path}`,
              file: path,
            },
          ],
        ),
      );
    }
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
      codegenError(
        { _tag: "Filesystem" },
        [
          {
            severity: "error",
            code: "file.readFailed",
            message: `Failed to read ${path}`,
            file: path,
            cause,
          },
        ],
      ),
  });

const isNodeError = (cause: unknown): cause is NodeJS.ErrnoException =>
  typeof cause === "object" && cause !== null && "code" in cause;

export const generateOpcuaClient = generate;
export const checkOpcuaClientGenerated = check;
export const generateOpcuaClientNormalized = generateNormalized;
export const checkOpcuaClientGeneratedNormalized = checkNormalized;
