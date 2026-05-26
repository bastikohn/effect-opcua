import {
  DataType,
  DataTypeIds,
  OPCUAServer,
  StatusCodes,
  Variant,
  VariantArrayType,
  coerceNodeId,
  coerceUInt64,
  nodesets,
  type AddressSpace,
  type NodeId,
  type UADataType,
} from "node-opcua";
import { OPCUACertificateManager } from "node-opcua-certificate-manager";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type DemoOpcuaServer = {
  readonly server: OPCUAServer;
  readonly endpointUrl: string;
  readonly stop: () => Promise<void>;
};

export type DemoSimulationScenario =
  | "Default"
  | "LowTank"
  | "ClampFault"
  | "InspectionRejects"
  | "SafetyStop"
  | "MotionFault";

export type DemoOpcuaServerOptions = {
  readonly port?: number;
  readonly resourcePath?: string;
  readonly certificateRootFolder?: string;
  readonly scenario?: DemoSimulationScenario;
  readonly simulationSpeed?: number;
  readonly commandStatusCapacity?: number;
};

type Namespace = ReturnType<AddressSpace["getOwnNamespace"]>;
type ParentNode = Parameters<Namespace["addVariable"]>[0]["componentOf"];
type StructureRecord = Record<string, unknown>;
type StructureConstructor = new (value: StructureRecord) => object;

export const GlobalCommandKind = {
  None: 0,

  Machine_SetMode: 100,
  Machine_Configure: 101,
  Machine_Home: 102,
  Machine_Start: 103,
  Machine_Pause: 104,
  Machine_Resume: 105,
  Machine_Abort: 106,
  Machine_Reset: 107,
  Machine_ClearCompleted: 108,
  Machine_AcknowledgeSafetyReset: 109,

  Manual_HomeX: 200,
  Manual_HomeZ: 201,
  Manual_MoveXAxisToTarget: 202,
  Manual_MoveXAxisToPosition: 203,
  Manual_MoveZAxisToTarget: 204,
  Manual_MoveZAxisToPosition: 205,
  Manual_JogXPositive: 206,
  Manual_JogXNegative: 207,
  Manual_JogZPositive: 208,
  Manual_JogZNegative: 209,
  Manual_OpenClamp: 210,
  Manual_CloseClamp: 211,
  Manual_PrimePump: 212,
  Manual_StopPump: 213,
  Manual_OpenNozzleValve: 214,
  Manual_CloseNozzleValve: 215,
  Manual_TriggerInspectionOnce: 216,
  Manual_ClearActuatorFault: 217,

  Maintenance_RefillTank: 300,
  Maintenance_DrainTank: 301,
  Maintenance_PrimePump: 302,
  Maintenance_CleanNozzle: 303,
  Maintenance_ResetPumpFault: 304,
  Maintenance_ResetValveFault: 305,
  Maintenance_CalibrateFillLevelSensor: 306,
  Maintenance_SimulateSensorCheck: 307,
  Maintenance_ResetInspectionFault: 308,
  Maintenance_MoveXAxisToTarget: 309,
  Maintenance_MoveXAxisToPosition: 310,
  Maintenance_MoveZAxisToTarget: 311,
  Maintenance_MoveZAxisToPosition: 312,
  Maintenance_JogXPositive: 313,
  Maintenance_JogXNegative: 314,
  Maintenance_JogZPositive: 315,
  Maintenance_JogZNegative: 316,
  Maintenance_HomeAxes: 317,
  Maintenance_EnableAxes: 318,
  Maintenance_DisableAxes: 319,
  Maintenance_ClearAxisFault: 320,
  Maintenance_OpenClamp: 321,
  Maintenance_CloseClamp: 322,
  Maintenance_ClearClampFault: 323,
} as const;

export const CommandState = {
  None: 0,
  Observed: 1,
  Accepted: 2,
  Executing: 3,
  Completed: 4,
  Rejected: 5,
  Failed: 6,
  Cancelled: 7,
  Superseded: 8,
} as const;

export const MachineState = {
  Unknown: 0,
  Booting: 1,
  Idle: 2,
  Ready: 3,
  Running: 4,
  Paused: 5,
  Complete: 6,
  Aborted: 7,
  Faulted: 8,
  SafetyStopped: 9,
  Resetting: 10,
} as const;

export const OperatingMode = {
  None: 0,
  Automatic: 1,
  Manual: 2,
  Maintenance: 3,
} as const;

export const CyclePhase = {
  None: 0,
  WaitingForLoad: 1,
  Clamping: 2,
  MovingToFill: 3,
  LoweringNozzle: 4,
  Filling: 5,
  RaisingNozzle: 6,
  MovingToInspect: 7,
  Inspecting: 8,
  MovingToUnload: 9,
  Unclamping: 10,
  WaitingForUnload: 11,
  ReturningToLoad: 12,
} as const;

export const XAxisTarget = {
  None: 0,
  Home: 1,
  Load: 2,
  Fill: 3,
  Inspect: 4,
  Unload: 5,
} as const;

export const ZAxisTarget = {
  None: 0,
  Home: 1,
  Safe: 2,
  Fill: 3,
  Maintenance: 4,
} as const;

export const AxisSelection = {
  None: 0,
  XAxis: 1,
  ZAxis: 2,
  Both: 3,
} as const;

export const AxisState = {
  Unknown: 0,
  Disabled: 1,
  NotHomed: 2,
  Standstill: 3,
  Homing: 4,
  Moving: 5,
  Stopping: 6,
  Faulted: 7,
} as const;

export const ActuatorId = {
  None: 0,
  XAxis: 1,
  ZAxis: 2,
  Clamp: 3,
  Pump: 4,
  NozzleValve: 5,
  InspectionSensor: 6,
} as const;

export const EmergencyStopState = {
  Unknown: 0,
  Released: 1,
  Pressed: 2,
} as const;

export const GuardDoorState = {
  Unknown: 0,
  Closed: 1,
  Open: 2,
} as const;

export const SafetyCircuitState = {
  Unknown: 0,
  Ok: 1,
  Interrupted: 2,
} as const;

export const SafetyStopReason = {
  None: 0,
  EmergencyStop: 1,
  GuardDoorOpen: 2,
} as const;

export const PumpState = {
  Stopped: 0,
  Running: 1,
  Priming: 2,
  Faulted: 3,
} as const;

export const NozzleValveState = {
  Closed: 0,
  Open: 1,
  Moving: 2,
  Faulted: 3,
} as const;

export const ClampState = {
  Open: 0,
  Closed: 1,
  Moving: 2,
  Faulted: 3,
} as const;

export const InspectionResult = {
  NotInspected: 0,
  Pass: 1,
  Fail: 2,
} as const;

export const RejectReason = {
  None: 0,
  Underfilled: 1,
  Overfilled: 2,
  SensorFault: 3,
} as const;

export const BuzzerState = {
  Off: 0,
  ShortPulse: 1,
  Intermittent: 2,
  Continuous: 3,
} as const;

export const DiagnosticSeverity = {
  None: 0,
  Warning: 1,
  Fault: 2,
  Safety: 3,
} as const;

type CommandKindName = keyof typeof GlobalCommandKind;
type RealCommandKindName = Exclude<CommandKindName, "None">;
type CommandDomain = "Machine" | "Manual" | "Maintenance";
type PayloadTypeName =
  | "MachineSetModePayload"
  | "MachineConfigurePayload"
  | "MoveXAxisToTargetPayload"
  | "MoveZAxisToTargetPayload"
  | "MoveAxisToPositionPayload"
  | "JogPayload"
  | "ClearActuatorFaultPayload"
  | "AxisSelectionPayload";
type StructureTypeName =
  | PayloadTypeName
  | "GlobalCommandSubmitRequest"
  | "CommandStatusBuffer"
  | "CommandStatusEntry"
  | "RunConfiguration";

type CommandMetadata = {
  readonly kindName: RealCommandKindName;
  readonly kind: number;
  readonly domain: CommandDomain;
  readonly commandName: string;
  readonly description: string;
  readonly payloadTypeName?: PayloadTypeName;
  readonly payloadBrowsePath: string;
};

type RunConfiguration = {
  productName: string;
  targetFillVolumeMl: number;
  fillToleranceMl: number;
  pumpRateMlPerSecond: number;
  batchSize: number;
  xAxisSpeedMmPerSecond: number;
  zAxisSpeedMmPerSecond: number;
};

type GlobalCommandSubmitRequest = {
  commandId: string;
  commandKind: number;
  clientId: string;
};

type CommandStatus = {
  revision: number;
  capacity: number;
  entries: Array<CommandStatusEntry>;
  nextSequence: number;
};

type CommandStatusEntry = {
  sequence: number;
  commandId: string;
  commandKind: number;
  clientId: string;
  state: number;
  statusCode: string;
  statusMessage: string;
  observedAt: Date;
  updatedAt: Date;
};

type AxisModel = {
  state: number;
  actualPositionMm: number;
  targetPositionMm: number;
  actualVelocityMmPerSecond: number;
  commandedVelocityMmPerSecond: number;
  homed: boolean;
  enabled: boolean;
  positiveLimitActive: boolean;
  negativeLimitActive: boolean;
  faultCode: string;
  currentTarget: number;
};

type DiagnosticsModel = {
  warnings: {
    fillLevelDrift: boolean;
    inspectionRejectRateHigh: boolean;
    maintenanceRecommended: boolean;
    cycleTimeHigh: boolean;
  };
  faults: {
    motion: {
      xAxisNotHomed: boolean;
      zAxisNotHomed: boolean;
      xAxisPositionError: boolean;
      zAxisPositionError: boolean;
    };
    partHandling: {
      clampFailedToClose: boolean;
    };
    filling: {
      tankEmpty: boolean;
      pumpFault: boolean;
      valveFault: boolean;
    };
    inspection: {
      sensorFault: boolean;
    };
  };
};

type MachineModel = {
  machineState: number;
  operatingMode: number;
  cyclePhase: number;
  configurationValid: boolean;
  configuration: RunConfiguration;
  submitRequest: GlobalCommandSubmitRequest;
  status: CommandStatus;
  payloads: Partial<Record<RealCommandKindName, StructureRecord>>;
  motion: {
    xAxis: AxisModel;
    zAxis: AxisModel;
  };
  safety: {
    emergencyStopState: number;
    guardDoorState: number;
    safetyCircuitState: number;
    resetRequired: boolean;
    stopReason: number;
  };
  filling: {
    tankCapacityMl: number;
    tankLevelMl: number;
    lowLevelThresholdMl: number;
    emptyThresholdMl: number;
    pumpState: number;
    pumpFaultCode: string;
    nozzleValveState: number;
    nozzleValveFaultCode: string;
  };
  partHandling: {
    clampState: number;
    clampFaultCode: string;
    partPresent: boolean;
  };
  inspection: {
    fillLevelMl: number;
    fillLevelOk: boolean;
    result: number;
    rejectReason: number;
    sensorFaultCode: string;
  };
  production: {
    batchStartedAt: number | null;
    targetCount: number;
    startedCount: number;
    completedCount: number;
    goodCount: number;
    rejectedCount: number;
    currentPartIndex: number;
    currentPartFillVolumeMl: number;
    currentPartInspectionResult: number;
    currentPartRejectReason: number;
    lastCycleTimeMs: number;
    averageCycleTimeMs: number;
    batchElapsedTimeMs: number;
    totalCompletedCount: number;
    totalGoodCount: number;
    totalRejectedCount: number;
  };
  diagnostics: DiagnosticsModel;
  telemetryRevision: number;
  lastTickAt: number;
  simulationSpeed: number;
};

type DemoRuntime = {
  readonly tick: (now: number) => void;
};

type DataTypeRegistry = {
  readonly enumTypes: Record<string, UADataType>;
  readonly structureTypes: Record<StructureTypeName, UADataType>;
  readonly makeExtensionObject: (
    typeName: StructureTypeName,
    value: StructureRecord,
  ) => object;
};

type Availability = {
  readonly available: boolean;
  readonly reasonCode: string;
  readonly message: string;
};

const defaultSubmitRequest = (): GlobalCommandSubmitRequest => ({
  commandId: "",
  commandKind: GlobalCommandKind.None,
  clientId: "",
});

const defaultRunConfiguration = (): RunConfiguration => ({
  productName: "",
  targetFillVolumeMl: 0,
  fillToleranceMl: 0,
  pumpRateMlPerSecond: 0,
  batchSize: 0,
  xAxisSpeedMmPerSecond: 0,
  zAxisSpeedMmPerSecond: 0,
});

const defaultCommandStatus = (capacity = 8): CommandStatus => ({
  revision: 0,
  capacity,
  entries: [],
  nextSequence: 1,
});

