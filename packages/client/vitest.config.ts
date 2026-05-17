import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@effect-opcua/client": fileURLToPath(
        new URL("./src/index.ts", import.meta.url),
      ),
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
