import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageNames = ["@effect-opcua/client", "@effect-opcua/codegen"];
const workDir = mkdtempSync(join(tmpdir(), "effect-opcua-package-smoke-"));
const packDir = join(workDir, "pack");
const consumerDir = join(workDir, "consumer");

// The consumer must install the same `effect` version the workspace develops
// and tests against, so read it from the pnpm catalog instead of hardcoding a
// copy that silently drifts.
const catalogEffectVersion = () => {
  const workspaceYaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  const match = workspaceYaml.match(/^\s{2}effect:\s*(\S+)\s*$/m);
  if (!match) {
    throw new Error(
      "Could not find `effect` in the pnpm-workspace.yaml catalog",
    );
  }
  return match[1];
};

const run = (command, args, cwd) => {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  });
};

try {
  mkdirSync(packDir, { recursive: true });
  mkdirSync(consumerDir, { recursive: true });

  run(
    "pnpm",
    [
      "--filter",
      "@effect-opcua/client",
      "--filter",
      "@effect-opcua/codegen",
      "build",
    ],
    root,
  );
  for (const packageName of packageNames) {
    run(
      "pnpm",
      ["--filter", packageName, "pack", "--pack-destination", packDir],
      root,
    );
  }

  const tarballPaths = readdirSync(packDir)
    .filter((file) => file.endsWith(".tgz"))
    .map((file) => join(packDir, file));
  if (tarballPaths.length !== packageNames.length) {
    throw new Error(
      `Expected ${packageNames.length} package tarballs in ${packDir}`,
    );
  }
  const clientTarballPath = tarballPaths.find((file) =>
    file.includes("effect-opcua-client-"),
  );
  const codegenTarballPath = tarballPaths.find((file) =>
    file.includes("effect-opcua-codegen-"),
  );
  if (!clientTarballPath || !codegenTarballPath) {
    throw new Error(`Missing expected package tarballs in ${packDir}`);
  }
  const clientTarballSpecifier = `file:${clientTarballPath}`;
  const codegenTarballSpecifier = `file:${codegenTarballPath}`;

  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        dependencies: {
          "@effect-opcua/client": clientTarballSpecifier,
          "@effect-opcua/codegen": codegenTarballSpecifier,
          effect: catalogEffectVersion(),
          typescript: "^5.0.0",
        },
        pnpm: {
          onlyBuiltDependencies: ["esbuild", "msgpackr-extract"],
          overrides: {
            "@effect-opcua/client": clientTarballSpecifier,
            "@effect-opcua/codegen>@effect-opcua/client":
              clientTarballSpecifier,
          },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(consumerDir, ".pnpmfile.cjs"),
    `module.exports = {
  hooks: {
    readPackage(packageJson) {
      if (packageJson.name === "@effect-opcua/codegen") {
        packageJson.dependencies ??= {};
        packageJson.dependencies["@effect-opcua/client"] = ${JSON.stringify(clientTarballSpecifier)};
      }
      return packageJson;
    },
  },
};
`,
  );
  writeFileSync(
    join(consumerDir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "Bundler",
          strict: true,
          skipLibCheck: true,
        },
        include: ["smoke.ts"],
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(consumerDir, "smoke.ts"),
    `import { Effect, Layer, Schema } from "effect";
import {
  Opcua,
  OpcuaClient,
  OpcuaError,
  OpcuaSession,
  type OpcuaSessionService,
  type ReadResult,
} from "@effect-opcua/client";
import {
  DataType,
  StatusCodes,
  Variant,
  VariantArrayType,
} from "@effect-opcua/client/node-opcua";
import {
  check,
  defineConfig,
  generate,
  type CheckResult,
  type GenerateResult,
} from "@effect-opcua/codegen";

const Temperature = Opcua.variable({
  nodeId: "ns=2;s=Machine.Temperature",
  codec: Opcua.schema(Schema.Number),
  access: "read",
});

const CommandStatus = Opcua.structure({
  name: "CommandStatus",
  dataTypeId: "ns=2;i=4001",
  schema: Schema.Struct({
    commandId: Schema.String,
    ok: Schema.Boolean,
  }),
});

const CommandStatusHistory = Opcua.structureArray(CommandStatus);

const Status = Opcua.variable({
  nodeId: "ns=2;s=Machine.Status",
  codec: CommandStatus,
  access: "readWrite",
});

const StatusHistory = Opcua.variable({
  nodeId: "ns=2;s=Machine.StatusHistory",
  codec: CommandStatusHistory,
});

const program = Effect.gen(function* () {
  return yield* OpcuaSession.read(Temperature);
});

declare const session: OpcuaSessionService;

const generatedStyleProgram = Effect.gen(function* () {
  const temperature = yield* session.read(Temperature);
  const status = yield* session.read(Status);
  const history = yield* session.read(StatusHistory);
  const written = yield* session.write(Status, {
    commandId: "reset",
    ok: true,
  });

  return { temperature, status, history, written };
});

const MainLayer = OpcuaSession.layer().pipe(
  Layer.provide(
    OpcuaClient.layer({
      endpointUrl: "opc.tcp://localhost:4840",
      clientOptions: { endpointMustExist: false },
    }),
  ),
);

const maybeResult: ReadResult<number> | undefined = undefined;
const codegenConfig = defineConfig({
  endpointUrl: "opc.tcp://localhost:4840",
  clientOptions: { endpointMustExist: false },
  outputDir: "src/generated",
  roots: [{ path: ["Machine"] }],
});
const checkEffect = check(codegenConfig);
const generateEffect = generate(codegenConfig);
declare const checkResult: CheckResult;
declare const generateResult: GenerateResult;
const rawVariant = new Variant({
  dataType: DataType.Double,
  arrayType: VariantArrayType.Scalar,
  value: 21.5,
});
const maybeError: unknown = undefined;

void program;
void generatedStyleProgram;
void MainLayer;
void maybeResult;
void checkEffect;
void generateEffect;
void checkResult.ok;
void generateResult.writtenFiles;
void rawVariant;
void StatusCodes.Good;
if (OpcuaError.isOpcuaError(maybeError)) {
  void maybeError.reason;
}
`,
  );
  writeFileSync(
    join(consumerDir, "runtime.mjs"),
    `const root = await import("@effect-opcua/client");
const codegen = await import("@effect-opcua/codegen");
const raw = await import("@effect-opcua/client/node-opcua");
const packageJson = await import("@effect-opcua/client/package.json", {
  with: { type: "json" },
});
const codegenPackageJson = await import("@effect-opcua/codegen/package.json", {
  with: { type: "json" },
});

const rootKeys = Object.keys(root).sort();
const expectedRootKeys = [
  "BufferPolicy",
  "MonitorDeadband",
  "MonitorFilter",
  "Opcua",
  "OpcuaClient",
  "OpcuaError",
  "OpcuaSession",
];
if (JSON.stringify(rootKeys) !== JSON.stringify(expectedRootKeys)) {
  throw new Error(\`unexpected root exports: \${rootKeys.join(", ")}\`);
}
if (!root.Opcua || !root.OpcuaClient || !root.OpcuaSession) {
  throw new Error("root exports missing");
}
if (root.OpcuaVariable || root.OpcuaMethod || root.OpcuaSubscription) {
  throw new Error("removed namespaces are still exported");
}
if (root.Opcua.Codec || root.Opcua.Structure) {
  throw new Error("definition namespace leaked internal exports");
}
if (root.OpcuaSession.makeSession || root.OpcuaClient.makeOpcuaClient) {
  throw new Error("raw construction helpers leaked from root API");
}
if (!raw.StatusCodes?.Good?.isGood()) {
  throw new Error("node-opcua subpath did not load");
}
if (
  raw.DataType.Double === undefined ||
  !raw.Variant ||
  raw.VariantArrayType.Scalar === undefined
) {
  throw new Error("node-opcua raw symbols missing");
}
const variant = new raw.Variant({
  dataType: raw.DataType.Double,
  arrayType: raw.VariantArrayType.Scalar,
  value: 1,
});
if (variant.dataType !== raw.DataType.Double) {
  throw new Error("node-opcua Variant constructor did not load");
}
if (packageJson.default?.name !== "@effect-opcua/client") {
  throw new Error("client package.json subpath did not load");
}

const codegenKeys = Object.keys(codegen).sort();
const expectedCodegenKeys = [
  "CodegenError",
  "check",
  "defineConfig",
  "generate",
];
if (JSON.stringify(codegenKeys) !== JSON.stringify(expectedCodegenKeys)) {
  throw new Error(\`unexpected codegen exports: \${codegenKeys.join(", ")}\`);
}
if (codegenPackageJson.default?.name !== "@effect-opcua/codegen") {
  throw new Error("codegen package.json subpath did not load");
}

for (const specifier of [
  "@effect-opcua/client/Opcua",
  "@effect-opcua/client/OpcuaClient",
  "@effect-opcua/client/OpcuaError",
  "@effect-opcua/client/OpcuaSession",
  "@effect-opcua/client/OpcuaVariable",
  "@effect-opcua/client/OpcuaMethod",
  "@effect-opcua/client/OpcuaSubscription",
  "@effect-opcua/client/internal/browse",
  "@effect-opcua/client/internal/metadata",
  "@effect-opcua/codegen/config",
  "@effect-opcua/codegen/internal/types",
]) {
  try {
    await import(specifier);
    throw new Error(\`\${specifier} unexpectedly imported\`);
  } catch (error) {
    if (String(error).includes("unexpectedly imported")) throw error;
  }
}
`,
  );

  run("pnpm", ["install", "--ignore-scripts"], consumerDir);
  run("pnpm", ["exec", "tsc", "--noEmit"], consumerDir);
  run("node", ["runtime.mjs"], consumerDir);
} finally {
  if (!process.env.EFFECT_OPCUA_KEEP_SMOKE) {
    rmSync(workDir, { recursive: true, force: true });
  }
}