const commandMetadataSpecs = [
  {
    kindName: "Machine_SetMode",
    payloadTypeName: "MachineSetModePayload",
    description:
      "Change the operating mode when PLC mode-change rules allow it.",
  },
  {
    kindName: "Machine_Configure",
    payloadTypeName: "MachineConfigurePayload",
    description: "Validate and store a new batch run configuration.",
  },
  {
    kindName: "Machine_Home",
    description: "Home both axes under PLC control.",
  },
  {
    kindName: "Machine_Start",
    description: "Start the configured automatic batch from Ready.",
  },
  {
    kindName: "Machine_Pause",
    description:
      "Request a PLC-controlled pause of the active automatic batch.",
  },
  {
    kindName: "Machine_Resume",
    description: "Resume a paused automatic batch.",
  },
  {
    kindName: "Machine_Abort",
    description:
      "Stop an active or paused automatic batch in a controlled way.",
  },
  {
    kindName: "Machine_Reset",
    description:
      "Reset recoverable machine states after reset-safe conditions are met.",
  },
  {
    kindName: "Machine_ClearCompleted",
    description: "Acknowledge a completed batch and return to Idle or Ready.",
  },
  {
    kindName: "Machine_AcknowledgeSafetyReset",
    description: "Acknowledge restored safety inputs before machine reset.",
  },

  { kindName: "Manual_HomeX", description: "Home the X axis in Manual mode." },
  { kindName: "Manual_HomeZ", description: "Home the Z axis in Manual mode." },
  {
    kindName: "Manual_MoveXAxisToTarget",
    payloadTypeName: "MoveXAxisToTargetPayload",
    description: "Move the X axis to a named target in Manual mode.",
  },
  {
    kindName: "Manual_MoveXAxisToPosition",
    payloadTypeName: "MoveAxisToPositionPayload",
    description:
      "Move the X axis to a validated millimeter position in Manual mode.",
  },
  {
    kindName: "Manual_MoveZAxisToTarget",
    payloadTypeName: "MoveZAxisToTargetPayload",
    description: "Move the Z axis to a named target in Manual mode.",
  },
  {
    kindName: "Manual_MoveZAxisToPosition",
    payloadTypeName: "MoveAxisToPositionPayload",
    description:
      "Move the Z axis to a validated millimeter position in Manual mode.",
  },
  {
    kindName: "Manual_JogXPositive",
    payloadTypeName: "JogPayload",
    description: "Run a bounded positive X jog in Manual mode.",
  },
  {
    kindName: "Manual_JogXNegative",
    payloadTypeName: "JogPayload",
    description: "Run a bounded negative X jog in Manual mode.",
  },
  {
    kindName: "Manual_JogZPositive",
    payloadTypeName: "JogPayload",
    description: "Run a bounded positive Z jog in Manual mode.",
  },
  {
    kindName: "Manual_JogZNegative",
    payloadTypeName: "JogPayload",
    description: "Run a bounded negative Z jog in Manual mode.",
  },
  {
    kindName: "Manual_OpenClamp",
    description: "Open the clamp in Manual mode.",
  },
  {
    kindName: "Manual_CloseClamp",
    description: "Close the clamp in Manual mode.",
  },
  {
    kindName: "Manual_PrimePump",
    description: "Prime the pump in Manual mode.",
  },
  { kindName: "Manual_StopPump", description: "Stop the pump in Manual mode." },
  {
    kindName: "Manual_OpenNozzleValve",
    description: "Open the nozzle valve in Manual mode.",
  },
  {
    kindName: "Manual_CloseNozzleValve",
    description: "Close the nozzle valve in Manual mode.",
  },
  {
    kindName: "Manual_TriggerInspectionOnce",
    description: "Trigger a single fill-level inspection in Manual mode.",
  },
  {
    kindName: "Manual_ClearActuatorFault",
    payloadTypeName: "ClearActuatorFaultPayload",
    description: "Clear a recoverable actuator fault in Manual mode.",
  },

  {
    kindName: "Maintenance_RefillTank",
    description: "Refill the simulated tank in Maintenance mode.",
  },
  {
    kindName: "Maintenance_DrainTank",
    description: "Drain the simulated tank in Maintenance mode.",
  },
  {
    kindName: "Maintenance_PrimePump",
    description: "Prime the pump in Maintenance mode.",
  },
  {
    kindName: "Maintenance_CleanNozzle",
    description: "Run a nozzle cleaning routine in Maintenance mode.",
  },
  {
    kindName: "Maintenance_ResetPumpFault",
    description: "Clear a recoverable pump fault in Maintenance mode.",
  },
  {
    kindName: "Maintenance_ResetValveFault",
    description: "Clear a recoverable valve fault in Maintenance mode.",
  },
  {
    kindName: "Maintenance_CalibrateFillLevelSensor",
    description: "Calibrate the fill-level sensor in Maintenance mode.",
  },
  {
    kindName: "Maintenance_SimulateSensorCheck",
    description:
      "Run a deterministic inspection sensor check in Maintenance mode.",
  },
  {
    kindName: "Maintenance_ResetInspectionFault",
    description:
      "Clear a recoverable inspection sensor fault in Maintenance mode.",
  },
  {
    kindName: "Maintenance_MoveXAxisToTarget",
    payloadTypeName: "MoveXAxisToTargetPayload",
    description: "Move the X axis to a named target in Maintenance mode.",
  },
  {
    kindName: "Maintenance_MoveXAxisToPosition",
    payloadTypeName: "MoveAxisToPositionPayload",
    description:
      "Move the X axis to a validated millimeter position in Maintenance mode.",
  },
  {
    kindName: "Maintenance_MoveZAxisToTarget",
    payloadTypeName: "MoveZAxisToTargetPayload",
    description: "Move the Z axis to a named target in Maintenance mode.",
  },
  {
    kindName: "Maintenance_MoveZAxisToPosition",
    payloadTypeName: "MoveAxisToPositionPayload",
    description:
      "Move the Z axis to a validated millimeter position in Maintenance mode.",
  },
  {
    kindName: "Maintenance_JogXPositive",
    payloadTypeName: "JogPayload",
    description: "Run a bounded positive X jog in Maintenance mode.",
  },
  {
    kindName: "Maintenance_JogXNegative",
    payloadTypeName: "JogPayload",
    description: "Run a bounded negative X jog in Maintenance mode.",
  },
  {
    kindName: "Maintenance_JogZPositive",
    payloadTypeName: "JogPayload",
    description: "Run a bounded positive Z jog in Maintenance mode.",
  },
  {
    kindName: "Maintenance_JogZNegative",
    payloadTypeName: "JogPayload",
    description: "Run a bounded negative Z jog in Maintenance mode.",
  },
  {
    kindName: "Maintenance_HomeAxes",
    payloadTypeName: "AxisSelectionPayload",
    description: "Home selected axes in Maintenance mode.",
  },
  {
    kindName: "Maintenance_EnableAxes",
    payloadTypeName: "AxisSelectionPayload",
    description: "Enable selected axes in Maintenance mode.",
  },
  {
    kindName: "Maintenance_DisableAxes",
    payloadTypeName: "AxisSelectionPayload",
    description: "Disable selected axes in Maintenance mode.",
  },
  {
    kindName: "Maintenance_ClearAxisFault",
    payloadTypeName: "AxisSelectionPayload",
    description: "Clear selected recoverable axis faults in Maintenance mode.",
  },
  {
    kindName: "Maintenance_OpenClamp",
    description: "Open the clamp in Maintenance mode.",
  },
  {
    kindName: "Maintenance_CloseClamp",
    description: "Close the clamp in Maintenance mode.",
  },
  {
    kindName: "Maintenance_ClearClampFault",
    description: "Clear a recoverable clamp fault in Maintenance mode.",
  },
] satisfies ReadonlyArray<{
  readonly kindName: RealCommandKindName;
  readonly payloadTypeName?: PayloadTypeName;
  readonly description: string;
}>;

const commandMetadata: ReadonlyArray<CommandMetadata> =
  commandMetadataSpecs.map((spec) => {
    const separator = spec.kindName.indexOf("_");
    const domain = spec.kindName.slice(0, separator) as CommandDomain;
    const commandName = spec.kindName.slice(separator + 1);
    return {
      ...spec,
      kind: GlobalCommandKind[spec.kindName],
      domain,
      commandName,
      payloadBrowsePath: spec.payloadTypeName
        ? `Commands/Payloads/${domain}/${commandName}`
        : "",
    };
  });

const metadataByKind = new Map<number, CommandMetadata>(
  commandMetadata.map((metadata) => [metadata.kind, metadata]),
);

const xAxisTargetPositions = {
  [XAxisTarget.Home]: 0,
  [XAxisTarget.Load]: 100,
  [XAxisTarget.Fill]: 300,
  [XAxisTarget.Inspect]: 500,
  [XAxisTarget.Unload]: 700,
} as const;

const zAxisTargetPositions = {
  [ZAxisTarget.Home]: 0,
  [ZAxisTarget.Safe]: 0,
  [ZAxisTarget.Fill]: -120,
  [ZAxisTarget.Maintenance]: 40,
} as const;

export const startDemoOpcuaServer = async (
  options: DemoOpcuaServerOptions = {},
): Promise<DemoOpcuaServer> => {
  const port = options.port ?? 4840;
  const resourcePath = options.resourcePath ?? "/UA/effect-opcua-demo";
  const certificateRootFolder =
    options.certificateRootFolder ??
    join(tmpdir(), "effect-opcua-demo-server-pki");
  const serverCertificateManager = new OPCUACertificateManager({
    rootFolder: certificateRootFolder,
    name: "PKI",
    automaticallyAcceptUnknownCertificate: true,
    disableFileWatchers: true,
  });
  const userCertificateManager = new OPCUACertificateManager({
    rootFolder: certificateRootFolder,
    name: "UserPKI",
    automaticallyAcceptUnknownCertificate: true,
    disableFileWatchers: true,
  });
  const server = new OPCUAServer({
    port,
    resourcePath,
    nodeset_filename: [nodesets.standard],
    serverCertificateManager,
    userCertificateManager,
    buildInfo: {
      productName: "effect-opcua-demo-server",
      buildNumber: "2",
      buildDate: new Date(),
    },
  });

  await server.initialize();
  const runtime = await installDemoAddressSpace(
    server.engine.addressSpace!,
    options,
  );

  const timer = setInterval(() => {
    runtime.tick(Date.now());
  }, 100);
  timer.unref();

  await server.start();

  return {
    server,
    endpointUrl: `opc.tcp://127.0.0.1:${port}${resourcePath}`,
    stop: async () => {
      clearInterval(timer);
      await server.shutdown(1_000);
    },
  };
};

const installDemoAddressSpace = async (
  addressSpace: AddressSpace,
  options: DemoOpcuaServerOptions,
): Promise<DemoRuntime> => {
  const namespace = addressSpace.getOwnNamespace();
  const dataTypes = await createDemoDataTypes(addressSpace, namespace);
  const model = createInitialModel(options);

  const machine = namespace.addObject({
    browseName: "DemoFillingCell",
    nodeId: "s=DemoFillingCell",
    organizedBy: addressSpace.rootFolder.objects,
  });

  const state = addObject(namespace, machine, "State", "DemoFillingCell.State");
  const commands = addObject(
    namespace,
    machine,
    "Commands",
    "DemoFillingCell.Commands",
  );
  const motion = addObject(
    namespace,
    machine,
    "Motion",
    "DemoFillingCell.Motion",
  );
  const filling = addObject(
    namespace,
    machine,
    "Filling",
    "DemoFillingCell.Filling",
  );
  const partHandling = addObject(
    namespace,
    machine,
    "PartHandling",
    "DemoFillingCell.PartHandling",
  );
  const inspection = addObject(
    namespace,
    machine,
    "Inspection",
    "DemoFillingCell.Inspection",
  );
  const safety = addObject(
    namespace,
    machine,
    "Safety",
    "DemoFillingCell.Safety",
  );
  const operatorFeedback = addObject(
    namespace,
    machine,
    "OperatorFeedback",
    "DemoFillingCell.OperatorFeedback",
  );
  const production = addObject(
    namespace,
    machine,
    "Production",
    "DemoFillingCell.Production",
  );
  const diagnostics = addObject(
    namespace,
    machine,
    "Diagnostics",
    "DemoFillingCell.Diagnostics",
  );
  const telemetry = addObject(
    namespace,
    machine,
    "Telemetry",
    "DemoFillingCell.Telemetry",
  );

  installStateBranch(namespace, state, dataTypes, model);
  installCommandsBranch(namespace, commands, dataTypes, model);
  installTelemetryBranch(namespace, telemetry, model);
  installMotionBranch(namespace, motion, dataTypes, model);
  installFillingBranch(namespace, filling, dataTypes, model);
  installPartHandlingBranch(namespace, partHandling, dataTypes, model);
  installInspectionBranch(namespace, inspection, dataTypes, model);
  installSafetyBranch(namespace, safety, dataTypes, model);
  installOperatorFeedbackBranch(namespace, operatorFeedback, dataTypes, model);
  installProductionBranch(namespace, production, dataTypes, model);
  installDiagnosticsBranch(namespace, diagnostics, dataTypes, model);

  return {
    tick: (now) => tickModel(model, now),
  };
};

const createDemoDataTypes = async (
  addressSpace: AddressSpace,
  namespace: Namespace,
): Promise<DataTypeRegistry> => {
  const enumTypes: Record<string, UADataType> = {};
  const structureTypes = {} as Record<StructureTypeName, UADataType>;

  const addEnum = (browseName: string, values: Record<string, number>) => {
    const dataType = namespace.addEnumerationType({
      browseName,
      nodeId: `s=DataTypes.${browseName}`,
      enumeration: Object.entries(values).map(([displayName, value]) => ({
        displayName,
        description: displayName,
        value,
      })),
    });
    enumTypes[browseName] = dataType;
    return dataType;
  };

  const globalCommandKind = addEnum("GlobalCommandKind", GlobalCommandKind);
  const commandState = addEnum("CommandState", CommandState);
  const machineState = addEnum("MachineState", MachineState);
  const operatingMode = addEnum("OperatingMode", OperatingMode);
  const cyclePhase = addEnum("CyclePhase", CyclePhase);
  const xAxisTarget = addEnum("XAxisTarget", XAxisTarget);
  const zAxisTarget = addEnum("ZAxisTarget", ZAxisTarget);
  const axisSelection = addEnum("AxisSelection", AxisSelection);
  const axisState = addEnum("AxisState", AxisState);
  const actuatorId = addEnum("ActuatorId", ActuatorId);
  const emergencyStopState = addEnum("EmergencyStopState", EmergencyStopState);
  const guardDoorState = addEnum("GuardDoorState", GuardDoorState);
  const safetyCircuitState = addEnum("SafetyCircuitState", SafetyCircuitState);
  const safetyStopReason = addEnum("SafetyStopReason", SafetyStopReason);
  const pumpState = addEnum("PumpState", PumpState);
  const nozzleValveState = addEnum("NozzleValveState", NozzleValveState);
  const clampState = addEnum("ClampState", ClampState);
  const inspectionResult = addEnum("InspectionResult", InspectionResult);
  const rejectReason = addEnum("RejectReason", RejectReason);
  const buzzerState = addEnum("BuzzerState", BuzzerState);
  const diagnosticSeverity = addEnum("DiagnosticSeverity", DiagnosticSeverity);

  const stringType = coerceNodeId(DataTypeIds.String);
  const doubleType = coerceNodeId(DataTypeIds.Double);
  const uint32Type = coerceNodeId(DataTypeIds.UInt32);
  const dateTimeType = coerceNodeId(DataTypeIds.DateTime);

  const createStructure = (
    browseName: StructureTypeName,
    fields: ReadonlyArray<{
      readonly name: string;
      readonly dataType: NodeId;
      readonly valueRank?: number;
    }>,
  ) => {
    const dataType = namespace.createDataType({
      browseName,
      nodeId: `s=DataTypes.${browseName}`,
      isAbstract: false,
      subtypeOf: "Structure",
      partialDefinition: fields.map((field) => ({
        name: field.name,
        dataType: field.dataType,
        valueRank: field.valueRank ?? -1,
      })),
    });
    namespace.addObject({
      browseName: "Default Binary",
      nodeId: `s=DataTypes.${browseName}.Encoding.DefaultBinary`,
      encodingOf: dataType,
    });
    structureTypes[browseName] = dataType;
    return dataType;
  };

  const runConfiguration = createStructure("RunConfiguration", [
    { name: "productName", dataType: stringType },
    { name: "targetFillVolumeMl", dataType: doubleType },
    { name: "fillToleranceMl", dataType: doubleType },
    { name: "pumpRateMlPerSecond", dataType: doubleType },
    { name: "batchSize", dataType: uint32Type },
    { name: "xAxisSpeedMmPerSecond", dataType: doubleType },
    { name: "zAxisSpeedMmPerSecond", dataType: doubleType },
  ]);

  createStructure("GlobalCommandSubmitRequest", [
    { name: "commandId", dataType: stringType },
    { name: "commandKind", dataType: globalCommandKind.nodeId },
    { name: "clientId", dataType: stringType },
  ]);
  const commandStatusEntry = createStructure("CommandStatusEntry", [
    { name: "sequence", dataType: uint32Type },
    { name: "commandId", dataType: stringType },
    { name: "commandKind", dataType: globalCommandKind.nodeId },
    { name: "clientId", dataType: stringType },
    { name: "state", dataType: commandState.nodeId },
    { name: "statusCode", dataType: stringType },
    { name: "statusMessage", dataType: stringType },
    { name: "observedAt", dataType: dateTimeType },
    { name: "updatedAt", dataType: dateTimeType },
  ]);
  createStructure("CommandStatusBuffer", [
    { name: "revision", dataType: uint32Type },
    { name: "capacity", dataType: uint32Type },
    { name: "entries", dataType: commandStatusEntry.nodeId, valueRank: 1 },
  ]);
  createStructure("MachineSetModePayload", [
    { name: "commandId", dataType: stringType },
    { name: "targetMode", dataType: operatingMode.nodeId },
  ]);
  createStructure("MachineConfigurePayload", [
    { name: "commandId", dataType: stringType },
    { name: "configuration", dataType: runConfiguration.nodeId },
  ]);
  createStructure("MoveXAxisToTargetPayload", [
    { name: "commandId", dataType: stringType },
    { name: "target", dataType: xAxisTarget.nodeId },
    { name: "velocityMmPerSecond", dataType: doubleType },
  ]);
  createStructure("MoveZAxisToTargetPayload", [
    { name: "commandId", dataType: stringType },
    { name: "target", dataType: zAxisTarget.nodeId },
    { name: "velocityMmPerSecond", dataType: doubleType },
  ]);
  createStructure("MoveAxisToPositionPayload", [
    { name: "commandId", dataType: stringType },
    { name: "targetPositionMm", dataType: doubleType },
    { name: "velocityMmPerSecond", dataType: doubleType },
  ]);
  createStructure("JogPayload", [
    { name: "commandId", dataType: stringType },
    { name: "velocityMmPerSecond", dataType: doubleType },
    { name: "maxDurationMs", dataType: uint32Type },
  ]);
  createStructure("ClearActuatorFaultPayload", [
    { name: "commandId", dataType: stringType },
    { name: "actuator", dataType: actuatorId.nodeId },
  ]);
  createStructure("AxisSelectionPayload", [
    { name: "commandId", dataType: stringType },
    { name: "axisSelection", dataType: axisSelection.nodeId },
  ]);

  void commandState;
  void machineState;
  void cyclePhase;
  void axisState;
  void emergencyStopState;
  void guardDoorState;
  void safetyCircuitState;
  void safetyStopReason;
  void pumpState;
  void nozzleValveState;
  void clampState;
  void inspectionResult;
  void rejectReason;
  void buzzerState;
  void diagnosticSeverity;

  const { ensureDatatypeExtracted } = await import("node-opcua-address-space");
  await ensureDatatypeExtracted(addressSpace);

  const dataTypeManager = (
    addressSpace as unknown as {
      readonly getDataTypeManager: () => {
        readonly getExtensionObjectConstructorFromDataTypeAsync: (
          nodeId: NodeId,
        ) => Promise<StructureConstructor>;
      };
    }
  ).getDataTypeManager();

  const constructors = {} as Record<StructureTypeName, StructureConstructor>;
  for (const typeName of Object.keys(structureTypes) as StructureTypeName[]) {
    constructors[typeName] =
      await dataTypeManager.getExtensionObjectConstructorFromDataTypeAsync(
        structureTypes[typeName].nodeId,
      );
  }

  return {
    enumTypes,
    structureTypes,
    makeExtensionObject: (typeName, value) =>
      new constructors[typeName](cloneRecord(value)),
  };
};

