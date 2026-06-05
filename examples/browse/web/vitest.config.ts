import { createVitestConfig, resolveTestPath } from "../../../vitest.shared.js";

export default createVitestConfig({
  "@effect-opcua/web/shared": resolveTestPath(
    import.meta.url,
    "./src/shared/index.ts",
  ),
  "@effect-opcua/web/server": resolveTestPath(
    import.meta.url,
    "./src/server/index.ts",
  ),
});
