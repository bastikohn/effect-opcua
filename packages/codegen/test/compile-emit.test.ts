import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { compile } from "../src/compile.js";
import { normalizeConfig } from "../src/config.js";
import { issue } from "../src/diagnostics.js";
import { emit } from "../src/emit.js";
import { planFromDiscovery } from "../src/generate.js";
import type { CodegenConfig } from "../src/types.js";
import type {
  DiscoveredNode,
  DiscoveryModel,
  GeneratedFile,
  NodeKey,
} from "../src/internal/types.js";

const goldenRoot = resolve(fileURLToPath(new URL("golden", import.meta.url)));

describe("compile and emit", () => {
  it("keeps browse path segments intact and emits reachable enums and structures", async () => {
    const model = await compileFixture([
      objectNode({
        key: "root",
        nodeId: "ns=2;s=PLC",
        browseName: "PLC",
        path: ["PLC"],
      }),
      variableNode({
        key: "checksum",
        nodeId: "ns=2;s=PLC_Info.ApplicationChkSum",
        browseName: "PLC_Info.ApplicationChkSum",
        path: ["PLC", "PLC_Info.ApplicationChkSum"],
        dataTypeNodeId: "i=12",
      }),
      variableNode({
        key: "estop",
        nodeId: "ns=2;s=Simulation1.EStop_active_Sim",
        browseName: "Simulation1.EStop_active_Sim",
        path: ["PLC", "Simulation1.EStop_active_Sim"],
        dataTypeNodeId: "ns=2;i=3001",
      }),
      variableNode({
        key: "disable-manual-control",
        nodeId: "ns=2;s=Lift.Control.Axis_ManualControl1.DisableManualControl",
        browseName: "DisableManualControl",
        path: [
          "PLC",
          "Lift.Control.Axis_ManualControl1",
          "DisableManualControl",
        ],
        dataTypeNodeId: "i=1",
      }),
      variableNode({
        key: "submit",
        nodeId: "ns=2;s=Commands.Submit",
        browseName: "Submit",
        path: ["PLC", "Commands", "Submit"],
        dataTypeNodeId: "ns=2;i=4001",
        accessLevel: { readable: true, writable: true },
      }),
    ]);

    expect(model.nodeIds.map((nodeId) => nodeId.generatedPath)).toContainEqual([
      "PLCInfoApplicationChkSum",
    ]);
    expect(model.nodeIds.map((nodeId) => nodeId.generatedPath)).toContainEqual([
      "LiftControlAxisManualControl1",
      "DisableManualControl",
    ]);
    expect(model.enums).toMatchObject([
      {
        name: "SimulationState",
        members: [
          { name: "Released", value: 0 },
          { name: "Active", value: 1 },
        ],
      },
    ]);
    expect(model.structures).toMatchObject([
      {
        name: "CommandPayload",
        fields: [
          {
            name: "state",
            schema: { _tag: "Enum", name: "SimulationState" },
          },
          {
            name: "message",
            optional: true,
            schema: { _tag: "Scalar", schema: "String" },
          },
        ],
      },
    ]);

    const files = Object.fromEntries(
      emit(model).map((file) => [file.path, file.contents]),
    );
    expect(files["nodeIds.ts"]).toContain(
      'export const PLCInfoApplicationChkSum = "ns=2;s=PLC_Info.ApplicationChkSum" as const;',
    );
    expect(files["nodeIds.ts"]).toContain("DataTypes");
    expect(files["enums.ts"]).toContain(
      "export const SimulationStateSchema = Schema.Literals([",
    );
    expect(files["structures.ts"]).toContain(
      "state: Enums.SimulationStateSchema",
    );
    expect(files["structures.ts"]).toContain(
      "message: Schema.optional(Schema.String)",
    );
    expect(files["variables.ts"]).toContain(
      'Submit: Opcua.variable({\n    nodeId: NodeIds.Commands.Submit,\n    codec: Structures.CommandPayload,\n    access: "readWrite",',
    );
  });

  it("lower-camelizes structure field names and preserves encoded keys", async () => {
    const model = await compileFixture(
      [
        objectNode({
          key: "root",
          nodeId: "ns=2;s=PLC",
          browseName: "PLC",
          path: ["PLC"],
        }),
        variableNode({
          key: "sample",
          nodeId: "ns=2;s=PLC.Sample",
          browseName: "Sample",
          path: ["PLC", "Sample"],
          dataTypeNodeId: "ns=2;i=5001",
        }),
      ],
      {},
      {
        dataTypeDefinitions: [
          {
            _tag: "Success",
            dataTypeNodeId: "ns=2;i=5001",
            definition: {
              _tag: "Structure",
              dataTypeNodeId: "ns=2;i=5001",
              name: "Widget.Payload",
              structureType: "Structure",
              fields: [
                { name: "NOVA", dataTypeNodeId: "i=1", valueRank: -1 },
                {
                  name: "OrbitLAMP",
                  dataTypeNodeId: "i=1",
                  valueRank: -1,
                },
                {
                  name: "QUASARbeamCounter",
                  dataTypeNodeId: "i=1",
                  valueRank: -1,
                },
                {
                  name: "PLUTOsignalAtCrater",
                  dataTypeNodeId: "i=1",
                  valueRank: -1,
                },
                { name: "NoodleFLAG", dataTypeNodeId: "i=1", valueRank: -1 },
                { name: "READY", dataTypeNodeId: "i=1", valueRank: -1 },
                {
                  name: "CLOUD",
                  dataTypeNodeId: "i=1",
                  valueRank: -1,
                },
              ],
            },
          },
        ],
      },
    );

    expect(model.structures).toMatchObject([
      {
        name: "WidgetPayload",
        fields: [
          { name: "nova", encodedName: "NOVA" },
          { name: "orbitLamp", encodedName: "orbitLAMP" },
          {
            name: "quasarbeamCounter",
            encodedName: "quASARbeamCounter",
          },
          {
            name: "plutosignalAtCrater",
            encodedName: "plUTOsignalAtCrater",
          },
          { name: "noodleFlag", encodedName: "noodleFLAG" },
          { name: "ready", encodedName: "READY" },
          { name: "cloud", encodedName: "CLOUD" },
        ],
      },
    ]);

    const files = Object.fromEntries(
      emit(model).map((file) => [file.path, file.contents]),
    );
    expect(files["structures.ts"]).toContain("nova: Schema.Boolean");
    expect(files["structures.ts"]).toContain("orbitLamp: Schema.Boolean");
    expect(files["structures.ts"]).toContain(
      "quasarbeamCounter: Schema.Boolean",
    );
    expect(files["structures.ts"]).toContain(
      "plutosignalAtCrater: Schema.Boolean",
    );
    expect(files["structures.ts"]).toContain("noodleFlag: Schema.Boolean");
    expect(files["structures.ts"]).toContain("ready: Schema.Boolean");
    expect(files["structures.ts"]).toContain("cloud: Schema.Boolean");
    expect(files["structures.ts"]).toContain(
      'Schema.encodeKeys({\n    nova: "NOVA",\n    orbitLamp: "orbitLAMP",\n    quasarbeamCounter: "quASARbeamCounter",\n    plutosignalAtCrater: "plUTOsignalAtCrater",\n    noodleFlag: "noodleFLAG",\n    ready: "READY",\n    cloud: "CLOUD",\n  })',
    );
  });

  it("fails on sibling browse names with colliding generated keys", async () => {
    await expect(
      compileFixture([
        objectNode({
          key: "root",
          nodeId: "ns=2;s=PLC",
          browseName: "PLC",
          path: ["PLC"],
        }),
        variableNode({
          key: "left",
          nodeId: "ns=2;s=PLC.A-B",
          browseName: "A-B",
          path: ["PLC", "A-B"],
          dataTypeNodeId: "i=11",
        }),
        variableNode({
          key: "right",
          nodeId: "ns=2;s=PLC.A_B",
          browseName: "A_B",
          path: ["PLC", "A_B"],
          dataTypeNodeId: "i=11",
        }),
      ]),
    ).rejects.toMatchObject({
      _tag: "CodegenError",
      issues: [
        expect.objectContaining({
          code: "path.generatedKeyCollision",
        }),
      ],
    });
  });

  it("uses dynamic codec for 64-bit integer variables", async () => {
    const model = await compileFixture([
      objectNode({
        key: "root",
        nodeId: "ns=2;s=PLC",
        browseName: "PLC",
        path: ["PLC"],
      }),
      variableNode({
        key: "revision",
        nodeId: "ns=2;s=PLC.Revision",
        browseName: "Revision",
        path: ["PLC", "Revision"],
        dataTypeNodeId: "i=9",
      }),
    ]);

    expect(model.variables).toMatchObject([
      {
        generatedPath: ["Revision"],
        codec: { _tag: "Dynamic" },
      },
    ]);
    expect(model.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ nodeId: "ns=2;s=PLC.Revision" }),
      ]),
    );

    const files = Object.fromEntries(
      emit(model).map((file) => [file.path, file.contents]),
    );
    expect(files["variables.ts"]).toContain(
      "export const Revision = Opcua.variable({",
    );
    expect(files["variables.ts"]).not.toContain("}) as const;");
  });

  it("fails on unsupported variable data types by default", async () => {
    await expect(
      compileFixture([
        objectNode({
          key: "root",
          nodeId: "ns=2;s=PLC",
          browseName: "PLC",
          path: ["PLC"],
        }),
        variableNode({
          key: "unknown",
          nodeId: "ns=2;s=PLC.Unknown",
          browseName: "Unknown",
          path: ["PLC", "Unknown"],
          dataTypeNodeId: "ns=2;i=9001",
        }),
      ]),
    ).rejects.toMatchObject({
      _tag: "CodegenError",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "datatype.definitionMissing",
          severity: "error",
        }),
      ]),
    });
  });

  it("allows explicit dynamic fallback for unsupported variable data types", async () => {
    const model = await compileFixture(
      [
        objectNode({
          key: "root",
          nodeId: "ns=2;s=PLC",
          browseName: "PLC",
          path: ["PLC"],
        }),
        variableNode({
          key: "unknown",
          nodeId: "ns=2;s=PLC.Unknown",
          browseName: "Unknown",
          path: ["PLC", "Unknown"],
          dataTypeNodeId: "ns=2;i=9001",
        }),
      ],
      { diagnostics: { typeFallback: "dynamic" } },
    );

    expect(model.variables).toMatchObject([
      {
        generatedPath: ["Unknown"],
        codec: { _tag: "Dynamic" },
      },
    ]);
    expect(model.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "datatype.definitionMissing",
          severity: "warning",
        }),
      ]),
    );
  });

  it("does not promote intentional excludes when warningsAsErrors is enabled", async () => {
    const root = objectNode({
      key: "root",
      nodeId: "ns=2;s=PLC",
      browseName: "PLC",
      path: ["PLC"],
    });
    const config = await Effect.runPromise(
      normalizeConfig({
        endpointUrl: "opc.tcp://fixture.invalid:4840",
        outputDir: "/tmp/effect-opcua-codegen-fixture",
        roots: [{ path: ["PLC"] }],
        diagnostics: { warningsAsErrors: true },
      }),
    );

    const plan = await Effect.runPromise(
      planFromDiscovery(config, {
        roots: [{ rootIndex: 0, nodeId: root.nodeId, path: root.path }],
        nodes: new Map([[root.key, root]]),
        references: [],
        dataTypeDefinitions: [],
        issues: [
          issue("branch.pruned", {
            message: "Pruned PLC / Hidden",
            path: ["PLC", "Hidden"],
            nodeId: "ns=2;s=PLC.Hidden",
          }),
          issue("node.omitted", {
            message: "Omitted PLC / Hidden / Version",
            path: ["PLC", "Hidden", "Version"],
            nodeId: "ns=2;s=PLC.Hidden.Version",
          }),
        ],
      } satisfies DiscoveryModel),
    );

    expect(plan.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "branch.pruned",
          severity: "info",
        }),
        expect.objectContaining({
          code: "node.omitted",
          severity: "info",
        }),
      ]),
    );
  });

  it("fails when a generated variable path is both branch and leaf", async () => {
    await expect(
      compileFixture([
        objectNode({
          key: "root",
          nodeId: "ns=2;s=PLC",
          browseName: "PLC",
          path: ["PLC"],
        }),
        variableNode({
          key: "parent",
          nodeId: "ns=2;s=PLC.Commands",
          browseName: "Commands",
          path: ["PLC", "Commands"],
          dataTypeNodeId: "i=1",
        }),
        variableNode({
          key: "child",
          nodeId: "ns=2;s=PLC.Commands.Submit",
          browseName: "Submit",
          path: ["PLC", "Commands", "Submit"],
          dataTypeNodeId: "i=1",
        }),
      ]),
    ).rejects.toMatchObject({
      _tag: "CodegenError",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "path.branchLeafCollision",
        }),
      ]),
    });
  });
  it("uses user access level as the effective generated access", async () => {
    const model = await compileFixture([
      objectNode({
        key: "root",
        nodeId: "ns=2;s=PLC",
        browseName: "PLC",
        path: ["PLC"],
      }),
      variableNode({
        key: "restricted",
        nodeId: "ns=2;s=PLC.Restricted",
        browseName: "Restricted",
        path: ["PLC", "Restricted"],
        dataTypeNodeId: "i=1",
        accessLevel: { readable: true, writable: true },
        userAccessLevel: { readable: true, writable: false },
      }),
    ]);

    expect(model.variables).toMatchObject([
      {
        generatedPath: ["Restricted"],
        access: "read",
      },
    ]);
  });

  it("emits write-only variables", async () => {
    const model = await compileFixture([
      objectNode({
        key: "root",
        nodeId: "ns=2;s=PLC",
        browseName: "PLC",
        path: ["PLC"],
      }),
      variableNode({
        key: "request",
        nodeId: "ns=2;s=PLC.Commands.Request",
        browseName: "Request",
        path: ["PLC", "Commands", "Request"],
        dataTypeNodeId: "i=12",
        accessLevel: { readable: false, writable: true },
      }),
    ]);

    expect(model.variables).toMatchObject([
      {
        generatedPath: ["Commands", "Request"],
        access: "write",
      },
    ]);
    expect(model.issues).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "variable.notAccessibleSkipped" }),
      ]),
    );

    const files = Object.fromEntries(
      emit(model).map((file) => [file.path, file.contents]),
    );
    expect(files["variables.ts"]).toContain(
      'Request: Opcua.variable({\n    nodeId: NodeIds.Commands.Request,\n    codec: Opcua.schema(Schema.String),\n    access: "write",',
    );
    await expectFilesToMatchGolden(emit(model), "write-only");
  });
});

