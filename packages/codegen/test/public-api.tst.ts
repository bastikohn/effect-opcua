import { Effect, Schema } from "effect";
import { describe, expect, it } from "tstyche";

import { Opcua, OpcuaSession } from "@effect-opcua/client";
import {
  check,
  defineConfig,
  generate,
  type CheckResult,
  type GenerateResult,
} from "@effect-opcua/codegen";

describe("codegen public API", () => {
  it("keeps the root package surface small", () => {
    const config = defineConfig({
      endpointUrl: "opc.tcp://localhost:4840",
      clientOptions: { endpointMustExist: false },
      userIdentity: { type: 1, userName: "user", password: "secret" },
      outputDir: "src/generated",
      roots: [
        { path: ["DemoFillingCell"] },
        { nodeId: "ns=2;s=PLC", exportPrefix: "PLC" },
      ],
      exclude: [
        { path: ["DemoFillingCell", "Commands", "Catalog"], mode: "prune" },
        { path: ["DemoFillingCell", "**", /^InterfaceVersion/], mode: "omit" },
      ],
      discovery: { onBrowseFailure: "warn" },
      diagnostics: { warningsAsErrors: true, typeFallback: "dynamic" },
    });

    expect(generate).type.toBeCallableWith(config);
    expect(check).type.toBeCallableWith(config);

    Effect.map(generate(config), (result) => {
      expect(result).type.toBe<GenerateResult>();
      expect(result).type.toHaveProperty("issues");
      expect(result).type.toHaveProperty("writtenFiles");
      expect(result).type.not.toHaveProperty("files");
    });

    Effect.map(check(config), (result) => {
      expect(result).type.toBe<CheckResult>();
      expect(result).type.toHaveProperty("issues");
      expect(result).type.toHaveProperty("staleFiles");
      expect(result).type.toHaveProperty("missingFiles");
      expect(result).type.toHaveProperty("ok");
      expect(result).type.not.toHaveProperty("files");
    });
  });

  it("uses generated write-only variables with write APIs only", () => {
    const WriteOnly = Opcua.variable({
      nodeId: "ns=1;s=Commands.Submit",
      codec: Opcua.schema(Schema.String),
      access: "write",
    });

    expect(OpcuaSession.write).type.toBeCallableWith(WriteOnly, "run");
    expect(OpcuaSession.writeMany).type.toBeCallableWith({
      submit: [WriteOnly, "run"],
    } as const);
    expect(OpcuaSession.write).type.not.toBeCallableWith(WriteOnly, 1);
    expect(OpcuaSession.read).type.not.toBeCallableWith(WriteOnly);
    expect(OpcuaSession.readMany).type.not.toBeCallableWith({
      submit: WriteOnly,
    } as const);
  });
});
