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
  CommandState,
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
    await session.extractNamespaceDataType();
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

  test("exposes the machine tree and atomic command catalog", async () => {
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
        "Telemetry",
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
      "Commands/SubmitRequest",
    );
    await expectReadValue(
      activeSession,
      nodeId("Commands.Catalog.Machine_Configure.PayloadTypeName"),
      "MachineConfigurePayload",
    );

    const statusDataType = await activeSession.read({
      nodeId: nodeId("Commands.Status"),
      attributeId: AttributeIds.DataType,
    });
    expect(statusDataType.statusCode).toBe(StatusCodes.Good);
    expect(statusDataType.value.value.toString()).toBe(
      "ns=1;s=DataTypes.CommandStatusBuffer",
    );

    expect(await readUInt64(activeSession, nodeId("Telemetry.Revision"))).toBe(
      0,
    );
    await expectSubmitRequestDefault(activeSession);
  });

  test("exposes structured command status and removes old scalar status nodes", async () => {
    const activeSession = expectSession(session);
    const status = await readCommandStatus(activeSession);

    expect(numberValue(status.revision)).toBe(0);
    expect(numberValue(status.capacity)).toBe(8);
    expect(status.entries).toEqual([]);

    const oldScalar = await activeSession.readVariableValue(
      nodeId("Commands.Status.LastResultCode"),
    );
    expect(oldScalar.statusCode).not.toBe(StatusCodes.Good);
  });

  test("rejects missing embedded payload through one terminal status entry", async () => {
    const activeSession = expectSession(session);
    const commandId = "payload-mismatch";

    await writeSubmit(activeSession, {
      commandId,
      commandKind: GlobalCommandKind.Machine_Configure,
      clientId: "vitest",
    });

    const status = await readCommandStatus(activeSession);
    expect(numberValue(status.revision)).toBe(2);
    expect(status.entries).toHaveLength(1);
    expect(status.entries[0]).toMatchObject({
      commandId,
      commandKind: GlobalCommandKind.Machine_Configure,
      clientId: "vitest",
      state: CommandState.Rejected,
      statusCode: "InvalidPayload",
      statusMessage: "productName must not be empty.",
    });

    await expectSubmitRequestDefault(activeSession);
  });

  test("applies configure, home, and start commands through atomic submit", async () => {
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
    await writeSubmit(activeSession, {
      commandId,
      commandKind: GlobalCommandKind.Machine_Configure,
      clientId: "vitest",
      configuration,
    });

    let status = await readCommandStatus(activeSession);
    expect(status.entries).toHaveLength(1);
    expect(status.entries[0]).toMatchObject({
      commandId,
      state: CommandState.Completed,
      statusCode: "Completed",
      statusMessage: "Command completed.",
    });
    expect(numberValue(status.revision)).toBeGreaterThanOrEqual(4);
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
    const telemetryRevisionAfterConfigure = await readUInt64(
      activeSession,
      nodeId("Telemetry.Revision"),
    );
    expect(telemetryRevisionAfterConfigure).toBeGreaterThan(0);

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
    status = await readCommandStatus(activeSession);
    expect(status.entries.at(-1)).toMatchObject({
      commandId: "start-basic-batch",
      state: CommandState.Completed,
      statusCode: "Completed",
    });
    await expectReadValue(activeSession, nodeId("State.MachineState"), 4);
    await expectReadValue(activeSession, nodeId("State.CyclePhase"), 1);
    await expectReadValue(activeSession, nodeId("State.Busy"), true);
  });

  test("publishes rejected entries for unavailable machine-state commands", async () => {
    const activeSession = expectSession(session);
    const commandId = "start-from-idle";

    await writeSubmit(activeSession, {
      commandId,
      commandKind: GlobalCommandKind.Machine_Start,
      clientId: "vitest",
    });

    const status = await readCommandStatus(activeSession);
    expect(status.entries).toHaveLength(1);
    expect(status.entries[0]).toMatchObject({
      commandId,
      state: CommandState.Rejected,
      statusCode: "InvalidMachineState",
      statusMessage: "Start is accepted only from Ready.",
    });
  });

  test("keeps status entries ordered and evicts only terminal entries", async () => {
    await restartDemoServer({ commandStatusCapacity: 2 });
    const activeSession = expectSession(session);

    for (const commandId of ["ordered-1", "ordered-2", "ordered-3"]) {
      await writeSubmit(activeSession, {
        commandId,
        commandKind: GlobalCommandKind.Machine_Start,
        clientId: "vitest",
      });
    }

    const status = await readCommandStatus(activeSession);
    expect(numberValue(status.capacity)).toBe(2);
    expect(status.entries.map((entry) => entry.commandId)).toEqual([
      "ordered-2",
      "ordered-3",
    ]);
    expect(status.entries.map((entry) => numberValue(entry.sequence))).toEqual([
      2, 3,
    ]);
    expect(status.entries.every((entry) => entry.state === CommandState.Rejected))
      .toBe(true);
  });

  test("rejects duplicate retained command IDs defensively", async () => {
    const activeSession = expectSession(session);
    const commandId = "duplicate-command-id";

    await writeSubmit(activeSession, {
      commandId,
      commandKind: GlobalCommandKind.Machine_Start,
      clientId: "vitest",
    });

    await writeSubmit(activeSession, {
      commandId,
      commandKind: GlobalCommandKind.Machine_Start,
      clientId: "vitest",
    });

    const status = await readCommandStatus(activeSession);
    expect(status.entries.filter((entry) => entry.commandId === commandId))
      .toHaveLength(2);
    expect(status.entries.at(-1)).toMatchObject({
      commandId,
      state: CommandState.Rejected,
      statusCode: "DuplicateCommandId",
    });
  });

  const restartDemoServer = async (
    options: Parameters<typeof startDemoOpcuaServer>[0],
  ) => {
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

    const port = 49_900 + Number(process.env.VITEST_POOL_ID ?? 0);
    const certificateRootFolder = join(
      tmpdir(),
      `effect-opcua-demo-server-test-${process.pid}-${port}`,
    );
    demo = await startDemoOpcuaServer({
      port,
      certificateRootFolder,
      ...options,
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
    await session.extractNamespaceDataType();
  };
});