const expectFilesToMatchGolden = async (
  files: readonly GeneratedFile[],
  fixtureName: string,
) => {
  for (const file of files) {
    const expected = await readFile(
      join(goldenRoot, fixtureName, file.path),
      "utf8",
    );
    expect(normalizeNewlines(file.contents)).toBe(normalizeNewlines(expected));
  }
};

const normalizeNewlines = (value: string) => value.replace(/\r\n/g, "\n");

const compileFixture = async (
  nodes: readonly DiscoveredNode[],
  configOverrides: Partial<CodegenConfig> = {},
  discoveryOverrides: Partial<
    Pick<DiscoveryModel, "dataTypeDefinitions" | "issues">
  > = {},
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* normalizeConfig({
        endpointUrl: "opc.tcp://fixture.invalid:4840",
        outputDir: "/tmp/effect-opcua-codegen-fixture",
        roots: [{ path: ["PLC"] }],
        ...configOverrides,
      });
      return yield* compile(config, {
        roots: [{ rootIndex: 0, nodeId: "ns=2;s=PLC", path: ["PLC"] }],
        nodes: new Map(nodes.map((node) => [node.key, node])),
        references: [],
        dataTypeDefinitions: discoveryOverrides.dataTypeDefinitions ?? [
          {
            _tag: "Success",
            dataTypeNodeId: "ns=2;i=3001",
            definition: {
              _tag: "Enum",
              dataTypeNodeId: "ns=2;i=3001",
              name: "Simulation.State",
              fields: [
                { name: "Released", value: 0 },
                { name: "Active", value: 1 },
              ],
            },
          },
          {
            _tag: "Success",
            dataTypeNodeId: "ns=2;i=4001",
            definition: {
              _tag: "Structure",
              dataTypeNodeId: "ns=2;i=4001",
              name: "Command.Payload",
              structureType: "Structure",
              fields: [
                {
                  name: "state",
                  dataTypeNodeId: "ns=2;i=3001",
                  valueRank: -1,
                },
                {
                  name: "message",
                  dataTypeNodeId: "i=12",
                  valueRank: -1,
                  isOptional: true,
                },
              ],
            },
          },
        ],
        issues: discoveryOverrides.issues ?? [],
      } satisfies DiscoveryModel);
    }),
  );

