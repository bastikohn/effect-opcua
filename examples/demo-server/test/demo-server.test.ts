import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AttributeIds,
  DataType,
  OPCUAClient,
  StatusCodes,
  Variant,
  VariantArrayType,
  coerceNodeId,
  type ClientSession,
  type ExtensionObject,
} from "node-opcua";
import { OPCUACertificateManager } from "node-opcua-certificate-manager";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  GlobalCommandKind,
  startDemoOpcuaServer,
  type DemoOpcuaServer,
} from "../src/index.js";

const nodeId = (path: string) => `ns=1;s=DemoFillingCell.${path}`;
const dataTypeNodeId = (browseName: string) =>
  coerceNodeId(`ns=1;s=DataTypes.${browseName}`);

const extensionObjectVariant = (value: ExtensionObject) =>
  new Variant({
    dataType: DataType.ExtensionObject,
    arrayType: VariantArrayType.Scalar,
    value,
  });

describe("DemoFillingCell demo server", () => {
  let demo: DemoOpcuaServer | undefined;
  let client: ReturnType<typeof OPCUAClient.create> | undefined;
  let session: ClientSession | undefined;

  beforeEach(async () => {
    const port = 49_900 + Number(process.env.VITEST_POOL_ID ?? 0);
    const certificateRootFolder = join(
      tmpdir(),
      `effect-opcua-demo-server-test-${process.pid}-${port}`,
    );
    demo = await startDemoOpcuaServer({
      port,
      certificateRootFolder,
    });
    client = OPCUAClient.create({
      endpointMustExist: false,
      clientCertificateManager: new OPCUACertificateManager({
        rootFolder: certificateRootFolder,
        name: "ClientPKI",
        automaticallyAcceptUnknownCertificate: true,
        disableFileWatchers: true,
      }),
    });
    await client.connect(demo.endpointUrl);
    session = await client.createSession();
  }, 30_000);

  afterEach(async () => {
    if (session) {
      await session.close();
      session = undefined;
    }
    if (client) {
      await client.disconnect();
      client = undefined;
    }
    if (demo) {
      await demo.stop();
      demo = undefined;
    }
  }, 30_000);

  test("exposes the machine tree, command catalog, and typed payload nodes", async () => {
    const activeSession = expectSession(session);

    const objects = await browseNames(activeSession, "i=85");
    expect(objects).toContain("DemoFillingCell");
    expect(objects).not.toContain("MyMachine");

    const machine = await browseNames(
      activeSession,
      "ns=1;s=DemoFillingCell",
      "HasComponent",
    );
    expect(machine).toEqual(
      expect.arrayContaining([
        "State",
        "Commands",
        "Motion",
        "Filling",
        "PartHandling",
        "Inspection",
        "Safety",
        "OperatorFeedback",
        "Production",
        "Diagnostics",
      ]),
    );

    const catalogNames = await browseNames(
      activeSession,
      nodeId("Commands.Catalog"),
      "HasComponent",
    );
    expect(catalogNames).toHaveLength(52);
    expect(catalogNames).toContain("Machine_Configure");
    expect(catalogNames).toContain("Maintenance_ClearClampFault");
    expect(catalogNames).not.toContain("None");

    await expectReadValue(
      activeSession,
      nodeId("Commands.Catalog.Machine_Configure.CommandKind"),
      GlobalCommandKind.Machine_Configure,
    );
    await expectReadValue(
      activeSession,
      nodeId("Commands.Catalog.Machine_Configure.RequiresPayload"),
      true,
    );
    await expectReadValue(
      activeSession,
      nodeId("Commands.Catalog.Machine_Configure.PayloadBrowsePath"),
      "Commands/Payloads/Machine/Configure",
    );
    await expectReadValue(
      activeSession,
      nodeId("Commands.Catalog.Machine_Configure.PayloadTypeName"),
      "MachineConfigurePayload",
    );

    const configureDataType = await activeSession.read({
      nodeId: nodeId("Commands.Payloads.Machine.Configure"),
      attributeId: AttributeIds.DataType,
    });
    expect(configureDataType.statusCode).toBe(StatusCodes.Good);
    expect(configureDataType.value.value.toString()).toBe(
      "ns=1;s=DataTypes.MachineConfigurePayload",
    );

    await expectSubmitRequestDefault(activeSession);
  });

  test("rejects an invalid command kind and resets the submit mailbox immediately", async () => {
    const activeSession = expectSession(session);
    const commandId = "invalid-command-kind";

    await writeSubmit(activeSession, {
      commandId,
      commandKind: GlobalCommandKind.None,
      clientId: "vitest",
    });

    await expectReadValue(
      activeSession,
      nodeId("Commands.Status.ObservedCommandId"),
      commandId,
    );
    await expectReadValue(
      activeSession,
      nodeId("Commands.Status.LastFinishedCommandId"),
      commandId,
    );
    await expectReadValue(
      activeSession,
      nodeId("Commands.Status.LastResultCode"),
      "InvalidCommandKind",
    );
    await expectReadValue(
      activeSession,
      nodeId("Commands.Status.LastResultCategory"),
      2,
    );
    await expectReadValue(
      activeSession,
      nodeId("Commands.Status.LastFinishedState"),
      2,
    );

    await expectSubmitRequestDefault(activeSession);
  });

  test("applies configure, home, and start commands through typed payloads", async () => {
    const activeSession = expectSession(session);
    const commandId = "configure-basic-batch";

    const configuration = await activeSession.constructExtensionObject(
      dataTypeNodeId("RunConfiguration"),
      {
        productName: "Water",
        targetFillVolumeMl: 250,
        fillToleranceMl: 2,
        pumpRateMlPerSecond: 50,
        batchSize: 3,
        xAxisSpeedMmPerSecond: 200,
        zAxisSpeedMmPerSecond: 100,
      },
    );
    const payload = await activeSession.constructExtensionObject(
      dataTypeNodeId("MachineConfigurePayload"),
      { commandId, configuration },
    );
    await writeStructure(
      activeSession,
      nodeId("Commands.Payloads.Machine.Configure"),
      payload,
    );
    await writeSubmit(activeSession, {
      commandId,
      commandKind: GlobalCommandKind.Machine_Configure,
      clientId: "vitest",
    });

    await expectReadValue(
      activeSession,
      nodeId("Commands.Status.LastResultCode"),
      "Ok",
    );
    await expectReadValue(
      activeSession,
      nodeId("State.ConfigurationValid"),
      true,
    );
    await expectReadValue(
      activeSession,
      nodeId("State.Configuration.ProductName"),
      "Water",
    );
    await expectReadValue(
      activeSession,
      nodeId("State.Configuration.BatchSize"),
      3,
    );

    await writeSubmit(activeSession, {
      commandId: "home-basic-batch",
      commandKind: GlobalCommandKind.Machine_Home,
      clientId: "vitest",
    });
    await expectReadValue(activeSession, nodeId("State.Ready"), true);
    await expectReadValue(activeSession, nodeId("Motion.XAxis.Homed"), true);
    await expectReadValue(activeSession, nodeId("Motion.ZAxis.Homed"), true);

    await writeSubmit(activeSession, {
      commandId: "start-basic-batch",
      commandKind: GlobalCommandKind.Machine_Start,
      clientId: "vitest",
    });
    await expectReadValue(
      activeSession,
      nodeId("Commands.Status.LastResultCode"),
      "Ok",
    );
    await expectReadValue(activeSession, nodeId("State.MachineState"), 4);
    await expectReadValue(activeSession, nodeId("State.CyclePhase"), 1);
    await expectReadValue(activeSession, nodeId("State.Busy"), true);
  });
});

