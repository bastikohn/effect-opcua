#!/usr/bin/env node
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { CliError, Command, Flag } from "effect/unstable/cli";

import { displayPath } from "./diagnostics.js";
import type { CodegenIssue } from "./types.js";

const configPath = Flag.string("config").pipe(
  Flag.withDescription("Path to the codegen config"),
  Flag.withDefault("effect-opcua.codegen.ts"),
);

const verbose = Flag.boolean("verbose").pipe(
  Flag.withDescription("Print informational diagnostics"),
);

const check = Flag.boolean("check").pipe(
  Flag.withDescription("Check generated output without writing files"),
);

const command = Command.make(
  "effect-opcua-codegen",
  { configPath, verbose, check },
  ({ configPath, verbose, check }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const { loadConfig } = yield* loadConfigModule;
        const config = yield* loadConfig(configPath);
        const generator = yield* loadGenerateModule;
        const result = check
          ? yield* generator.checkFromNormalizedConfig(config)
          : yield* generator.generateFromNormalizedConfig(config);

        printIssues(result.issues, verbose);
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
        process.stdout.write(
          `Generated ${result.writtenFiles.length} files.\n`,
        );
      }),
    ),
).pipe(Command.withDescription("Generate an Effect OPC-UA client model"));

const main = command.pipe(
  Command.run({ version: "0.0.0" }),
  Effect.catch((error) =>
    Effect.sync(() => {
      if (CliError.isCliError(error) && error._tag === "ShowHelp") {
        process.exitCode = 2;
        return;
      }
      const message = CliError.isCliError(error)
        ? error.message
        : formatError(error);
      process.stderr.write(`${message}\n`);
      process.exitCode = 2;
    }),
  ),
  Effect.provide(NodeServices.layer),
);

const loadConfigModule = Effect.tryPromise({
  try: () => import("./config.js"),
  catch: (cause) => cause,
});

const loadGenerateModule = Effect.tryPromise({
  try: () => import("./generate.js"),
  catch: (cause) => cause,
});

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

NodeRuntime.runMain(main, { disableErrorReporting: true });