const createInitialModel = (options: DemoOpcuaServerOptions): MachineModel => {
  const tankLevelMl = options.scenario === "LowTank" ? 900 : 10_000;
  const simulationSpeed = Math.max(0.1, options.simulationSpeed ?? 1);
  const commandStatusCapacity = Math.max(
    1,
    Math.trunc(options.commandStatusCapacity ?? 8),
  );
  const payloads: Partial<Record<RealCommandKindName, StructureRecord>> = {};
  for (const metadata of commandMetadata) {
    if (metadata.payloadTypeName) {
      payloads[metadata.kindName] = defaultPayload(metadata.payloadTypeName);
    }
  }

  return {
    machineState: MachineState.Idle,
    operatingMode: OperatingMode.Automatic,
    cyclePhase: CyclePhase.None,
    configurationValid: false,
    configuration: defaultRunConfiguration(),
    submitRequest: defaultSubmitRequest(),
    status: defaultCommandStatus(commandStatusCapacity),
    payloads,
    motion: {
      xAxis: {
        state: AxisState.NotHomed,
        actualPositionMm: 0,
        targetPositionMm: 0,
        actualVelocityMmPerSecond: 0,
        commandedVelocityMmPerSecond: 0,
        homed: false,
        enabled: true,
        positiveLimitActive: false,
        negativeLimitActive: false,
        faultCode: "",
        currentTarget: XAxisTarget.None,
      },
      zAxis: {
        state: AxisState.NotHomed,
        actualPositionMm: 0,
        targetPositionMm: 0,
        actualVelocityMmPerSecond: 0,
        commandedVelocityMmPerSecond: 0,
        homed: false,
        enabled: true,
        positiveLimitActive: false,
        negativeLimitActive: false,
        faultCode: "",
        currentTarget: ZAxisTarget.None,
      },
    },
    safety: {
      emergencyStopState: EmergencyStopState.Released,
      guardDoorState: GuardDoorState.Closed,
      safetyCircuitState: SafetyCircuitState.Ok,
      resetRequired: false,
      stopReason: SafetyStopReason.None,
    },
    filling: {
      tankCapacityMl: 10_000,
      tankLevelMl,
      lowLevelThresholdMl: 1_000,
      emptyThresholdMl: 100,
      pumpState: PumpState.Stopped,
      pumpFaultCode: "",
      nozzleValveState: NozzleValveState.Closed,
      nozzleValveFaultCode: "",
    },
    partHandling: {
      clampState: ClampState.Open,
      clampFaultCode: "",
      partPresent: false,
    },
    inspection: {
      fillLevelMl: 0,
      fillLevelOk: true,
      result: InspectionResult.NotInspected,
      rejectReason: RejectReason.None,
      sensorFaultCode: "",
    },
    production: {
      batchStartedAt: null,
      targetCount: 0,
      startedCount: 0,
      completedCount: 0,
      goodCount: 0,
      rejectedCount: 0,
      currentPartIndex: 0,
      currentPartFillVolumeMl: 0,
      currentPartInspectionResult: InspectionResult.NotInspected,
      currentPartRejectReason: RejectReason.None,
      lastCycleTimeMs: 0,
      averageCycleTimeMs: 0,
      batchElapsedTimeMs: 0,
      totalCompletedCount: 0,
      totalGoodCount: 0,
      totalRejectedCount: 0,
    },
    diagnostics: {
      warnings: {
        fillLevelDrift: false,
        inspectionRejectRateHigh: false,
        maintenanceRecommended: false,
        cycleTimeHigh: false,
      },
      faults: {
        motion: {
          xAxisNotHomed: false,
          zAxisNotHomed: false,
          xAxisPositionError: false,
          zAxisPositionError: false,
        },
        partHandling: {
          clampFailedToClose: options.scenario === "ClampFault",
        },
        filling: {
          tankEmpty: tankLevelMl <= 100,
          pumpFault: false,
          valveFault: false,
        },
        inspection: {
          sensorFault: false,
        },
      },
    },
    telemetryRevision: 0,
    lastTickAt: Date.now(),
    simulationSpeed,
  };
};

const installTelemetryBranch = (
  namespace: Namespace,
  parent: ParentNode,
  model: MachineModel,
) => {
  addUInt64(
    namespace,
    parent,
    "Revision",
    "DemoFillingCell.Telemetry.Revision",
    () => model.telemetryRevision,
  );
};

const installStateBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  addEnumVariable(
    namespace,
    parent,
    "MachineState",
    "DemoFillingCell.State.MachineState",
    dataTypes.enumTypes.MachineState!,
    () => model.machineState,
  );
  addEnumVariable(
    namespace,
    parent,
    "OperatingMode",
    "DemoFillingCell.State.OperatingMode",
    dataTypes.enumTypes.OperatingMode!,
    () => model.operatingMode,
  );
  addEnumVariable(
    namespace,
    parent,
    "CyclePhase",
    "DemoFillingCell.State.CyclePhase",
    dataTypes.enumTypes.CyclePhase!,
    () => model.cyclePhase,
  );
  addBoolean(
    namespace,
    parent,
    "Ready",
    "DemoFillingCell.State.Ready",
    () => model.machineState === MachineState.Ready,
  );
  addBoolean(
    namespace,
    parent,
    "Busy",
    "DemoFillingCell.State.Busy",
    () =>
      model.machineState === MachineState.Running ||
      model.machineState === MachineState.Resetting ||
      model.status.entries.some((entry) => !isTerminalCommandState(entry.state)),
  );
  addBoolean(
    namespace,
    parent,
    "ConfigurationValid",
    "DemoFillingCell.State.ConfigurationValid",
    () => model.configurationValid,
  );
  addBoolean(
    namespace,
    parent,
    "Homed",
    "DemoFillingCell.State.Homed",
    () => model.motion.xAxis.homed && model.motion.zAxis.homed,
  );
  addBoolean(
    namespace,
    parent,
    "SafetyOk",
    "DemoFillingCell.State.SafetyOk",
    () => safetyOk(model),
  );
  addBoolean(
    namespace,
    parent,
    "FaultActive",
    "DemoFillingCell.State.FaultActive",
    () => activeFaultCount(model) > 0,
  );
  addBoolean(
    namespace,
    parent,
    "WarningActive",
    "DemoFillingCell.State.WarningActive",
    () => activeWarningCount(model) > 0,
  );

  const configuration = addObject(
    namespace,
    parent,
    "Configuration",
    "DemoFillingCell.State.Configuration",
  );
  addBoolean(
    namespace,
    configuration,
    "ConfigurationValid",
    "DemoFillingCell.State.Configuration.ConfigurationValid",
    () => model.configurationValid,
  );
  addString(
    namespace,
    configuration,
    "ProductName",
    "DemoFillingCell.State.Configuration.ProductName",
    () => model.configuration.productName,
  );
  addDouble(
    namespace,
    configuration,
    "TargetFillVolumeMl",
    "DemoFillingCell.State.Configuration.TargetFillVolumeMl",
    () => model.configuration.targetFillVolumeMl,
  );
  addDouble(
    namespace,
    configuration,
    "FillToleranceMl",
    "DemoFillingCell.State.Configuration.FillToleranceMl",
    () => model.configuration.fillToleranceMl,
  );
  addDouble(
    namespace,
    configuration,
    "PumpRateMlPerSecond",
    "DemoFillingCell.State.Configuration.PumpRateMlPerSecond",
    () => model.configuration.pumpRateMlPerSecond,
  );
  addUInt32(
    namespace,
    configuration,
    "BatchSize",
    "DemoFillingCell.State.Configuration.BatchSize",
    () => model.configuration.batchSize,
  );
  addDouble(
    namespace,
    configuration,
    "XAxisSpeedMmPerSecond",
    "DemoFillingCell.State.Configuration.XAxisSpeedMmPerSecond",
    () => model.configuration.xAxisSpeedMmPerSecond,
  );
  addDouble(
    namespace,
    configuration,
    "ZAxisSpeedMmPerSecond",
    "DemoFillingCell.State.Configuration.ZAxisSpeedMmPerSecond",
    () => model.configuration.zAxisSpeedMmPerSecond,
  );
};

const installCommandsBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  addUInt16(
    namespace,
    parent,
    "InterfaceVersionMajor",
    "DemoFillingCell.Commands.InterfaceVersionMajor",
    () => 1,
  );
  addUInt16(
    namespace,
    parent,
    "InterfaceVersionMinor",
    "DemoFillingCell.Commands.InterfaceVersionMinor",
    () => 0,
  );
  addUInt16(
    namespace,
    parent,
    "InterfaceVersionPatch",
    "DemoFillingCell.Commands.InterfaceVersionPatch",
    () => 0,
  );
  addUInt32(
    namespace,
    parent,
    "CatalogRevision",
    "DemoFillingCell.Commands.CatalogRevision",
    () => 1,
  );

  addExtensionObjectVariable(
    namespace,
    parent,
    "SubmitRequest",
    "DemoFillingCell.Commands.SubmitRequest",
    dataTypes.structureTypes.GlobalCommandSubmitRequest,
    "GlobalCommandSubmitRequest",
    dataTypes.makeExtensionObject,
    () => model.submitRequest,
    (value) => {
      const submit = normalizeSubmitRequest(value);
      model.submitRequest = submit;
      const status = observeSubmit(model, submit);
      model.submitRequest = defaultSubmitRequest();
      return status;
    },
  );

  installCommandStatusBranch(namespace, parent, dataTypes, model);
  installPayloadBranches(namespace, parent, dataTypes, model);
  installCatalogBranch(namespace, parent, dataTypes, model);
};

const installCommandStatusBranch = (
  namespace: Namespace,
  commands: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  addReadOnlyExtensionObjectVariable(
    namespace,
    commands,
    "Status",
    "DemoFillingCell.Commands.Status",
    dataTypes.structureTypes.CommandStatusBuffer,
    "CommandStatusBuffer",
    dataTypes.makeExtensionObject,
    () => commandStatusBufferRecord(model.status),
  );
};

const installPayloadBranches = (
  namespace: Namespace,
  commands: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  const payloads = addObject(
    namespace,
    commands,
    "Payloads",
    "DemoFillingCell.Commands.Payloads",
  );
  const domains: Record<CommandDomain, ParentNode> = {
    Machine: addObject(
      namespace,
      payloads,
      "Machine",
      "DemoFillingCell.Commands.Payloads.Machine",
    ),
    Manual: addObject(
      namespace,
      payloads,
      "Manual",
      "DemoFillingCell.Commands.Payloads.Manual",
    ),
    Maintenance: addObject(
      namespace,
      payloads,
      "Maintenance",
      "DemoFillingCell.Commands.Payloads.Maintenance",
    ),
  };

  for (const metadata of commandMetadata) {
    if (!metadata.payloadTypeName) continue;
    addExtensionObjectVariable(
      namespace,
      domains[metadata.domain],
      metadata.commandName,
      `DemoFillingCell.Commands.Payloads.${metadata.domain}.${metadata.commandName}`,
      dataTypes.structureTypes[metadata.payloadTypeName],
      metadata.payloadTypeName,
      dataTypes.makeExtensionObject,
      () =>
        model.payloads[metadata.kindName] ??
        defaultPayload(metadata.payloadTypeName!),
      (value) => {
        model.payloads[metadata.kindName] = normalizePayload(
          metadata.payloadTypeName!,
          value,
        );
        return StatusCodes.Good;
      },
    );
  }
};

const installCatalogBranch = (
  namespace: Namespace,
  commands: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  const catalog = addObject(
    namespace,
    commands,
    "Catalog",
    "DemoFillingCell.Commands.Catalog",
  );

  for (const metadata of commandMetadata) {
    const entry = addObject(
      namespace,
      catalog,
      metadata.kindName,
      `DemoFillingCell.Commands.Catalog.${metadata.kindName}`,
    );
    addEnumVariable(
      namespace,
      entry,
      "CommandKind",
      `DemoFillingCell.Commands.Catalog.${metadata.kindName}.CommandKind`,
      dataTypes.enumTypes.GlobalCommandKind!,
      () => metadata.kind,
    );
    addBoolean(
      namespace,
      entry,
      "RequiresPayload",
      `DemoFillingCell.Commands.Catalog.${metadata.kindName}.RequiresPayload`,
      () => Boolean(metadata.payloadTypeName),
    );
    addString(
      namespace,
      entry,
      "PayloadBrowsePath",
      `DemoFillingCell.Commands.Catalog.${metadata.kindName}.PayloadBrowsePath`,
      () => metadata.payloadBrowsePath,
    );
    addString(
      namespace,
      entry,
      "PayloadTypeName",
      `DemoFillingCell.Commands.Catalog.${metadata.kindName}.PayloadTypeName`,
      () => metadata.payloadTypeName ?? "",
    );
    addString(
      namespace,
      entry,
      "Description",
      `DemoFillingCell.Commands.Catalog.${metadata.kindName}.Description`,
      () => metadata.description,
    );
    addBoolean(
      namespace,
      entry,
      "CurrentlyAvailable",
      `DemoFillingCell.Commands.Catalog.${metadata.kindName}.CurrentlyAvailable`,
      () => commandAvailability(model, metadata).available,
    );
    addString(
      namespace,
      entry,
      "UnavailableReasonCode",
      `DemoFillingCell.Commands.Catalog.${metadata.kindName}.UnavailableReasonCode`,
      () => commandAvailability(model, metadata).reasonCode,
    );
    addString(
      namespace,
      entry,
      "UnavailableMessage",
      `DemoFillingCell.Commands.Catalog.${metadata.kindName}.UnavailableMessage`,
      () => commandAvailability(model, metadata).message,
    );
  }
};

const installMotionBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  const xAxis = addObject(
    namespace,
    parent,
    "XAxis",
    "DemoFillingCell.Motion.XAxis",
  );
  const zAxis = addObject(
    namespace,
    parent,
    "ZAxis",
    "DemoFillingCell.Motion.ZAxis",
  );
  installAxisBranch(
    namespace,
    xAxis,
    dataTypes,
    "DemoFillingCell.Motion.XAxis",
    model.motion.xAxis,
    "X",
  );
  installAxisBranch(
    namespace,
    zAxis,
    dataTypes,
    "DemoFillingCell.Motion.ZAxis",
    model.motion.zAxis,
    "Z",
  );
};

const installAxisBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  prefix: string,
  axis: AxisModel,
  axisKind: "X" | "Z",
) => {
  addEnumVariable(
    namespace,
    parent,
    "State",
    `${prefix}.State`,
    dataTypes.enumTypes.AxisState!,
    () => axis.state,
  );
  addDouble(
    namespace,
    parent,
    "ActualPositionMm",
    `${prefix}.ActualPositionMm`,
    () => axis.actualPositionMm,
  );
  addDouble(
    namespace,
    parent,
    "TargetPositionMm",
    `${prefix}.TargetPositionMm`,
    () => axis.targetPositionMm,
  );
  addDouble(
    namespace,
    parent,
    "ActualVelocityMmPerSecond",
    `${prefix}.ActualVelocityMmPerSecond`,
    () => axis.actualVelocityMmPerSecond,
  );
  addDouble(
    namespace,
    parent,
    "CommandedVelocityMmPerSecond",
    `${prefix}.CommandedVelocityMmPerSecond`,
    () => axis.commandedVelocityMmPerSecond,
  );
  addBoolean(namespace, parent, "Homed", `${prefix}.Homed`, () => axis.homed);
  addBoolean(
    namespace,
    parent,
    "Enabled",
    `${prefix}.Enabled`,
    () => axis.enabled,
  );
  addBoolean(
    namespace,
    parent,
    "PositiveLimitActive",
    `${prefix}.PositiveLimitActive`,
    () => axis.positiveLimitActive,
  );
  addBoolean(
    namespace,
    parent,
    "NegativeLimitActive",
    `${prefix}.NegativeLimitActive`,
    () => axis.negativeLimitActive,
  );
  addString(
    namespace,
    parent,
    "FaultCode",
    `${prefix}.FaultCode`,
    () => axis.faultCode,
  );

  if (axisKind === "X") {
    addEnumVariable(
      namespace,
      parent,
      "CurrentTarget",
      `${prefix}.CurrentTarget`,
      dataTypes.enumTypes.XAxisTarget!,
      () => axis.currentTarget,
    );
    addBoolean(namespace, parent, "AtHome", `${prefix}.AtHome`, () =>
      atPosition(axis, xAxisTargetPositions[XAxisTarget.Home]),
    );
    addBoolean(namespace, parent, "AtLoad", `${prefix}.AtLoad`, () =>
      atPosition(axis, xAxisTargetPositions[XAxisTarget.Load]),
    );
    addBoolean(namespace, parent, "AtFill", `${prefix}.AtFill`, () =>
      atPosition(axis, xAxisTargetPositions[XAxisTarget.Fill]),
    );
    addBoolean(namespace, parent, "AtInspect", `${prefix}.AtInspect`, () =>
      atPosition(axis, xAxisTargetPositions[XAxisTarget.Inspect]),
    );
    addBoolean(namespace, parent, "AtUnload", `${prefix}.AtUnload`, () =>
      atPosition(axis, xAxisTargetPositions[XAxisTarget.Unload]),
    );
    const targets = addObject(
      namespace,
      parent,
      "Targets",
      `${prefix}.Targets`,
    );
    addDouble(
      namespace,
      targets,
      "HomePositionMm",
      `${prefix}.Targets.HomePositionMm`,
      () => xAxisTargetPositions[XAxisTarget.Home],
    );
    addDouble(
      namespace,
      targets,
      "LoadPositionMm",
      `${prefix}.Targets.LoadPositionMm`,
      () => xAxisTargetPositions[XAxisTarget.Load],
    );
    addDouble(
      namespace,
      targets,
      "FillPositionMm",
      `${prefix}.Targets.FillPositionMm`,
      () => xAxisTargetPositions[XAxisTarget.Fill],
    );
    addDouble(
      namespace,
      targets,
      "InspectPositionMm",
      `${prefix}.Targets.InspectPositionMm`,
      () => xAxisTargetPositions[XAxisTarget.Inspect],
    );
    addDouble(
      namespace,
      targets,
      "UnloadPositionMm",
      `${prefix}.Targets.UnloadPositionMm`,
      () => xAxisTargetPositions[XAxisTarget.Unload],
    );
    return;
  }

  addEnumVariable(
    namespace,
    parent,
    "CurrentTarget",
    `${prefix}.CurrentTarget`,
    dataTypes.enumTypes.ZAxisTarget!,
    () => axis.currentTarget,
  );
  addBoolean(namespace, parent, "AtHome", `${prefix}.AtHome`, () =>
    atPosition(axis, zAxisTargetPositions[ZAxisTarget.Home]),
  );
  addBoolean(namespace, parent, "AtSafe", `${prefix}.AtSafe`, () =>
    atPosition(axis, zAxisTargetPositions[ZAxisTarget.Safe]),
  );
  addBoolean(namespace, parent, "AtFill", `${prefix}.AtFill`, () =>
    atPosition(axis, zAxisTargetPositions[ZAxisTarget.Fill]),
  );
  addBoolean(
    namespace,
    parent,
    "AtMaintenance",
    `${prefix}.AtMaintenance`,
    () => atPosition(axis, zAxisTargetPositions[ZAxisTarget.Maintenance]),
  );
  const targets = addObject(namespace, parent, "Targets", `${prefix}.Targets`);
  addDouble(
    namespace,
    targets,
    "HomePositionMm",
    `${prefix}.Targets.HomePositionMm`,
    () => zAxisTargetPositions[ZAxisTarget.Home],
  );
  addDouble(
    namespace,
    targets,
    "SafePositionMm",
    `${prefix}.Targets.SafePositionMm`,
    () => zAxisTargetPositions[ZAxisTarget.Safe],
  );
  addDouble(
    namespace,
    targets,
    "FillPositionMm",
    `${prefix}.Targets.FillPositionMm`,
    () => zAxisTargetPositions[ZAxisTarget.Fill],
  );
  addDouble(
    namespace,
    targets,
    "MaintenancePositionMm",
    `${prefix}.Targets.MaintenancePositionMm`,
    () => zAxisTargetPositions[ZAxisTarget.Maintenance],
  );
};

const installFillingBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  const tank = addObject(
    namespace,
    parent,
    "Tank",
    "DemoFillingCell.Filling.Tank",
  );
  addDouble(
    namespace,
    tank,
    "CapacityMl",
    "DemoFillingCell.Filling.Tank.CapacityMl",
    () => model.filling.tankCapacityMl,
  );
  addDouble(
    namespace,
    tank,
    "LevelMl",
    "DemoFillingCell.Filling.Tank.LevelMl",
    () => model.filling.tankLevelMl,
  );
  addDouble(
    namespace,
    tank,
    "LowLevelThresholdMl",
    "DemoFillingCell.Filling.Tank.LowLevelThresholdMl",
    () => model.filling.lowLevelThresholdMl,
  );
  addDouble(
    namespace,
    tank,
    "EmptyThresholdMl",
    "DemoFillingCell.Filling.Tank.EmptyThresholdMl",
    () => model.filling.emptyThresholdMl,
  );
  addBoolean(
    namespace,
    tank,
    "LowLevel",
    "DemoFillingCell.Filling.Tank.LowLevel",
    () => tankLow(model),
  );
  addBoolean(
    namespace,
    tank,
    "Empty",
    "DemoFillingCell.Filling.Tank.Empty",
    () => tankEmpty(model),
  );

  const pump = addObject(
    namespace,
    parent,
    "Pump",
    "DemoFillingCell.Filling.Pump",
  );
  addEnumVariable(
    namespace,
    pump,
    "State",
    "DemoFillingCell.Filling.Pump.State",
    dataTypes.enumTypes.PumpState!,
    () => model.filling.pumpState,
  );
  addBoolean(
    namespace,
    pump,
    "Running",
    "DemoFillingCell.Filling.Pump.Running",
    () => model.filling.pumpState === PumpState.Running,
  );
  addDouble(
    namespace,
    pump,
    "RateMlPerSecond",
    "DemoFillingCell.Filling.Pump.RateMlPerSecond",
    () => model.configuration.pumpRateMlPerSecond,
  );
  addString(
    namespace,
    pump,
    "FaultCode",
    "DemoFillingCell.Filling.Pump.FaultCode",
    () => model.filling.pumpFaultCode,
  );

  const valve = addObject(
    namespace,
    parent,
    "NozzleValve",
    "DemoFillingCell.Filling.NozzleValve",
  );
  addEnumVariable(
    namespace,
    valve,
    "State",
    "DemoFillingCell.Filling.NozzleValve.State",
    dataTypes.enumTypes.NozzleValveState!,
    () => model.filling.nozzleValveState,
  );
  addBoolean(
    namespace,
    valve,
    "Open",
    "DemoFillingCell.Filling.NozzleValve.Open",
    () => model.filling.nozzleValveState === NozzleValveState.Open,
  );
  addString(
    namespace,
    valve,
    "FaultCode",
    "DemoFillingCell.Filling.NozzleValve.FaultCode",
    () => model.filling.nozzleValveFaultCode,
  );
};

const installPartHandlingBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  const clamp = addObject(
    namespace,
    parent,
    "Clamp",
    "DemoFillingCell.PartHandling.Clamp",
  );
  addEnumVariable(
    namespace,
    clamp,
    "State",
    "DemoFillingCell.PartHandling.Clamp.State",
    dataTypes.enumTypes.ClampState!,
    () => model.partHandling.clampState,
  );
  addBoolean(
    namespace,
    clamp,
    "Open",
    "DemoFillingCell.PartHandling.Clamp.Open",
    () => model.partHandling.clampState === ClampState.Open,
  );
  addBoolean(
    namespace,
    clamp,
    "Closed",
    "DemoFillingCell.PartHandling.Clamp.Closed",
    () => model.partHandling.clampState === ClampState.Closed,
  );
  addString(
    namespace,
    clamp,
    "FaultCode",
    "DemoFillingCell.PartHandling.Clamp.FaultCode",
    () => model.partHandling.clampFaultCode,
  );
  addBoolean(
    namespace,
    parent,
    "PartPresent",
    "DemoFillingCell.PartHandling.PartPresent",
    () => model.partHandling.partPresent,
  );
};

const installInspectionBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  addDouble(
    namespace,
    parent,
    "FillLevelMl",
    "DemoFillingCell.Inspection.FillLevelMl",
    () => model.inspection.fillLevelMl,
  );
  addBoolean(
    namespace,
    parent,
    "FillLevelOk",
    "DemoFillingCell.Inspection.FillLevelOk",
    () => model.inspection.fillLevelOk,
  );
  addEnumVariable(
    namespace,
    parent,
    "Result",
    "DemoFillingCell.Inspection.Result",
    dataTypes.enumTypes.InspectionResult!,
    () => model.inspection.result,
  );
  addEnumVariable(
    namespace,
    parent,
    "RejectReason",
    "DemoFillingCell.Inspection.RejectReason",
    dataTypes.enumTypes.RejectReason!,
    () => model.inspection.rejectReason,
  );
  addString(
    namespace,
    parent,
    "SensorFaultCode",
    "DemoFillingCell.Inspection.SensorFaultCode",
    () => model.inspection.sensorFaultCode,
  );
};

const installSafetyBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  addEnumVariable(
    namespace,
    parent,
    "EmergencyStopState",
    "DemoFillingCell.Safety.EmergencyStopState",
    dataTypes.enumTypes.EmergencyStopState!,
    () => model.safety.emergencyStopState,
  );
  addEnumVariable(
    namespace,
    parent,
    "GuardDoorState",
    "DemoFillingCell.Safety.GuardDoorState",
    dataTypes.enumTypes.GuardDoorState!,
    () => model.safety.guardDoorState,
  );
  addEnumVariable(
    namespace,
    parent,
    "SafetyCircuitState",
    "DemoFillingCell.Safety.SafetyCircuitState",
    dataTypes.enumTypes.SafetyCircuitState!,
    () => model.safety.safetyCircuitState,
  );
  addBoolean(
    namespace,
    parent,
    "ResetRequired",
    "DemoFillingCell.Safety.ResetRequired",
    () => model.safety.resetRequired,
  );
  addEnumVariable(
    namespace,
    parent,
    "StopReason",
    "DemoFillingCell.Safety.StopReason",
    dataTypes.enumTypes.SafetyStopReason!,
    () => model.safety.stopReason,
  );

  const reset = addObject(
    namespace,
    parent,
    "Reset",
    "DemoFillingCell.Safety.Reset",
  );
  addBoolean(
    namespace,
    reset,
    "SafetyResetAcknowledgePossible",
    "DemoFillingCell.Safety.Reset.SafetyResetAcknowledgePossible",
    () => safetyResetAcknowledgePossible(model).available,
  );
  addString(
    namespace,
    reset,
    "SafetyResetBlockedReasonCode",
    "DemoFillingCell.Safety.Reset.SafetyResetBlockedReasonCode",
    () => safetyResetAcknowledgePossible(model).reasonCode,
  );
  addString(
    namespace,
    reset,
    "SafetyResetBlockedMessage",
    "DemoFillingCell.Safety.Reset.SafetyResetBlockedMessage",
    () => safetyResetAcknowledgePossible(model).message,
  );
  addBoolean(
    namespace,
    reset,
    "MachineResetPossible",
    "DemoFillingCell.Safety.Reset.MachineResetPossible",
    () => machineResetPossible(model).available,
  );
  addString(
    namespace,
    reset,
    "MachineResetBlockedReasonCode",
    "DemoFillingCell.Safety.Reset.MachineResetBlockedReasonCode",
    () => machineResetPossible(model).reasonCode,
  );
  addString(
    namespace,
    reset,
    "MachineResetBlockedMessage",
    "DemoFillingCell.Safety.Reset.MachineResetBlockedMessage",
    () => machineResetPossible(model).message,
  );
};

const installOperatorFeedbackBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  const stackLight = addObject(
    namespace,
    parent,
    "StackLight",
    "DemoFillingCell.OperatorFeedback.StackLight",
  );
  addBoolean(
    namespace,
    stackLight,
    "Red",
    "DemoFillingCell.OperatorFeedback.StackLight.Red",
    () =>
      model.machineState === MachineState.Faulted ||
      model.machineState === MachineState.SafetyStopped ||
      model.machineState === MachineState.Aborted,
  );
  addBoolean(
    namespace,
    stackLight,
    "Yellow",
    "DemoFillingCell.OperatorFeedback.StackLight.Yellow",
    () =>
      model.machineState === MachineState.Idle ||
      model.machineState === MachineState.Paused ||
      activeWarningCount(model) > 0,
  );
  addBoolean(
    namespace,
    stackLight,
    "Green",
    "DemoFillingCell.OperatorFeedback.StackLight.Green",
    () =>
      model.machineState === MachineState.Ready ||
      model.machineState === MachineState.Running,
  );
  addBoolean(
    namespace,
    stackLight,
    "Blue",
    "DemoFillingCell.OperatorFeedback.StackLight.Blue",
    () => model.operatingMode === OperatingMode.Maintenance,
  );

  addEnumVariable(
    namespace,
    parent,
    "Buzzer",
    "DemoFillingCell.OperatorFeedback.Buzzer",
    dataTypes.enumTypes.BuzzerState!,
    () => {
      if (
        model.machineState === MachineState.SafetyStopped ||
        model.machineState === MachineState.Faulted
      )
        return BuzzerState.Continuous;
      if (activeWarningCount(model) > 0) return BuzzerState.Intermittent;
      if (model.machineState === MachineState.Complete)
        return BuzzerState.ShortPulse;
      return BuzzerState.Off;
    },
  );
};

const installProductionBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  const batch = addObject(
    namespace,
    parent,
    "Batch",
    "DemoFillingCell.Production.Batch",
  );
  addUInt32(
    namespace,
    batch,
    "TargetCount",
    "DemoFillingCell.Production.Batch.TargetCount",
    () => model.production.targetCount,
  );
  addUInt32(
    namespace,
    batch,
    "StartedCount",
    "DemoFillingCell.Production.Batch.StartedCount",
    () => model.production.startedCount,
  );
  addUInt32(
    namespace,
    batch,
    "CompletedCount",
    "DemoFillingCell.Production.Batch.CompletedCount",
    () => model.production.completedCount,
  );
  addUInt32(
    namespace,
    batch,
    "GoodCount",
    "DemoFillingCell.Production.Batch.GoodCount",
    () => model.production.goodCount,
  );
  addUInt32(
    namespace,
    batch,
    "RejectedCount",
    "DemoFillingCell.Production.Batch.RejectedCount",
    () => model.production.rejectedCount,
  );
  addUInt32(
    namespace,
    batch,
    "RemainingCount",
    "DemoFillingCell.Production.Batch.RemainingCount",
    () =>
      Math.max(
        0,
        model.production.targetCount - model.production.completedCount,
      ),
  );

  const currentPart = addObject(
    namespace,
    parent,
    "CurrentPart",
    "DemoFillingCell.Production.CurrentPart",
  );
  addUInt32(
    namespace,
    currentPart,
    "Index",
    "DemoFillingCell.Production.CurrentPart.Index",
    () => model.production.currentPartIndex,
  );
  addDouble(
    namespace,
    currentPart,
    "FillVolumeMl",
    "DemoFillingCell.Production.CurrentPart.FillVolumeMl",
    () => model.production.currentPartFillVolumeMl,
  );
  addEnumVariable(
    namespace,
    currentPart,
    "InspectionResult",
    "DemoFillingCell.Production.CurrentPart.InspectionResult",
    dataTypes.enumTypes.InspectionResult!,
    () => model.production.currentPartInspectionResult,
  );
  addEnumVariable(
    namespace,
    currentPart,
    "RejectReason",
    "DemoFillingCell.Production.CurrentPart.RejectReason",
    dataTypes.enumTypes.RejectReason!,
    () => model.production.currentPartRejectReason,
  );

  const timing = addObject(
    namespace,
    parent,
    "Timing",
    "DemoFillingCell.Production.Timing",
  );
  addUInt32(
    namespace,
    timing,
    "LastCycleTimeMs",
    "DemoFillingCell.Production.Timing.LastCycleTimeMs",
    () => model.production.lastCycleTimeMs,
  );
  addUInt32(
    namespace,
    timing,
    "AverageCycleTimeMs",
    "DemoFillingCell.Production.Timing.AverageCycleTimeMs",
    () => model.production.averageCycleTimeMs,
  );
  addUInt32(
    namespace,
    timing,
    "BatchElapsedTimeMs",
    "DemoFillingCell.Production.Timing.BatchElapsedTimeMs",
    () => model.production.batchElapsedTimeMs,
  );

  const lifetime = addObject(
    namespace,
    parent,
    "Lifetime",
    "DemoFillingCell.Production.Lifetime",
  );
  addUInt32(
    namespace,
    lifetime,
    "TotalCompletedCount",
    "DemoFillingCell.Production.Lifetime.TotalCompletedCount",
    () => model.production.totalCompletedCount,
  );
  addUInt32(
    namespace,
    lifetime,
    "TotalGoodCount",
    "DemoFillingCell.Production.Lifetime.TotalGoodCount",
    () => model.production.totalGoodCount,
  );
  addUInt32(
    namespace,
    lifetime,
    "TotalRejectedCount",
    "DemoFillingCell.Production.Lifetime.TotalRejectedCount",
    () => model.production.totalRejectedCount,
  );
};

const installDiagnosticsBranch = (
  namespace: Namespace,
  parent: ParentNode,
  dataTypes: DataTypeRegistry,
  model: MachineModel,
) => {
  const warnings = addObject(
    namespace,
    parent,
    "Warnings",
    "DemoFillingCell.Diagnostics.Warnings",
  );
  addBoolean(
    namespace,
    warnings,
    "TankLow",
    "DemoFillingCell.Diagnostics.Warnings.TankLow",
    () => tankLow(model),
  );
  addBoolean(
    namespace,
    warnings,
    "FillLevelDrift",
    "DemoFillingCell.Diagnostics.Warnings.FillLevelDrift",
    () => model.diagnostics.warnings.fillLevelDrift,
  );
  addBoolean(
    namespace,
    warnings,
    "InspectionRejectRateHigh",
    "DemoFillingCell.Diagnostics.Warnings.InspectionRejectRateHigh",
    () => model.diagnostics.warnings.inspectionRejectRateHigh,
  );
  addBoolean(
    namespace,
    warnings,
    "MaintenanceRecommended",
    "DemoFillingCell.Diagnostics.Warnings.MaintenanceRecommended",
    () => model.diagnostics.warnings.maintenanceRecommended,
  );
  addBoolean(
    namespace,
    warnings,
    "CycleTimeHigh",
    "DemoFillingCell.Diagnostics.Warnings.CycleTimeHigh",
    () => model.diagnostics.warnings.cycleTimeHigh,
  );

  const faults = addObject(
    namespace,
    parent,
    "Faults",
    "DemoFillingCell.Diagnostics.Faults",
  );
  const motion = addObject(
    namespace,
    faults,
    "Motion",
    "DemoFillingCell.Diagnostics.Faults.Motion",
  );
  addBoolean(
    namespace,
    motion,
    "XAxisNotHomed",
    "DemoFillingCell.Diagnostics.Faults.Motion.XAxisNotHomed",
    () => model.diagnostics.faults.motion.xAxisNotHomed,
  );
  addBoolean(
    namespace,
    motion,
    "ZAxisNotHomed",
    "DemoFillingCell.Diagnostics.Faults.Motion.ZAxisNotHomed",
    () => model.diagnostics.faults.motion.zAxisNotHomed,
  );
  addBoolean(
    namespace,
    motion,
    "XAxisPositionError",
    "DemoFillingCell.Diagnostics.Faults.Motion.XAxisPositionError",
    () => model.diagnostics.faults.motion.xAxisPositionError,
  );
  addBoolean(
    namespace,
    motion,
    "ZAxisPositionError",
    "DemoFillingCell.Diagnostics.Faults.Motion.ZAxisPositionError",
    () => model.diagnostics.faults.motion.zAxisPositionError,
  );

  const partHandling = addObject(
    namespace,
    faults,
    "PartHandling",
    "DemoFillingCell.Diagnostics.Faults.PartHandling",
  );
  addBoolean(
    namespace,
    partHandling,
    "ClampFailedToClose",
    "DemoFillingCell.Diagnostics.Faults.PartHandling.ClampFailedToClose",
    () => model.diagnostics.faults.partHandling.clampFailedToClose,
  );

  const filling = addObject(
    namespace,
    faults,
    "Filling",
    "DemoFillingCell.Diagnostics.Faults.Filling",
  );
  addBoolean(
    namespace,
    filling,
    "TankEmpty",
    "DemoFillingCell.Diagnostics.Faults.Filling.TankEmpty",
    () => tankEmpty(model),
  );
  addBoolean(
    namespace,
    filling,
    "PumpFault",
    "DemoFillingCell.Diagnostics.Faults.Filling.PumpFault",
    () => model.diagnostics.faults.filling.pumpFault,
  );
  addBoolean(
    namespace,
    filling,
    "ValveFault",
    "DemoFillingCell.Diagnostics.Faults.Filling.ValveFault",
    () => model.diagnostics.faults.filling.valveFault,
  );

  const inspection = addObject(
    namespace,
    faults,
    "Inspection",
    "DemoFillingCell.Diagnostics.Faults.Inspection",
  );
  addBoolean(
    namespace,
    inspection,
    "SensorFault",
    "DemoFillingCell.Diagnostics.Faults.Inspection.SensorFault",
    () => model.diagnostics.faults.inspection.sensorFault,
  );

  const summary = addObject(
    namespace,
    parent,
    "Summary",
    "DemoFillingCell.Diagnostics.Summary",
  );
  addUInt16(
    namespace,
    summary,
    "ActiveWarningCount",
    "DemoFillingCell.Diagnostics.Summary.ActiveWarningCount",
    () => activeWarningCount(model),
  );
  addUInt16(
    namespace,
    summary,
    "ActiveFaultCount",
    "DemoFillingCell.Diagnostics.Summary.ActiveFaultCount",
    () => activeFaultCount(model),
  );
  addEnumVariable(
    namespace,
    summary,
    "HighestSeverity",
    "DemoFillingCell.Diagnostics.Summary.HighestSeverity",
    dataTypes.enumTypes.DiagnosticSeverity!,
    () => highestSeverity(model),
  );
  addString(
    namespace,
    summary,
    "PrimaryFaultCode",
    "DemoFillingCell.Diagnostics.Summary.PrimaryFaultCode",
    () => primaryFaultCode(model),
  );
};

const addObject = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
) =>
  namespace.addObject({
    browseName,
    nodeId: `s=${nodeIdPath}`,
    componentOf: parent as never,
  });

const addScalar = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  dataType: string | NodeId,
  variantDataType: DataType,
  getValue: () => unknown,
) =>
  namespace.addVariable({
    browseName,
    nodeId: `s=${nodeIdPath}`,
    componentOf: parent as never,
    dataType,
    accessLevel: "CurrentRead",
    userAccessLevel: "CurrentRead",
    minimumSamplingInterval: 100,
    value: {
      get: () =>
        new Variant({
          dataType: variantDataType,
          value: getValue(),
        }),
    },
  });

const addBoolean = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  getValue: () => boolean,
) =>
  addScalar(
    namespace,
    parent,
    browseName,
    nodeIdPath,
    "Boolean",
    DataType.Boolean,
    getValue,
  );

const addString = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  getValue: () => string,
) =>
  addScalar(
    namespace,
    parent,
    browseName,
    nodeIdPath,
    "String",
    DataType.String,
    getValue,
  );

const addDouble = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  getValue: () => number,
) =>
  addScalar(
    namespace,
    parent,
    browseName,
    nodeIdPath,
    "Double",
    DataType.Double,
    getValue,
  );

const addUInt16 = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  getValue: () => number,
) =>
  addScalar(
    namespace,
    parent,
    browseName,
    nodeIdPath,
    "UInt16",
    DataType.UInt16,
    () => Math.trunc(getValue()),
  );

const addUInt32 = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  getValue: () => number,
) =>
  addScalar(
    namespace,
    parent,
    browseName,
    nodeIdPath,
    "UInt32",
    DataType.UInt32,
    () => Math.max(0, Math.trunc(getValue())),
  );

const addUInt64 = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  getValue: () => number,
) =>
  namespace.addVariable({
    browseName,
    nodeId: `s=${nodeIdPath}`,
    componentOf: parent as never,
    dataType: "UInt64",
    accessLevel: "CurrentRead",
    userAccessLevel: "CurrentRead",
    minimumSamplingInterval: 100,
    value: {
      get: () =>
        new Variant({
          dataType: DataType.UInt64,
          arrayType: VariantArrayType.Scalar,
          value: coerceUInt64(String(Math.max(0, Math.trunc(getValue())))),
        }),
    },
  });

const addDateTime = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  getValue: () => Date,
) =>
  addScalar(
    namespace,
    parent,
    browseName,
    nodeIdPath,
    "DateTime",
    DataType.DateTime,
    getValue,
  );

const addEnumVariable = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  dataType: UADataType,
  getValue: () => number,
) =>
  addScalar(
    namespace,
    parent,
    browseName,
    nodeIdPath,
    dataType.nodeId,
    DataType.Int32,
    () => Math.trunc(getValue()),
  );

const addExtensionObjectVariable = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  dataType: UADataType,
  typeName: StructureTypeName,
  makeExtensionObject: DataTypeRegistry["makeExtensionObject"],
  getValue: () => StructureRecord,
  setValue: (value: StructureRecord) => typeof StatusCodes.Good,
) =>
  namespace.addVariable({
    browseName,
    nodeId: `s=${nodeIdPath}`,
    componentOf: parent as never,
    dataType: dataType.nodeId,
    accessLevel: "CurrentRead | CurrentWrite",
    userAccessLevel: "CurrentRead | CurrentWrite",
    minimumSamplingInterval: 100,
    value: {
      get: () =>
        new Variant({
          dataType: DataType.ExtensionObject,
          value: makeExtensionObject(typeName, getValue()),
        }),
      set: (variant: Variant) => {
        if (variant.dataType !== DataType.ExtensionObject || !variant.value) {
          return StatusCodes.BadTypeMismatch;
        }
        return setValue(structureRecord(variant.value));
      },
    },
  });

const addReadOnlyExtensionObjectVariable = (
  namespace: Namespace,
  parent: ParentNode,
  browseName: string,
  nodeIdPath: string,
  dataType: UADataType,
  typeName: StructureTypeName,
  makeExtensionObject: DataTypeRegistry["makeExtensionObject"],
  getValue: () => StructureRecord,
) =>
  namespace.addVariable({
    browseName,
    nodeId: `s=${nodeIdPath}`,
    componentOf: parent as never,
    dataType: dataType.nodeId,
    accessLevel: "CurrentRead",
    userAccessLevel: "CurrentRead",
    minimumSamplingInterval: 100,
    value: {
      get: () =>
        new Variant({
          dataType: DataType.ExtensionObject,
          value: makeExtensionObject(typeName, getValue()),
        }),
    },
  });

