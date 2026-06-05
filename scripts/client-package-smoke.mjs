import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workDir = mkdtempSync(join(tmpdir(), "effect-opcua-client-smoke-"));
const packDir = join(workDir, "pack");
const consumerDir = join(workDir, "consumer");

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

  run("pnpm", ["--filter", "@effect-opcua/client", "build"], root);
  run(
    "pnpm",
    ["--filter", "@effect-opcua/client", "pack", "--pack-destination", packDir],
    root,
  );

  const tarball = readdirSync(packDir).find((file) => file.endsWith(".tgz"));
  if (!tarball) throw new Error(`No package tarball found in ${packDir}`);
  const tarballPath = join(packDir, tarball);

  writeFileSync(
    join(consumerDir, "package.json"),
    JSON.stringify(
      {
        private: true,
        type: "module",
        pnpm: {
          onlyBuiltDependencies: ["esbuild", "msgpackr-extract"],
        },
      },
      null,
      2,
    ),
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
const raw = await import("@effect-opcua/client/node-opcua");
const packageJson = await import("@effect-opcua/client/package.json", {
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
  throw new Error("package.json subpath did not load");
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

  run(
    "pnpm",
    [
      "add",
      "--allow-build=esbuild",
      "--allow-build=msgpackr-extract",
      tarballPath,
      "effect@4.0.0-beta.66",
      "typescript@^5.0.0",
    ],
    consumerDir,
  );
  run("pnpm", ["exec", "tsc", "--noEmit"], consumerDir);
  run("node", ["runtime.mjs"], consumerDir);
} finally {
  if (!process.env.EFFECT_OPCUA_KEEP_SMOKE) {
    rmSync(workDir, { recursive: true, force: true });
  }
}