const expectSession = (session: ClientSession | undefined): ClientSession => {
  expect(session).toBeDefined();
  return session!;
};

const readExtensionObject = async (session: ClientSession, nodeId: string) => {
  const dataValue = await session.readVariableValue(nodeId);
  expect(dataValue.statusCode).toBe(StatusCodes.Good);
  expect(dataValue.value.dataType).toBe(DataType.ExtensionObject);
  return dataValue.value.value as Record<string, unknown>;
};

const writeSubmit = async (
  session: ClientSession,
  value: {
    readonly commandId: string;
    readonly commandKind: number;
    readonly clientId: string;
  },
) => {
  const submit = await session.constructExtensionObject(
    dataTypeNodeId("GlobalCommandSubmitRequest"),
    value,
  );
  await writeStructure(session, nodeId("Commands.SubmitRequest"), submit);
};

const writeStructure = async (
  session: ClientSession,
  nodeId: string,
  value: ExtensionObject,
) => {
  const statusCode = await session.write({
    nodeId,
    attributeId: AttributeIds.Value,
    value: {
      value: extensionObjectVariant(value),
    },
  });
  expect(statusCode).toBe(StatusCodes.Good);
};

const expectReadValue = async (
  session: ClientSession,
  nodeId: string,
  expected: unknown,
) => {
  const dataValue = await session.readVariableValue(nodeId);
  expect(dataValue.statusCode).toBe(StatusCodes.Good);
  expect(dataValue.value.value).toEqual(expected);
};

const expectSubmitRequestDefault = async (session: ClientSession) => {
  const value = await readExtensionObject(
    session,
    nodeId("Commands.SubmitRequest"),
  );
  if ("commandId" in value) {
    expect(stripStructure(value)).toMatchObject({
      commandId: "",
      commandKind: 0,
      clientId: "",
    });
    return;
  }

  expect(String(value.nodeId)).toBe(
    "ns=1;s=DataTypes.GlobalCommandSubmitRequest.Encoding.DefaultBinary",
  );
  expect(opaqueBuffer(value)).toEqual(Buffer.alloc(12));
};

const browseNames = async (
  session: ClientSession,
  browseNodeId: string,
  referenceTypeId?: string,
) => {
  const result = await session.browse({
    nodeId: browseNodeId,
    referenceTypeId,
    includeSubtypes: false,
    resultMask: 63,
  });
  expect(result.statusCode).toBe(StatusCodes.Good);
  return (
    result.references?.map(
      (reference) =>
        reference.displayName.text ??
        reference.browseName.name ??
        reference.browseName.toString(),
    ) ?? []
  );
};

const stripStructure = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !key.startsWith("_") && key !== "schema",
    ),
  );

const opaqueBuffer = (value: Record<string, unknown>) => {
  const buffer = value.buffer;
  if (Buffer.isBuffer(buffer)) return buffer;
  if (
    buffer &&
    typeof buffer === "object" &&
    "data" in buffer &&
    Array.isArray((buffer as { readonly data: unknown }).data)
  ) {
    return Buffer.from((buffer as { readonly data: readonly number[] }).data);
  }
  throw new TypeError("Expected OpaqueStructure buffer");
};