const observeSubmit = (
  model: MachineModel,
  submit: GlobalCommandSubmitRequest,
) => {
  if (isDefaultSubmit(submit)) return StatusCodes.Good;
  if (submit.commandId === "" || submit.commandKind === GlobalCommandKind.None) {
    return StatusCodes.Good;
  }
  if (hasRetainedCommandId(model, submit.commandId)) {
    return StatusCodes.BadInvalidArgument;
  }

  const entry = appendObservedCommand(model, submit);
  if (!entry) return StatusCodes.Good;

  const metadata = metadataByKind.get(submit.commandKind);
  if (metadata === undefined) {
    finishCommand(model, entry, {
      state: CommandState.Rejected,
      code: "InvalidCommandKind",
      message: "The command kind is None or unsupported.",
    });
    return StatusCodes.Good;
  }

  if (metadata.payloadTypeName) {
    const payload = model.payloads[metadata.kindName];
    if (!payload) {
      finishCommand(model, entry, {
        state: CommandState.Rejected,
        code: "PayloadRequired",
        message: "The command requires a staged payload.",
      });
      return StatusCodes.Good;
    }

    const payloadCommandId = stringValue(payload.commandId);
    if (payloadCommandId !== submit.commandId) {
      finishCommand(model, entry, {
        state: CommandState.Rejected,
        code: "PayloadCommandIdMismatch",
        message:
          "The staged payload commandId does not match SubmitRequest.commandId.",
      });
      return StatusCodes.Good;
    }

    const validation = validatePayload(metadata.payloadTypeName, payload);
    if (!validation.available) {
      finishCommand(model, entry, {
        state: CommandState.Rejected,
        code: validation.reasonCode,
        message: validation.message,
      });
      return StatusCodes.Good;
    }

    executeCommand(model, metadata, entry, payload);
    return StatusCodes.Good;
  }

  executeCommand(model, metadata, entry, undefined);
  return StatusCodes.Good;
};

const executeCommand = (
  model: MachineModel,
  metadata: CommandMetadata,
  entry: CommandStatusEntry,
  payload: StructureRecord | undefined,
) => {
  const availability = commandAvailability(model, metadata);
  if (!availability.available) {
    finishCommand(model, entry, {
      state: CommandState.Rejected,
      code: availability.reasonCode,
      message: availability.message,
    });
    return;
  }

  updateCommandStatusEntry(model, entry, {
    state: CommandState.Accepted,
    code: "Accepted",
    message: "Command accepted.",
  });
  updateCommandStatusEntry(model, entry, {
    state: CommandState.Executing,
    code: "Executing",
    message: "Command is executing.",
  });

  const result =
    metadata.domain === "Machine"
      ? executeMachineCommand(model, metadata, payload)
      : metadata.domain === "Manual"
        ? executeManualCommand(model, metadata, payload)
        : executeMaintenanceCommand(model, metadata, payload);

  if (result.available) bumpTelemetryRevision(model);
  finishCommand(model, entry, {
    state: result.available
      ? CommandState.Completed
      : CommandState.Rejected,
    code: result.available ? "Completed" : result.reasonCode,
    message: result.available ? "Command completed." : result.message,
  });
};

const executeMachineCommand = (
  model: MachineModel,
  metadata: CommandMetadata,
  payload: StructureRecord | undefined,
): Availability => {
  switch (metadata.kindName) {
    case "Machine_Configure": {
      const configuration = normalizeRunConfiguration(
        structureRecord(payload?.configuration),
      );
      model.configuration = configuration;
      model.configurationValid = true;
      resetBatchCounters(model);
      transitionIdleOrReady(model);
      return available();
    }
    case "Machine_SetMode": {
      const targetMode = numberValue(payload?.targetMode);
      if (
        !isEnumValue(OperatingMode, targetMode) ||
        targetMode === OperatingMode.None
      ) {
        return unavailable(
          "InvalidPayload",
          "targetMode must be a real OperatingMode value.",
        );
      }
      const modeChange = canSetMode(model, targetMode);
      if (!modeChange.available) return modeChange;
      model.operatingMode = targetMode;
      if (
        model.machineState === MachineState.Ready &&
        targetMode !== OperatingMode.Automatic
      ) {
        model.machineState = MachineState.Idle;
      }
      transitionIdleOrReady(model);
      return available();
    }
    case "Machine_Home":
      homeAxis(
        model.motion.zAxis,
        ZAxisTarget.Safe,
        zAxisTargetPositions[ZAxisTarget.Safe],
      );
      homeAxis(
        model.motion.xAxis,
        XAxisTarget.Home,
        xAxisTargetPositions[XAxisTarget.Home],
      );
      transitionIdleOrReady(model);
      return available();
    case "Machine_Start":
      model.machineState = MachineState.Running;
      model.production.batchStartedAt = Date.now();
      model.cyclePhase = CyclePhase.None;
      if (
        !atPosition(model.motion.xAxis, xAxisTargetPositions[XAxisTarget.Load])
      ) {
        moveXAxisTo(
          model,
          XAxisTarget.Load,
          model.configuration.xAxisSpeedMmPerSecond,
        );
      }
      model.cyclePhase = CyclePhase.WaitingForLoad;
      return available();
    case "Machine_Pause":
      model.machineState = MachineState.Paused;
      model.filling.pumpState = PumpState.Stopped;
      model.filling.nozzleValveState = NozzleValveState.Closed;
      model.motion.xAxis.actualVelocityMmPerSecond = 0;
      model.motion.zAxis.actualVelocityMmPerSecond = 0;
      return available();
    case "Machine_Resume":
      model.machineState = MachineState.Running;
      return available();
    case "Machine_Abort":
      model.machineState = MachineState.Aborted;
      model.filling.pumpState = PumpState.Stopped;
      model.filling.nozzleValveState = NozzleValveState.Closed;
      model.motion.xAxis.state = model.motion.xAxis.enabled
        ? AxisState.Standstill
        : AxisState.Disabled;
      model.motion.zAxis.state = model.motion.zAxis.enabled
        ? AxisState.Standstill
        : AxisState.Disabled;
      model.motion.xAxis.actualVelocityMmPerSecond = 0;
      model.motion.zAxis.actualVelocityMmPerSecond = 0;
      return available();
    case "Machine_AcknowledgeSafetyReset":
      model.safety.resetRequired = false;
      return available();
    case "Machine_Reset":
      model.machineState = MachineState.Resetting;
      model.cyclePhase = CyclePhase.None;
      model.filling.pumpState = PumpState.Stopped;
      model.filling.nozzleValveState = NozzleValveState.Closed;
      model.motion.xAxis.actualVelocityMmPerSecond = 0;
      model.motion.zAxis.actualVelocityMmPerSecond = 0;
      transitionIdleOrReady(model);
      return available();
    case "Machine_ClearCompleted":
      transitionIdleOrReady(model);
      return available();
    default:
      return unavailable("InvalidCommandKind", "Unsupported machine command.");
  }
};

const executeManualCommand = (
  model: MachineModel,
  metadata: CommandMetadata,
  payload: StructureRecord | undefined,
): Availability => {
  switch (metadata.kindName) {
    case "Manual_HomeX":
      homeAxis(
        model.motion.xAxis,
        XAxisTarget.Home,
        xAxisTargetPositions[XAxisTarget.Home],
      );
      transitionIdleOrReady(model);
      return available();
    case "Manual_HomeZ":
      homeAxis(
        model.motion.zAxis,
        ZAxisTarget.Safe,
        zAxisTargetPositions[ZAxisTarget.Safe],
      );
      transitionIdleOrReady(model);
      return available();
    case "Manual_MoveXAxisToTarget":
      return executeXAxisTargetMove(model, payload);
    case "Manual_MoveXAxisToPosition":
      return executeXAxisPositionMove(model, payload);
    case "Manual_MoveZAxisToTarget":
      return executeZAxisTargetMove(model, payload);
    case "Manual_MoveZAxisToPosition":
      return executeZAxisPositionMove(model, payload);
    case "Manual_JogXPositive":
      return executeJog(model, model.motion.xAxis, payload, 1, true);
    case "Manual_JogXNegative":
      return executeJog(model, model.motion.xAxis, payload, -1, true);
    case "Manual_JogZPositive":
      return executeJog(model, model.motion.zAxis, payload, 1, false);
    case "Manual_JogZNegative":
      return executeJog(model, model.motion.zAxis, payload, -1, false);
    case "Manual_OpenClamp":
      model.partHandling.clampState = ClampState.Open;
      return available();
    case "Manual_CloseClamp":
      model.partHandling.clampState = ClampState.Closed;
      return available();
    case "Manual_PrimePump":
      return primePump(model);
    case "Manual_StopPump":
      model.filling.pumpState = PumpState.Stopped;
      return available();
    case "Manual_OpenNozzleValve":
      if (model.filling.pumpState !== PumpState.Stopped) {
        return unavailable(
          "InterlockNotSatisfied",
          "The pump must be stopped before opening the nozzle valve manually.",
        );
      }
      model.filling.nozzleValveState = NozzleValveState.Open;
      return available();
    case "Manual_CloseNozzleValve":
      model.filling.nozzleValveState = NozzleValveState.Closed;
      return available();
    case "Manual_TriggerInspectionOnce":
      runInspection(model);
      return available();
    case "Manual_ClearActuatorFault":
      return clearActuatorFault(model, numberValue(payload?.actuator));
    default:
      return unavailable("InvalidCommandKind", "Unsupported manual command.");
  }
};

const executeMaintenanceCommand = (
  model: MachineModel,
  metadata: CommandMetadata,
  payload: StructureRecord | undefined,
): Availability => {
  switch (metadata.kindName) {
    case "Maintenance_RefillTank":
      model.filling.tankLevelMl = model.filling.tankCapacityMl;
      model.diagnostics.faults.filling.tankEmpty = false;
      transitionIdleOrReady(model);
      return available();
    case "Maintenance_DrainTank":
      model.filling.tankLevelMl = 0;
      model.diagnostics.faults.filling.tankEmpty = true;
      if (model.machineState !== MachineState.SafetyStopped) {
        model.machineState = MachineState.Faulted;
      }
      return available();
    case "Maintenance_PrimePump":
      return primePump(model);
    case "Maintenance_CleanNozzle":
      model.filling.nozzleValveState = NozzleValveState.Closed;
      model.diagnostics.faults.filling.valveFault = false;
      model.filling.nozzleValveFaultCode = "";
      return available();
    case "Maintenance_ResetPumpFault":
      model.diagnostics.faults.filling.pumpFault = false;
      model.filling.pumpFaultCode = "";
      transitionIdleOrReady(model);
      return available();
    case "Maintenance_ResetValveFault":
      model.diagnostics.faults.filling.valveFault = false;
      model.filling.nozzleValveFaultCode = "";
      transitionIdleOrReady(model);
      return available();
    case "Maintenance_CalibrateFillLevelSensor":
      model.diagnostics.faults.inspection.sensorFault = false;
      model.inspection.sensorFaultCode = "";
      return available();
    case "Maintenance_SimulateSensorCheck":
      model.inspection.result = InspectionResult.Pass;
      model.inspection.rejectReason = RejectReason.None;
      model.inspection.fillLevelOk = true;
      return available();
    case "Maintenance_ResetInspectionFault":
      model.diagnostics.faults.inspection.sensorFault = false;
      model.inspection.sensorFaultCode = "";
      transitionIdleOrReady(model);
      return available();
    case "Maintenance_MoveXAxisToTarget":
      return executeXAxisTargetMove(model, payload);
    case "Maintenance_MoveXAxisToPosition":
      return executeXAxisPositionMove(model, payload);
    case "Maintenance_MoveZAxisToTarget":
      return executeZAxisTargetMove(model, payload);
    case "Maintenance_MoveZAxisToPosition":
      return executeZAxisPositionMove(model, payload);
    case "Maintenance_JogXPositive":
      return executeJog(model, model.motion.xAxis, payload, 1, true);
    case "Maintenance_JogXNegative":
      return executeJog(model, model.motion.xAxis, payload, -1, true);
    case "Maintenance_JogZPositive":
      return executeJog(model, model.motion.zAxis, payload, 1, false);
    case "Maintenance_JogZNegative":
      return executeJog(model, model.motion.zAxis, payload, -1, false);
    case "Maintenance_HomeAxes":
      return withAxisSelection(model, payload, (axisSelection) => {
        if (
          axisSelection === AxisSelection.XAxis ||
          axisSelection === AxisSelection.Both
        ) {
          homeAxis(
            model.motion.xAxis,
            XAxisTarget.Home,
            xAxisTargetPositions[XAxisTarget.Home],
          );
        }
        if (
          axisSelection === AxisSelection.ZAxis ||
          axisSelection === AxisSelection.Both
        ) {
          homeAxis(
            model.motion.zAxis,
            ZAxisTarget.Safe,
            zAxisTargetPositions[ZAxisTarget.Safe],
          );
        }
      });
    case "Maintenance_EnableAxes":
      return withAxisSelection(model, payload, (axisSelection) => {
        setAxisEnabled(
          model.motion.xAxis,
          axisSelection,
          AxisSelection.XAxis,
          true,
        );
        setAxisEnabled(
          model.motion.zAxis,
          axisSelection,
          AxisSelection.ZAxis,
          true,
        );
      });
    case "Maintenance_DisableAxes":
      return withAxisSelection(model, payload, (axisSelection) => {
        setAxisEnabled(
          model.motion.xAxis,
          axisSelection,
          AxisSelection.XAxis,
          false,
        );
        setAxisEnabled(
          model.motion.zAxis,
          axisSelection,
          AxisSelection.ZAxis,
          false,
        );
      });
    case "Maintenance_ClearAxisFault":
      return withAxisSelection(model, payload, (axisSelection) => {
        if (
          axisSelection === AxisSelection.XAxis ||
          axisSelection === AxisSelection.Both
        ) {
          model.diagnostics.faults.motion.xAxisPositionError = false;
          model.motion.xAxis.faultCode = "";
          model.motion.xAxis.state = model.motion.xAxis.enabled
            ? AxisState.Standstill
            : AxisState.Disabled;
        }
        if (
          axisSelection === AxisSelection.ZAxis ||
          axisSelection === AxisSelection.Both
        ) {
          model.diagnostics.faults.motion.zAxisPositionError = false;
          model.motion.zAxis.faultCode = "";
          model.motion.zAxis.state = model.motion.zAxis.enabled
            ? AxisState.Standstill
            : AxisState.Disabled;
        }
      });
    case "Maintenance_OpenClamp":
      model.partHandling.clampState = ClampState.Open;
      return available();
    case "Maintenance_CloseClamp":
      model.partHandling.clampState = ClampState.Closed;
      return available();
    case "Maintenance_ClearClampFault":
      model.diagnostics.faults.partHandling.clampFailedToClose = false;
      model.partHandling.clampFaultCode = "";
      model.partHandling.clampState = ClampState.Open;
      transitionIdleOrReady(model);
      return available();
    default:
      return unavailable(
        "InvalidCommandKind",
        "Unsupported maintenance command.",
      );
  }
};

const commandAvailability = (
  model: MachineModel,
  metadata: CommandMetadata,
): Availability => {
  if (metadata.domain === "Machine") {
    return machineCommandAvailability(model, metadata.kindName);
  }
  if (metadata.domain === "Manual") {
    if (model.operatingMode !== OperatingMode.Manual) {
      return unavailable(
        "WrongMode",
        "Manual commands require Manual operating mode.",
      );
    }
    if (
      model.machineState === MachineState.Running ||
      model.machineState === MachineState.Paused ||
      model.machineState === MachineState.Resetting ||
      model.machineState === MachineState.SafetyStopped
    ) {
      return unavailable(
        "InvalidMachineState",
        "Manual commands are not accepted in the current machine state.",
      );
    }
    if (!safetyOk(model)) {
      return unavailable("SafetyNotOk", "Safety inputs are not restored.");
    }
    return available();
  }

  if (model.operatingMode !== OperatingMode.Maintenance) {
    return unavailable(
      "WrongMode",
      "Maintenance commands require Maintenance operating mode.",
    );
  }
  if (
    model.machineState === MachineState.Running ||
    model.machineState === MachineState.Paused ||
    model.machineState === MachineState.Resetting ||
    model.machineState === MachineState.SafetyStopped
  ) {
    return unavailable(
      "InvalidMachineState",
      "Maintenance commands are not accepted in the current machine state.",
    );
  }
  if (!safetyOk(model)) {
    return unavailable("SafetyNotOk", "Safety inputs are not restored.");
  }
  return available();
};

