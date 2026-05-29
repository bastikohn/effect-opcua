export { defineConfig } from "./config.js";
export { generateOpcuaClient, checkOpcuaClientGenerated } from "./generate.js";

export type {
  CheckOpcuaClientGeneratedResult,
  CodegenConfig,
  CodegenDiagnostic,
  CodegenIr,
  DiscoveredAddressSpace,
  GenerateOpcuaClientResult,
  NormalizedCodegenConfig,
} from "./types.js";
