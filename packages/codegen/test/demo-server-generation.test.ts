import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect } from "effect";

import {
  startDemoOpcuaServer,
  type DemoOpcuaServer,
} from "../../../examples/demo-server/src/index.js";
import { generate } from "../src/generate.js";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

vi.setConfig({ testTimeout: 120_000 });

describe("codegen prototype", () => {
  let demo: DemoOpcuaServer;
  let tempDir: string;

  beforeAll(async () => {
    const poolId = Number(process.env.VITEST_POOL_ID ?? 0);
    const port = 54_000 + poolId;
    tempDir = await mkdtemp(join(repoRoot, "packages/codegen/.tmp-codegen-"));
    demo = await startDemoOpcuaServer({
      port,
      certificateRootFolder: join(tempDir, "certificates"),
    });
  }, 30_000);

  afterAll(async () => {
    await demo?.stop();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }, 30_000);

  it("generates a typecheckable client surface for the demo server", async () => {
    const outputDir = join(tempDir, "generated");
    const result = await Effect.runPromise(
      Effect.scoped(
        generate({
          connection: {
            endpointUrl: demo.endpointUrl,
            clientOptions: { endpointMustExist: false },
          },
          outputDir,
          roots: [{ path: ["DemoFillingCell"] }],
          exclude: [
            {
              path: ["DemoFillingCell", "Commands", "Catalog"],
              mode: "prune",
            },
            {
              path: ["DemoFillingCell", "OperatorFeedback"],
              mode: "prune",
            },
            {
              pathPattern: [
                "DemoFillingCell",
                "**",
                /^InterfaceVersion(Major|Minor|Patch)$/,
              ],
              mode: "omit",
            },
          ],
        }).pipe(Effect.timeout("90 seconds")),
      ),
    );

    expect(result.writtenFiles.map((file) => file.split("/").at(-1))).toEqual([
      "nodeIds.ts",
      "enums.ts",
      "structures.ts",
      "variables.ts",
      "index.ts",
    ]);

    const nodeIds = await readFile(join(outputDir, "nodeIds.ts"), "utf8");
    const enums = await readFile(join(outputDir, "enums.ts"), "utf8");
    const structures = await readFile(
      join(outputDir, "structures.ts"),
      "utf8",
    );
    const variables = await readFile(join(outputDir, "variables.ts"), "utf8");
    const index = await readFile(join(outputDir, "index.ts"), "utf8");

    expect(nodeIds).toContain(
      'LevelMl: "ns=1;s=DemoFillingCell.Filling.Tank.LevelMl"',
    );
    expect(nodeIds).toContain("Commands");
    expect(nodeIds).not.toContain("Catalog: {");
    expect(nodeIds).not.toContain("OperatorFeedback");
    expect(nodeIds).not.toContain("InterfaceVersionMajor");

    expect(variables).toContain("export const Filling = {");
    expect(variables).toContain("LevelMl: Opcua.variable");
    expect(variables).toContain("codec: Opcua.schema(Schema.Number)");
    expect(variables).toContain("SubmitRequest: Opcua.variable");
    expect(variables).toContain("codec: Structures.GlobalCommandSubmitRequest");
    expect(variables).toContain("codec: Opcua.schema(Enums.MachineStateSchema)");
    expect(variables).toContain('access: "readWrite"');
    expect(variables).not.toContain("PayloadBrowsePath");
    expect(variables).not.toContain("OperatorFeedback");
    expect(variables).not.toContain("InterfaceVersionMajor");

    expect(enums).toContain("export const GlobalCommandKind = {");
    expect(enums).toContain("MachineSetMode: 100");
    expect(enums).toContain(
      "export const MachineStateSchema = Schema.Literals([",
    );

    expect(structures).toContain(
      "export const GlobalCommandSubmitRequest = Opcua.structure({",
    );
    expect(structures).toContain(
      "commandKind: Enums.GlobalCommandKindSchema",
    );
    expect(structures).toContain("entries: Schema.Array(CommandStatusEntrySchema)");

    expect(index).toContain('export * as NodeIds from "./nodeIds.js";');
    expect(index).toContain('export * as Enums from "./enums.js";');
    expect(index).toContain('export * as Structures from "./structures.js";');
    expect(index).toContain('export * as Variables from "./variables.js";');
    expect(index).not.toContain("Methods");

    await writeFile(
      join(tempDir, "index.ts"),
      'export * from "./generated/index.js";\n',
      "utf8",
    );
    await writeFile(
      join(tempDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            verbatimModuleSyntax: false,
            baseUrl: repoRoot,
            paths: {
              "@effect-opcua/client": ["packages/client/src/index.ts"],
              "@effect-opcua/client/*": ["packages/client/src/*"],
            },
          },
          include: [join(tempDir, "index.ts"), join(outputDir, "*.ts")],
        },
        null,
        2,
      ),
      "utf8",
    );
    try {
      await execFileAsync("pnpm", [
        "exec",
        "tsc",
        "--project",
        join(tempDir, "tsconfig.json"),
      ]);
    } catch (error) {
      const output = error as {
        readonly stdout?: string;
        readonly stderr?: string;
      };
      throw new Error(
        `Generated output failed typecheck\n${output.stdout ?? ""}${output.stderr ?? ""}`,
      );
    }
  });
});
