#!/usr/bin/env node
import { Effect } from "effect";

import { loadConfig } from "./config.js";
import {
  checkFromNormalizedConfig,
  generateFromNormalizedConfig,
} from "./generate.js";
import { displayPath } from "./diagnostics.js";
import type { CodegenIssue } from "./types.js";

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
      ? yield* checkFromNormalizedConfig(config)
      : yield* generateFromNormalizedConfig(config);
  });

  try {
    const result = await Effect.runPromise(Effect.scoped(effect));
    printIssues(result.issues, options.verbose);
    if ("ok" in result) {
      if (!result.ok) {
        process.stderr.write(
          `Generated output is stale (${result.staleFiles.length} stale, ${result.missingFiles.length} missing).\n`,
        );
        process.exitCode = 1;
        return;
      }
      process.stdout.write("Generated output is up to date.\n");
      return;
    }
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

const printIssues = (issues: readonly CodegenIssue[], verbose: boolean) => {
  const visible = verbose
    ? issues
    : issues.filter((item) => item.severity !== "info");
  for (const item of visible) {
    process.stderr.write(`${formatIssue(item)}\n`);
  }
};

const formatIssue = (item: CodegenIssue) => {
  const lines = [`${item.severity} ${item.code}`];
  if (item.path) lines.push(`Path: ${displayPath(item.path)}`);
  if (item.generatedPath) {
    lines.push(`Generated key: ${item.generatedPath.join(".")}`);
  }
  lines.push(`Message: ${item.message}`);
  const candidates = candidatesFromCause(item.cause);
  if (candidates.length > 0) {
    lines.push("Candidates:");
    for (const candidate of candidates) {
      lines.push(`- ${candidate}`);
    }
  }
  return lines.join("\n");
};

const candidatesFromCause = (cause: unknown): readonly string[] => {
  if (
    typeof cause === "object" &&
    cause !== null &&
    "candidates" in cause &&
    Array.isArray((cause as { readonly candidates?: unknown }).candidates)
  ) {
    return (
      cause as { readonly candidates: readonly unknown[] }
    ).candidates.map(String);
  }
  return [];
};

const formatError = (error: unknown) => {
  if (isTagged(error, "CodegenError")) {
    const typed = error as {
      readonly reason: { readonly _tag: string };
      readonly issues?: readonly CodegenIssue[];
    };
    const issues = typed.issues ?? [];
    return [
      `Codegen failed: ${typed.reason._tag}`,
      ...issues.map(formatIssue),
    ].join("\n");
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