const objectNode = (
  input: Pick<DiscoveredNode, "key" | "nodeId" | "browseName" | "path">,
): DiscoveredNode =>
  baseNode({
    ...input,
    nodeClass: "Object",
  });

const variableNode = (
  input: Pick<DiscoveredNode, "key" | "nodeId" | "browseName" | "path"> &
    Pick<DiscoveredNode, "dataTypeNodeId"> &
    Partial<Pick<DiscoveredNode, "accessLevel" | "userAccessLevel">>,
): DiscoveredNode =>
  baseNode({
    ...input,
    nodeClass: "Variable",
    accessLevel: input.accessLevel ?? { readable: true, writable: false },
    userAccessLevel: input.userAccessLevel,
    valueRank: -1,
  });

const baseNode = (
  input: Pick<
    DiscoveredNode,
    "key" | "nodeId" | "browseName" | "path" | "nodeClass"
  > &
    Partial<DiscoveredNode>,
): DiscoveredNode => {
  const { key, nodeId, browseName, path, nodeClass, ...rest } = input;
  return {
    ...rest,
    key: key as NodeKey,
    nodeId,
    parsedNodeId: {
      namespaceIndex: 2,
      identifier: nodeId,
    },
    namespaceIndex: 2,
    browseName,
    path,
    allPaths: [path],
    nodeClass,
    rootIndex: 0,
  };
};
