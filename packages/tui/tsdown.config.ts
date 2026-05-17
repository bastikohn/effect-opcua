import { createConfig } from "../../tsdown.shared.js";

export default createConfig({
  platform: "node",
  entry: ["src/cli.tsx"],
  outDir: "dist",
});
