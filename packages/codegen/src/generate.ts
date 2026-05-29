import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Effect, Layer, Scope } from "effect";
import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";
import type { OpcuaError } from "@effect-opcua/client/OpcuaError";

import { normalizeConfig } from "./config.js";
import {
  diagnostic,
  enforceDiagnosticsPolicy,
  sortDiagnostics,
} from "./diagnostics.js";
import { discoverAddressSpace } from "./discover.js";
import { emitTypescript, generatedHeader } from "./emit.js";
import { codegenError } from "./errors.js";
import { normalizeToIr } from "./normalize.js";
import type {
  CheckOpcuaClientGeneratedResult,
  CodegenConfig,
  CodegenDiagnostic,
  CodegenIr,
  GenerateOpcuaClientResult,
  GeneratedFile,
  NormalizedCodegenConfig,
} from "./types.js";

export const generateOpcuaClient = (
  config: CodegenConfig,
): Effect.Effect<
  GenerateOpcuaClientResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const normalized = yield* normalizeConfig(config);
    return yield* generateOpcuaClientNormalized(normalized);
  });

export const checkOpcuaClientGenerated = (
  config: CodegenConfig,
): Effect.Effect<
  CheckOpcuaClientGeneratedResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const normalized = yield* normalizeConfig(config);
    return yield* checkOpcuaClientGeneratedNormalized(normalized);
  });

export const generateOpcuaClientNormalized = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  GenerateOpcuaClientResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const ir = yield* buildIr(config);
    yield* enforceDiagnosticsPolicy(
      config.diagnostics.warningsAsErrors,
      ir.diagnostics,
    );
    const files = emitTypescript(ir);
    const writeResult = yield* writeGeneratedFiles(config.outputDir, files);
    const diagnostics = sortDiagnostics([
      ...ir.diagnostics,
      ...writeResult.diagnostics,
    ]);
    return {
      ir: { ...ir, diagnostics },
      files,
      diagnostics,
      writtenFiles: writeResult.writtenFiles,
    };
  });

export const checkOpcuaClientGeneratedNormalized = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  CheckOpcuaClientGeneratedResult,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const ir = yield* buildIr(config);
    yield* enforceDiagnosticsPolicy(
      config.diagnostics.warningsAsErrors,
      ir.diagnostics,
    );
    const files = emitTypescript(ir);
    const checked = yield* checkGeneratedFiles(config.outputDir, files);
    const diagnostics = sortDiagnostics([
      ...ir.diagnostics,
      ...checked.diagnostics,
    ]);
    return {
      ir: { ...ir, diagnostics },
      files,
      diagnostics,
      staleFiles: checked.staleFiles,
      missingFiles: checked.missingFiles,
      ok: checked.staleFiles.length === 0 && checked.missingFiles.length === 0,
    };
  });

const buildIr = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  CodegenIr,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> => {
  const layer = OpcuaSession.layer().pipe(
    Layer.provideMerge(
      OpcuaClient.layer({
        endpointUrl: config.connection.endpointUrl,
        clientOptions: config.connection.clientOptions,
      }),
    ),
  );
  return Effect.gen(function* () {
    const discovered = yield* discoverAddressSpace(config);
    return yield* normalizeToIr(config, discovered);
  }).pipe(Effect.provide(layer));
};

const writeGeneratedFiles = (
  outputDir: string,
  files: readonly GeneratedFile[],
) =>
  Effect.gen(function* () {
    const absoluteOutputDir = resolve(outputDir);
    yield* mkdirEffect(absoluteOutputDir);
    const writtenFiles: string[] = [];
    const diagnostics: CodegenDiagnostic[] = [];
    for (const file of files) {
      const path = join(absoluteOutputDir, file.path);
      yield* assertGeneratedOwnership(path);
      yield* mkdirEffect(dirname(path));
      yield* Effect.tryPromise({
        try: () => writeFile(path, file.contents, "utf8"),
        catch: (cause) =>
          codegenError({ _tag: "Filesystem", operation: "write", path, cause }),
      });
      writtenFiles.push(path);
      diagnostics.push(
        diagnostic("file.written", {
          message: `Wrote ${path}`,
          file: path,
        }),
      );
    }
    return { writtenFiles, diagnostics };
  });

const checkGeneratedFiles = (
  outputDir: string,
  files: readonly GeneratedFile[],
) =>
  Effect.gen(function* () {
    const absoluteOutputDir = resolve(outputDir);
    const staleFiles: string[] = [];
    const missingFiles: string[] = [];
    const diagnostics: CodegenDiagnostic[] = [];
    for (const file of files) {
      const path = join(absoluteOutputDir, file.path);
      const existing = yield* readExistingFile(path);
      if (existing === undefined) {
        missingFiles.push(path);
      } else if (existing !== file.contents) {
        staleFiles.push(path);
      }
      diagnostics.push(
        diagnostic("file.checked", {
          message: `Checked ${path}`,
          file: path,
        }),
      );
    }
    return { staleFiles, missingFiles, diagnostics };
  });

const mkdirEffect = (path: string) =>
  Effect.tryPromise({
    try: () => mkdir(path, { recursive: true }),
    catch: (cause) =>
      codegenError({ _tag: "Filesystem", operation: "mkdir", path, cause }),
  });

const assertGeneratedOwnership = (path: string) =>
  Effect.gen(function* () {
    const existing = yield* readExistingFile(path);
    if (existing !== undefined && !existing.startsWith(generatedHeader)) {
      return yield* Effect.fail(
        codegenError({ _tag: "OutputOwnershipViolation", file: path }),
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
      codegenError({ _tag: "Filesystem", operation: "read", path, cause }),
  });

const isNodeError = (cause: unknown): cause is NodeJS.ErrnoException =>
  typeof cause === "object" && cause !== null && "code" in cause;
