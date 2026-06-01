import { createConfig } from "../../../tsdown.shared.js";

export default createConfig({
  platform: "node",
  entry: ["src/server/main.ts", "src/server/index.ts", "src/shared/index.ts"],
  outDir: "dist",
  unbundle: false,
  noExternal: ["@effect-opcua/client"],
});