const machineCommandAvailability = (
  model: MachineModel,
  kindName: RealCommandKindName,
): Availability => {
  switch (kindName) {
    case "Machine_SetMode":
      if (
        model.machineState === MachineState.Idle ||
        model.machineState === MachineState.Ready ||
        model.machineState === MachineState.Complete ||
        recoveryModeChangePossible(model)
      ) {
        return available();
      }
      return unavailable(
        "InvalidMachineState",
        "Mode changes are not accepted while this lifecycle state is active.",
      );
    case "Machine_Configure":
      if (
        model.machineState !== MachineState.Idle &&
        model.machineState !== MachineState.Ready
      ) {
        return unavailable(
          "InvalidMachineState",
          "Configure is accepted only from Idle or Ready.",
        );
      }
      if (!safetyOk(model))
        return unavailable("SafetyNotOk", "Safety inputs are not restored.");
      return available();
    case "Machine_Home":
      if (
        model.machineState !== MachineState.Idle &&
        model.machineState !== MachineState.Ready
      ) {
        return unavailable(
          "InvalidMachineState",
          "Home is accepted only from Idle or Ready.",
        );
      }
      if (!safetyOk(model))
        return unavailable("SafetyNotOk", "Safety inputs are not restored.");
      if (activeFaultCount(model) > 0)
        return unavailable(
          "InvalidMachineState",
          "Active faults must be cleared before homing.",
        );
      return available();
    case "Machine_Start":
      return model.machineState === MachineState.Ready
        ? available()
        : unavailable(
            "InvalidMachineState",
            "Start is accepted only from Ready.",
          );
    case "Machine_Pause":
      return model.machineState === MachineState.Running
        ? available()
        : unavailable(
            "InvalidMachineState",
            "Pause is accepted only from Running.",
          );
    case "Machine_Resume":
      return model.machineState === MachineState.Paused
        ? available()
        : unavailable(
            "InvalidMachineState",
            "Resume is accepted only from Paused.",
          );
    case "Machine_Abort":
      return model.machineState === MachineState.Running ||
        model.machineState === MachineState.Paused
        ? available()
        : unavailable(
            "InvalidMachineState",
            "Abort is accepted only from Running or Paused.",
          );
    case "Machine_Reset":
      return machineResetPossible(model);
    case "Machine_ClearCompleted":
      return model.machineState === MachineState.Complete
        ? available()
        : unavailable(
            "InvalidMachineState",
            "ClearCompleted is accepted only from Complete.",
          );
    case "Machine_AcknowledgeSafetyReset":
      return safetyResetAcknowledgePossible(model);
    default:
      return unavailable("InvalidCommandKind", "Unsupported machine command.");
  }
};

const validatePayload = (
  payloadTypeName: PayloadTypeName,
  payload: StructureRecord,
): Availability => {
  switch (payloadTypeName) {
    case "MachineSetModePayload":
      return isEnumValue(OperatingMode, numberValue(payload.targetMode)) &&
        numberValue(payload.targetMode) !== OperatingMode.None
        ? available()
        : unavailable(
            "InvalidPayload",
            "targetMode must be a real OperatingMode value.",
          );
    case "MachineConfigurePayload": {
      const configuration = normalizeRunConfiguration(
        structureRecord(payload.configuration),
      );
      return validateRunConfiguration(configuration);
    }
    case "MoveXAxisToTargetPayload":
      return isEnumValue(XAxisTarget, numberValue(payload.target)) &&
        numberValue(payload.target) !== XAxisTarget.None &&
        numberValue(payload.velocityMmPerSecond) > 0
        ? available()
        : unavailable(
            "InvalidPayload",
            "X target moves require a real target and positive velocity.",
          );
    case "MoveZAxisToTargetPayload":
      return isEnumValue(ZAxisTarget, numberValue(payload.target)) &&
        numberValue(payload.target) !== ZAxisTarget.None &&
        numberValue(payload.velocityMmPerSecond) > 0
        ? available()
        : unavailable(
            "InvalidPayload",
            "Z target moves require a real target and positive velocity.",
          );
    case "MoveAxisToPositionPayload":
      return Number.isFinite(numberValue(payload.targetPositionMm)) &&
        numberValue(payload.velocityMmPerSecond) > 0
        ? available()
        : unavailable(
            "InvalidPayload",
            "Raw axis moves require a finite position and positive velocity.",
          );
    case "JogPayload":
      return numberValue(payload.velocityMmPerSecond) > 0 &&
        numberValue(payload.maxDurationMs) > 0 &&
        numberValue(payload.maxDurationMs) <= 5_000
        ? available()
        : unavailable(
            "InvalidPayload",
            "Jog commands require positive velocity and maxDurationMs between 1 and 5000.",
          );
    case "ClearActuatorFaultPayload":
      return isEnumValue(ActuatorId, numberValue(payload.actuator)) &&
        numberValue(payload.actuator) !== ActuatorId.None
        ? available()
        : unavailable(
            "InvalidPayload",
            "ClearActuatorFault requires a real actuator.",
          );
    case "AxisSelectionPayload":
      return isEnumValue(AxisSelection, numberValue(payload.axisSelection)) &&
        numberValue(payload.axisSelection) !== AxisSelection.None
        ? available()
        : unavailable(
            "InvalidPayload",
            "AxisSelectionPayload requires XAxis, ZAxis, or Both.",
          );
  }
};

const validateRunConfiguration = (
  configuration: RunConfiguration,
): Availability => {
  if (configuration.productName.trim() === "") {
    return unavailable("InvalidPayload", "productName must not be empty.");
  }
  if (configuration.targetFillVolumeMl <= 0) {
    return unavailable(
      "InvalidPayload",
      "targetFillVolumeMl must be positive.",
    );
  }
  if (configuration.fillToleranceMl < 0) {
    return unavailable(
      "InvalidPayload",
      "fillToleranceMl must be zero or positive.",
    );
  }
  if (configuration.pumpRateMlPerSecond <= 0) {
    return unavailable(
      "InvalidPayload",
      "pumpRateMlPerSecond must be positive.",
    );
  }
  if (
    !Number.isInteger(configuration.batchSize) ||
    configuration.batchSize <= 0
  ) {
    return unavailable(
      "InvalidPayload",
      "batchSize must be a positive integer.",
    );
  }
  if (
    configuration.xAxisSpeedMmPerSecond <= 0 ||
    configuration.zAxisSpeedMmPerSecond <= 0
  ) {
    return unavailable("InvalidPayload", "axis speeds must be positive.");
  }
  return available();
};

const canSetMode = (model: MachineModel, targetMode: number): Availability => {
  if (
    model.machineState === MachineState.Idle ||
    model.machineState === MachineState.Ready ||
    model.machineState === MachineState.Complete
  ) {
    return available();
  }
  if (
    targetMode === OperatingMode.Maintenance &&
    recoveryModeChangePossible(model)
  ) {
    return available();
  }
  return unavailable(
    "InvalidMachineState",
    "Mode change is not accepted in the current machine state.",
  );
};

const recoveryModeChangePossible = (model: MachineModel) =>
  (model.machineState === MachineState.Faulted ||
    model.machineState === MachineState.Aborted) &&
  allAxesStopped(model) &&
  model.filling.pumpState === PumpState.Stopped &&
  model.filling.nozzleValveState === NozzleValveState.Closed &&
  safetyOk(model);

const machineResetPossible = (model: MachineModel): Availability => {
  if (
    model.machineState !== MachineState.Faulted &&
    model.machineState !== MachineState.Aborted &&
    model.machineState !== MachineState.SafetyStopped
  ) {
    return unavailable(
      "InvalidMachineState",
      "Machine reset is accepted only from Faulted, Aborted, or SafetyStopped.",
    );
  }
  if (model.safety.emergencyStopState !== EmergencyStopState.Released) {
    return unavailable("SafetyNotOk", "Emergency stop is not released.");
  }
  if (model.safety.guardDoorState !== GuardDoorState.Closed) {
    return unavailable("SafetyNotOk", "Guard door is not closed.");
  }
  if (model.safety.safetyCircuitState !== SafetyCircuitState.Ok) {
    return unavailable("SafetyNotOk", "Safety circuit is not OK.");
  }
  if (model.safety.resetRequired) {
    return unavailable(
      "InterlockNotSatisfied",
      "Safety reset acknowledgement is still required.",
    );
  }
  if (!allAxesStopped(model)) {
    return unavailable("InterlockNotSatisfied", "All axes must be stopped.");
  }
  if (model.filling.pumpState !== PumpState.Stopped) {
    return unavailable("InterlockNotSatisfied", "Pump must be stopped.");
  }
  if (model.filling.nozzleValveState !== NozzleValveState.Closed) {
    return unavailable("InterlockNotSatisfied", "Nozzle valve must be closed.");
  }
  if (!safetyOk(model)) {
    return unavailable("SafetyNotOk", "Safety inputs are not restored.");
  }
  return available();
};

const safetyResetAcknowledgePossible = (model: MachineModel): Availability => {
  if (!model.safety.resetRequired) {
    return unavailable(
      "InvalidMachineState",
      "Safety reset acknowledgement is not required.",
    );
  }
  if (model.safety.emergencyStopState !== EmergencyStopState.Released) {
    return unavailable("SafetyNotOk", "Emergency stop is not released.");
  }
  if (model.safety.guardDoorState !== GuardDoorState.Closed) {
    return unavailable("SafetyNotOk", "Guard door is not closed.");
  }
  if (model.safety.safetyCircuitState !== SafetyCircuitState.Ok) {
    return unavailable("SafetyNotOk", "Safety circuit is not OK.");
  }
  return available();
};

const executeXAxisTargetMove = (
  model: MachineModel,
  payload: StructureRecord | undefined,
): Availability => {
  if (!atPosition(model.motion.zAxis, zAxisTargetPositions[ZAxisTarget.Safe])) {
    return unavailable(
      "InterlockNotSatisfied",
      "X may move only when Z is at Safe target.",
    );
  }
  const target = numberValue(payload?.target);
  if (target === XAxisTarget.None || !isEnumValue(XAxisTarget, target)) {
    return unavailable("InvalidPayload", "X axis target is invalid.");
  }
  moveXAxisTo(model, target, numberValue(payload?.velocityMmPerSecond));
  return available();
};

const executeXAxisPositionMove = (
  model: MachineModel,
  payload: StructureRecord | undefined,
): Availability => {
  if (!atPosition(model.motion.zAxis, zAxisTargetPositions[ZAxisTarget.Safe])) {
    return unavailable(
      "InterlockNotSatisfied",
      "X may move only when Z is at Safe target.",
    );
  }
  const position = numberValue(payload?.targetPositionMm);
  if (position < 0 || position > 700) {
    return unavailable(
      "InvalidPayload",
      "X axis raw position must be between 0 and 700 mm.",
    );
  }
  moveAxisToRaw(
    model.motion.xAxis,
    position,
    numberValue(payload?.velocityMmPerSecond),
  );
  model.motion.xAxis.currentTarget = xTargetForPosition(position);
  return available();
};

const executeZAxisTargetMove = (
  model: MachineModel,
  payload: StructureRecord | undefined,
): Availability => {
  const target = numberValue(payload?.target);
  if (target === ZAxisTarget.None || !isEnumValue(ZAxisTarget, target)) {
    return unavailable("InvalidPayload", "Z axis target is invalid.");
  }
  moveZAxisTo(model, target, numberValue(payload?.velocityMmPerSecond));
  return available();
};

const executeZAxisPositionMove = (
  model: MachineModel,
  payload: StructureRecord | undefined,
): Availability => {
  const position = numberValue(payload?.targetPositionMm);
  if (position < -120 || position > 40) {
    return unavailable(
      "InvalidPayload",
      "Z axis raw position must be between -120 and 40 mm.",
    );
  }
  moveAxisToRaw(
    model.motion.zAxis,
    position,
    numberValue(payload?.velocityMmPerSecond),
  );
  model.motion.zAxis.currentTarget = zTargetForPosition(position);
  return available();
};

const executeJog = (
  model: MachineModel,
  axis: AxisModel,
  payload: StructureRecord | undefined,
  direction: 1 | -1,
  isXAxis: boolean,
): Availability => {
  if (
    isXAxis &&
    !atPosition(model.motion.zAxis, zAxisTargetPositions[ZAxisTarget.Safe])
  ) {
    return unavailable(
      "InterlockNotSatisfied",
      "X may move only when Z is at Safe target.",
    );
  }
  const delta =
    ((numberValue(payload?.velocityMmPerSecond) *
      numberValue(payload?.maxDurationMs)) /
      1_000) *
    direction;
  const next = axis.actualPositionMm + delta;
  if (isXAxis && (next < 0 || next > 700)) {
    return unavailable(
      "InterlockNotSatisfied",
      "X jog would exceed axis travel.",
    );
  }
  if (!isXAxis && (next < -120 || next > 40)) {
    return unavailable(
      "InterlockNotSatisfied",
      "Z jog would exceed axis travel.",
    );
  }
  moveAxisToRaw(axis, next, numberValue(payload?.velocityMmPerSecond));
  axis.currentTarget = isXAxis
    ? xTargetForPosition(next)
    : zTargetForPosition(next);
  return available();
};

const primePump = (model: MachineModel): Availability => {
  if (tankEmpty(model)) {
    return unavailable(
      "InterlockNotSatisfied",
      "Pump cannot prime while the tank is empty.",
    );
  }
  if (model.filling.nozzleValveState !== NozzleValveState.Closed) {
    return unavailable(
      "InterlockNotSatisfied",
      "Pump priming requires the nozzle valve to be closed.",
    );
  }
  model.filling.pumpState = PumpState.Priming;
  model.filling.pumpState = PumpState.Stopped;
  return available();
};

const clearActuatorFault = (
  model: MachineModel,
  actuator: number,
): Availability => {
  switch (actuator) {
    case ActuatorId.XAxis:
      model.motion.xAxis.faultCode = "";
      model.diagnostics.faults.motion.xAxisPositionError = false;
      model.motion.xAxis.state = model.motion.xAxis.enabled
        ? AxisState.Standstill
        : AxisState.Disabled;
      break;
    case ActuatorId.ZAxis:
      model.motion.zAxis.faultCode = "";
      model.diagnostics.faults.motion.zAxisPositionError = false;
      model.motion.zAxis.state = model.motion.zAxis.enabled
        ? AxisState.Standstill
        : AxisState.Disabled;
      break;
    case ActuatorId.Clamp:
      model.partHandling.clampFaultCode = "";
      model.diagnostics.faults.partHandling.clampFailedToClose = false;
      model.partHandling.clampState = ClampState.Open;
      break;
    case ActuatorId.Pump:
      model.filling.pumpFaultCode = "";
      model.diagnostics.faults.filling.pumpFault = false;
      model.filling.pumpState = PumpState.Stopped;
      break;
    case ActuatorId.NozzleValve:
      model.filling.nozzleValveFaultCode = "";
      model.diagnostics.faults.filling.valveFault = false;
      model.filling.nozzleValveState = NozzleValveState.Closed;
      break;
    case ActuatorId.InspectionSensor:
      model.inspection.sensorFaultCode = "";
      model.diagnostics.faults.inspection.sensorFault = false;
      break;
    default:
      return unavailable("InvalidPayload", "Unsupported actuator.");
  }
  transitionIdleOrReady(model);
  return available();
};

