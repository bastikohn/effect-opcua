import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export const resolveTestPath = (baseUrl: string, path: string) =>
  fileURLToPath(new URL(path, baseUrl));

const resolveRepoPath = (path: string) =>
  resolveTestPath(import.meta.url, path);

export const createVitestConfig = (aliases: Record<string, string> = {}) =>
  defineConfig({
    resolve: {
      alias: {
        "@effect-opcua/client/node-opcua": resolveRepoPath(
          "packages/client/src/node-opcua.ts",
        ),
        "@effect-opcua/client": resolveRepoPath("packages/client/src/index.ts"),
        ...aliases,
      },
    },
    test: {
      environment: "node",
      globals: false,
      include: ["test/**/*.{test,spec}.ts", "src/**/*.{test,spec}.ts"],
      coverage: {
        provider: "v8",
        reportsDirectory: "coverage",
      },
    },
  });
