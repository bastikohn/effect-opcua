#!/usr/bin/env node
import { Effect } from "effect";

import { loadConfig } from "./config.js";
import {
  checkOpcuaClientGeneratedNormalized,
  generateOpcuaClientNormalized,
} from "./generate.js";
import type { CodegenDiagnostic } from "./types.js";

type CliOptions = {
  readonly configPath: string;
  readonly verbose: boolean;
  readonly check: boolean;
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options instanceof Error) {
    process.stderr.write(`${options.message}\n`);
    process.exitCode = 2;
    return;
  }
  const effect = Effect.gen(function* () {
    const config = yield* loadConfig(options.configPath);
    return options.check
      ? yield* checkOpcuaClientGeneratedNormalized(config)
      : yield* generateOpcuaClientNormalized(config);
  });

  try {
    const result = await Effect.runPromise(Effect.scoped(effect));
    if ("ok" in result) {
      printDiagnostics(result.diagnostics, options.verbose);
      if (!result.ok) {
        process.stderr.write(
          `Generated output is stale (${result.staleFiles.length} stale, ${result.missingFiles.length} missing).\n`,
        );
        process.exitCode = 1;
        return;
      }
      process.stdout.write(
        `Generated output is up to date (${result.files.length} files checked).\n`,
      );
      return;
    }
    printDiagnostics(result.diagnostics, options.verbose);
    process.stdout.write(`Generated ${result.writtenFiles.length} files.\n`);
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 2;
  }
};

const parseArgs = (args: readonly string[]): CliOptions | Error => {
  let configPath = "effect-opcua.codegen.ts";
  let verbose = false;
  let check = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    switch (arg) {
      case "--config": {
        const value = args[index + 1];
        if (!value) return new Error("--config requires a path");
        configPath = value;
        index++;
        break;
      }
      case "--verbose":
        verbose = true;
        break;
      case "--check":
        check = true;
        break;
      default:
        return new Error(`Unsupported argument: ${arg}`);
    }
  }
  return { configPath, verbose, check };
};

const printDiagnostics = (
  diagnostics: readonly CodegenDiagnostic[],
  verbose: boolean,
) => {
  const visible = verbose
    ? diagnostics
    : diagnostics.filter((item) => item.severity === "warning");
  for (const item of visible) {
    process.stderr.write(
      `[${item.severity}] ${item.code}: ${item.message}${item.browsePath ? ` (${item.browsePath})` : ""}\n`,
    );
  }
};

const formatError = (error: unknown) => {
  if (isTagged(error, "CodegenError")) {
    const reason = (error as { readonly reason: { readonly _tag: string } })
      .reason;
    return `Codegen failed: ${reason._tag}`;
  }
  if (isTagged(error, "OpcuaError")) {
    const reason = (error as { readonly reason: { readonly _tag: string } })
      .reason;
    return `OPC-UA failed: ${reason._tag}`;
  }
  return error instanceof Error ? error.message : String(error);
};

const isTagged = (value: unknown, tag: string) =>
  typeof value === "object" &&
  value !== null &&
  "_tag" in value &&
  (value as { readonly _tag?: unknown })._tag === tag;

await main();
