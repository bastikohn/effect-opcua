import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@effect-opcua/client/node-opcua": fileURLToPath(
        new URL("../../../packages/client/src/node-opcua.ts", import.meta.url),
      ),
      "@effect-opcua/client": fileURLToPath(
        new URL("../../../packages/client/src/index.ts", import.meta.url),
      ),
      "@effect-opcua/web/shared": fileURLToPath(
        new URL("./src/shared/index.ts", import.meta.url),
      ),
      "@effect-opcua/web/server": fileURLToPath(
        new URL("./src/server/index.ts", import.meta.url),
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