const withAxisSelection = (
  model: MachineModel,
  payload: StructureRecord | undefined,
  run: (axisSelection: number) => void,
): Availability => {
  const axisSelection = numberValue(payload?.axisSelection);
  if (
    !isEnumValue(AxisSelection, axisSelection) ||
    axisSelection === AxisSelection.None
  ) {
    return unavailable("InvalidPayload", "Axis selection is invalid.");
  }
  run(axisSelection);
  transitionIdleOrReady(model);
  return available();
};

const setAxisEnabled = (
  axis: AxisModel,
  axisSelection: number,
  axisValue: number,
  enabled: boolean,
) => {
  if (axisSelection !== axisValue && axisSelection !== AxisSelection.Both)
    return;
  axis.enabled = enabled;
  axis.actualVelocityMmPerSecond = 0;
  axis.commandedVelocityMmPerSecond = 0;
  axis.state = enabled
    ? axis.homed
      ? AxisState.Standstill
      : AxisState.NotHomed
    : AxisState.Disabled;
};

const homeAxis = (axis: AxisModel, target: number, position: number) => {
  axis.enabled = true;
  axis.homed = true;
  axis.state = AxisState.Standstill;
  axis.actualPositionMm = position;
  axis.targetPositionMm = position;
  axis.actualVelocityMmPerSecond = 0;
  axis.commandedVelocityMmPerSecond = 0;
  axis.currentTarget = target;
  axis.faultCode = "";
};

const moveXAxisTo = (model: MachineModel, target: number, velocity: number) => {
  moveAxisToRaw(
    model.motion.xAxis,
    xAxisTargetPositions[target as keyof typeof xAxisTargetPositions],
    velocity,
  );
  model.motion.xAxis.currentTarget = target;
};

const moveZAxisTo = (model: MachineModel, target: number, velocity: number) => {
  moveAxisToRaw(
    model.motion.zAxis,
    zAxisTargetPositions[target as keyof typeof zAxisTargetPositions],
    velocity,
  );
  model.motion.zAxis.currentTarget = target;
};

const moveAxisToRaw = (axis: AxisModel, position: number, velocity: number) => {
  axis.targetPositionMm = position;
  axis.commandedVelocityMmPerSecond = velocity;
  axis.actualPositionMm = position;
  axis.actualVelocityMmPerSecond = 0;
  axis.state = axis.enabled ? AxisState.Standstill : AxisState.Disabled;
};

const runInspection = (model: MachineModel) => {
  const fillLevel =
    model.production.currentPartFillVolumeMl || model.inspection.fillLevelMl;
  const target = model.configuration.targetFillVolumeMl;
  const tolerance = model.configuration.fillToleranceMl;
  model.inspection.fillLevelMl = fillLevel;
  model.inspection.fillLevelOk =
    !model.diagnostics.faults.inspection.sensorFault &&
    (target === 0 || Math.abs(fillLevel - target) <= tolerance);
  model.inspection.result = model.inspection.fillLevelOk
    ? InspectionResult.Pass
    : InspectionResult.Fail;
  model.inspection.rejectReason = model.inspection.fillLevelOk
    ? RejectReason.None
    : fillLevel < target
      ? RejectReason.Underfilled
      : RejectReason.Overfilled;
};

const transitionIdleOrReady = (model: MachineModel) => {
  if (activeFaultCount(model) > 0) {
    model.machineState = MachineState.Faulted;
    model.cyclePhase = CyclePhase.None;
    return;
  }
  if (
    model.machineState === MachineState.Faulted ||
    model.machineState === MachineState.Aborted ||
    model.machineState === MachineState.SafetyStopped
  ) {
    model.cyclePhase = CyclePhase.None;
    return;
  }
  model.machineState = readyPreconditionsMet(model)
    ? MachineState.Ready
    : MachineState.Idle;
  if (model.machineState !== MachineState.Running) {
    model.cyclePhase = CyclePhase.None;
  }
};

const readyPreconditionsMet = (model: MachineModel) =>
  model.configurationValid &&
  model.motion.xAxis.homed &&
  model.motion.zAxis.homed &&
  safetyOk(model) &&
  activeFaultCount(model) === 0 &&
  !tankEmpty(model) &&
  model.operatingMode === OperatingMode.Automatic;

const resetBatchCounters = (model: MachineModel) => {
  model.production.targetCount = model.configuration.batchSize;
  model.production.startedCount = 0;
  model.production.completedCount = 0;
  model.production.goodCount = 0;
  model.production.rejectedCount = 0;
  model.production.currentPartIndex = 0;
  model.production.currentPartFillVolumeMl = 0;
  model.production.currentPartInspectionResult = InspectionResult.NotInspected;
  model.production.currentPartRejectReason = RejectReason.None;
  model.production.lastCycleTimeMs = 0;
  model.production.averageCycleTimeMs = 0;
  model.production.batchElapsedTimeMs = 0;
  model.production.batchStartedAt = null;
};

const appendObservedCommand = (
  model: MachineModel,
  submit: GlobalCommandSubmitRequest,
) => {
  if (model.status.entries.length >= model.status.capacity) {
    const evictIndex = model.status.entries.findIndex((entry) =>
      isTerminalCommandState(entry.state),
    );
    if (evictIndex === -1) return undefined;
    model.status.entries.splice(evictIndex, 1);
    bumpStatusRevision(model);
  }

  const now = new Date();
  const entry: CommandStatusEntry = {
    sequence: model.status.nextSequence,
    commandId: submit.commandId,
    commandKind: submit.commandKind,
    clientId: submit.clientId,
    state: CommandState.Observed,
    statusCode: "Observed",
    statusMessage: "Command request observed.",
    observedAt: now,
    updatedAt: now,
  };
  model.status.nextSequence += 1;
  model.status.entries.push(entry);
  bumpStatusRevision(model);
  return entry;
};

const updateCommandStatusEntry = (
  model: MachineModel,
  entry: CommandStatusEntry,
  update: {
    readonly state: number;
    readonly code: string;
    readonly message: string;
  },
) => {
  entry.state = update.state;
  entry.statusCode = update.code;
  entry.statusMessage = update.message;
  entry.updatedAt = new Date();
  bumpStatusRevision(model);
};

const hasRetainedCommandId = (model: MachineModel, commandId: string) =>
  model.status.entries.some((entry) => entry.commandId === commandId);

const isTerminalCommandState = (state: number) =>
  state === CommandState.Completed ||
  state === CommandState.Rejected ||
  state === CommandState.Failed ||
  state === CommandState.Cancelled ||
  state === CommandState.Superseded;

const finishCommand = (
  model: MachineModel,
  entry: CommandStatusEntry,
  result: {
    readonly state: number;
    readonly code: string;
    readonly message: string;
  },
) => {
  updateCommandStatusEntry(model, entry, {
    state: result.state,
    code: result.code,
    message: result.message,
  });
};

const bumpStatusRevision = (model: MachineModel) => {
  model.status.revision += 1;
};

const bumpTelemetryRevision = (model: MachineModel) => {
  model.telemetryRevision += 1;
};

const tickModel = (model: MachineModel, now: number) => {
  const elapsedMs = Math.max(0, now - model.lastTickAt) * model.simulationSpeed;
  model.lastTickAt = now;
  let changed = false;
  if (model.machineState === MachineState.Running) {
    model.production.batchElapsedTimeMs += elapsedMs;
    changed = elapsedMs > 0;
  }
  if (tankEmpty(model) && model.machineState === MachineState.Running) {
    model.diagnostics.faults.filling.tankEmpty = true;
    model.machineState = MachineState.Faulted;
    model.filling.pumpState = PumpState.Stopped;
    model.filling.nozzleValveState = NozzleValveState.Closed;
    changed = true;
  }
  if (changed) bumpTelemetryRevision(model);
};

const defaultPayload = (payloadTypeName: PayloadTypeName): StructureRecord => {
  switch (payloadTypeName) {
    case "MachineSetModePayload":
      return { commandId: "", targetMode: OperatingMode.None };
    case "MachineConfigurePayload":
      return { commandId: "", configuration: defaultRunConfiguration() };
    case "MoveXAxisToTargetPayload":
      return {
        commandId: "",
        target: XAxisTarget.None,
        velocityMmPerSecond: 0,
      };
    case "MoveZAxisToTargetPayload":
      return {
        commandId: "",
        target: ZAxisTarget.None,
        velocityMmPerSecond: 0,
      };
    case "MoveAxisToPositionPayload":
      return { commandId: "", targetPositionMm: 0, velocityMmPerSecond: 0 };
    case "JogPayload":
      return { commandId: "", velocityMmPerSecond: 0, maxDurationMs: 0 };
    case "ClearActuatorFaultPayload":
      return { commandId: "", actuator: ActuatorId.None };
    case "AxisSelectionPayload":
      return { commandId: "", axisSelection: AxisSelection.None };
  }
};

const normalizePayload = (
  payloadTypeName: PayloadTypeName,
  value: StructureRecord,
): StructureRecord => ({
  ...defaultPayload(payloadTypeName),
  ...value,
});

const normalizeSubmitRequest = (
  value: StructureRecord,
): GlobalCommandSubmitRequest => ({
  commandId: stringValue(value.commandId),
  commandKind: numberValue(value.commandKind),
  clientId: stringValue(value.clientId),
});

const normalizeRunConfiguration = (
  value: StructureRecord,
): RunConfiguration => ({
  productName: stringValue(value.productName),
  targetFillVolumeMl: numberValue(value.targetFillVolumeMl),
  fillToleranceMl: numberValue(value.fillToleranceMl),
  pumpRateMlPerSecond: numberValue(value.pumpRateMlPerSecond),
  batchSize: Math.trunc(numberValue(value.batchSize)),
  xAxisSpeedMmPerSecond: numberValue(value.xAxisSpeedMmPerSecond),
  zAxisSpeedMmPerSecond: numberValue(value.zAxisSpeedMmPerSecond),
});

const isDefaultSubmit = (submit: GlobalCommandSubmitRequest) =>
  submit.commandId === "" &&
  submit.commandKind === GlobalCommandKind.None &&
  submit.clientId === "";

const safetyOk = (model: MachineModel) =>
  model.safety.emergencyStopState === EmergencyStopState.Released &&
  model.safety.guardDoorState === GuardDoorState.Closed &&
  model.safety.safetyCircuitState === SafetyCircuitState.Ok;

const allAxesStopped = (model: MachineModel) =>
  axisStopped(model.motion.xAxis) && axisStopped(model.motion.zAxis);

const axisStopped = (axis: AxisModel) =>
  axis.state !== AxisState.Moving &&
  axis.state !== AxisState.Homing &&
  axis.state !== AxisState.Stopping &&
  axis.actualVelocityMmPerSecond === 0;

const tankLow = (model: MachineModel) =>
  model.filling.tankLevelMl <= model.filling.lowLevelThresholdMl;

const tankEmpty = (model: MachineModel) =>
  model.filling.tankLevelMl <= model.filling.emptyThresholdMl ||
  model.diagnostics.faults.filling.tankEmpty;

const activeWarningCount = (model: MachineModel) =>
  [
    tankLow(model),
    model.diagnostics.warnings.fillLevelDrift,
    model.diagnostics.warnings.inspectionRejectRateHigh,
    model.diagnostics.warnings.maintenanceRecommended,
    model.diagnostics.warnings.cycleTimeHigh,
  ].filter(Boolean).length;

const activeFaultCount = (model: MachineModel) =>
  [
    model.diagnostics.faults.motion.xAxisNotHomed,
    model.diagnostics.faults.motion.zAxisNotHomed,
    model.diagnostics.faults.motion.xAxisPositionError,
    model.diagnostics.faults.motion.zAxisPositionError,
    model.diagnostics.faults.partHandling.clampFailedToClose,
    tankEmpty(model),
    model.diagnostics.faults.filling.pumpFault,
    model.diagnostics.faults.filling.valveFault,
    model.diagnostics.faults.inspection.sensorFault,
  ].filter(Boolean).length;

const highestSeverity = (model: MachineModel) => {
  if (model.machineState === MachineState.SafetyStopped)
    return DiagnosticSeverity.Safety;
  if (activeFaultCount(model) > 0) return DiagnosticSeverity.Fault;
  if (activeWarningCount(model) > 0) return DiagnosticSeverity.Warning;
  return DiagnosticSeverity.None;
};

const primaryFaultCode = (model: MachineModel) => {
  if (model.diagnostics.faults.motion.xAxisNotHomed) return "XAxisNotHomed";
  if (model.diagnostics.faults.motion.zAxisNotHomed) return "ZAxisNotHomed";
  if (model.diagnostics.faults.motion.xAxisPositionError)
    return "XAxisPositionError";
  if (model.diagnostics.faults.motion.zAxisPositionError)
    return "ZAxisPositionError";
  if (model.diagnostics.faults.partHandling.clampFailedToClose)
    return "ClampFailedToClose";
  if (tankEmpty(model)) return "TankEmpty";
  if (model.diagnostics.faults.filling.pumpFault) return "PumpFault";
  if (model.diagnostics.faults.filling.valveFault) return "ValveFault";
  if (model.diagnostics.faults.inspection.sensorFault) return "SensorFault";
  return "";
};

const atPosition = (axis: AxisModel, position: number) =>
  Math.abs(axis.actualPositionMm - position) < 0.001;

const xTargetForPosition = (position: number) => {
  for (const [target, targetPosition] of Object.entries(xAxisTargetPositions)) {
    if (Math.abs(position - targetPosition) < 0.001) return Number(target);
  }
  return XAxisTarget.None;
};

const zTargetForPosition = (position: number) => {
  for (const [target, targetPosition] of Object.entries(zAxisTargetPositions)) {
    if (Math.abs(position - targetPosition) < 0.001) return Number(target);
  }
  return ZAxisTarget.None;
};

const available = (): Availability => ({
  available: true,
  reasonCode: "",
  message: "",
});

const unavailable = (reasonCode: string, message: string): Availability => ({
  available: false,
  reasonCode,
  message,
});

const isEnumValue = (enumObject: Record<string, number>, value: number) =>
  Object.values(enumObject).includes(value);

const structureRecord = (value: unknown): StructureRecord =>
  value && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !key.startsWith("_") && key !== "schema")
          .map(([key, item]) => [key, structureValue(item)]),
      )
    : {};

const structureValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(structureValue);
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (value && typeof value === "object") return structureRecord(value);
  return value;
};

const cloneRecord = (value: StructureRecord): StructureRecord =>
  structureRecord(value);

const commandStatusBufferRecord = (
  status: CommandStatus,
): StructureRecord => ({
  revision: status.revision,
  capacity: status.capacity,
  entries: status.entries.map((entry) => ({
    sequence: entry.sequence,
    commandId: entry.commandId,
    commandKind: entry.commandKind,
    clientId: entry.clientId,
    state: entry.state,
    statusCode: entry.statusCode,
    statusMessage: entry.statusMessage,
    observedAt: entry.observedAt,
    updatedAt: entry.updatedAt,
  })),
});

const stringValue = (value: unknown) =>
  typeof value === "string"
    ? value
    : value === undefined || value === null
      ? ""
      : String(value);

const numberValue = (value: unknown) => {
  const valueOf =
    value && typeof value === "object" && "value" in value
      ? (value as { readonly value: unknown }).value
      : value;
  const number = Number(valueOf);
  return Number.isFinite(number) ? number : 0;
};