const expectSession = (session: ClientSession | undefined): ClientSession => {
  expect(session).toBeDefined();
  return session!;
};

const readExtensionObject = async (session: ClientSession, nodeId: string) => {
  const dataValue = await session.read(
    { nodeId, attributeId: AttributeIds.Value },
    0,
  );
  expect(dataValue.statusCode).toBe(StatusCodes.Good);
  expect(dataValue.value.dataType).toBe(DataType.ExtensionObject);
  return dataValue.value.value as Record<string, unknown>;
};

const readCommandStatus = async (session: ClientSession) =>
  stripStructure(
    await readExtensionObject(session, nodeId("Commands.Status")),
  ) as unknown as {
    readonly revision: unknown;
    readonly capacity: unknown;
    readonly entries: ReadonlyArray<{
      readonly sequence: unknown;
      readonly commandId: string;
      readonly commandKind: number;
      readonly clientId: string;
      readonly state: number;
      readonly statusCode: string;
      readonly statusMessage: string;
      readonly observedAt: Date;
      readonly updatedAt: Date;
    }>;
  };

const writeSubmit = async (
  session: ClientSession,
  value: {
    readonly commandId: string;
    readonly commandKind: number;
    readonly clientId: string;
    readonly targetMode?: number;
    readonly configuration?: ExtensionObject;
    readonly target?: number;
    readonly targetPositionMm?: number;
    readonly velocityMmPerSecond?: number;
    readonly maxDurationMs?: number;
    readonly actuator?: number;
    readonly axisSelection?: number;
  },
) => {
  const configuration =
    value.configuration ??
    (await session.constructExtensionObject(dataTypeNodeId("RunConfiguration"), {
      productName: "",
      targetFillVolumeMl: 0,
      fillToleranceMl: 0,
      pumpRateMlPerSecond: 0,
      batchSize: 0,
      xAxisSpeedMmPerSecond: 0,
      zAxisSpeedMmPerSecond: 0,
    }));
  const submit = await session.constructExtensionObject(
    dataTypeNodeId("GlobalCommandSubmitRequest"),
    {
      targetMode: 0,
      configuration,
      target: 0,
      targetPositionMm: 0,
      velocityMmPerSecond: 0,
      maxDurationMs: 0,
      actuator: 0,
      axisSelection: 0,
      ...value,
    },
  );
  return writeStructure(session, nodeId("Commands.SubmitRequest"), submit);
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
  if (statusCode === StatusCodes.Good) return statusCode;
  return statusCode;
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

const readUInt64 = async (session: ClientSession, nodeId: string) => {
  const dataValue = await session.readVariableValue(nodeId);
  expect(dataValue.statusCode).toBe(StatusCodes.Good);
  return numberValue(dataValue.value.value);
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
      targetMode: 0,
      target: 0,
      targetPositionMm: 0,
      velocityMmPerSecond: 0,
      maxDurationMs: 0,
      actuator: 0,
      axisSelection: 0,
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

const stripStructure = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stripStructure);
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith("_") && key !== "schema")
      .map(([key, item]) => [key, stripStructure(item)]),
  );
};

const numberValue = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((item) => typeof item === "number")
  ) {
    return value[0]! * 2 ** 32 + value[1]!;
  }
  if (value && typeof value === "object" && "value" in value) {
    return numberValue((value as { readonly value: unknown }).value);
  }
  return Number(value);
};

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
