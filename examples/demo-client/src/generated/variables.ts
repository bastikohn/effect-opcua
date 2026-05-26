import { Opcua } from "@effect-opcua/client";
import { Schema } from "effect";

import * as NodeIds from "./nodeIds.js";
import * as Structures from "./structures.js";

const numberVariable = <const Id extends string>(nodeId: Id) =>
  Opcua.variable({ nodeId, codec: Opcua.schema(Schema.Number) });

const booleanVariable = <const Id extends string>(nodeId: Id) =>
  Opcua.variable({ nodeId, codec: Opcua.schema(Schema.Boolean) });

const stringVariable = <const Id extends string>(nodeId: Id) =>
  Opcua.variable({ nodeId, codec: Opcua.schema(Schema.String) });

export const CommandsSubmitRequest = Opcua.variable({
  nodeId: NodeIds.Commands.SubmitRequest,
  codec: Structures.GlobalCommandSubmitRequest,
  access: "readWrite",
});

export const CommandsStatus = Opcua.variable({
  nodeId: NodeIds.Commands.Status,
  codec: Structures.CommandStatusBuffer,
});

export const TelemetryRevision = Opcua.variable({
  nodeId: NodeIds.Telemetry.Revision,
  codec: Opcua.dynamic(),
});

export const MachineSetModePayload = Opcua.variable({
  nodeId: NodeIds.Commands.Payloads.Machine.SetMode,
  codec: Structures.MachineSetModePayload,
  access: "readWrite",
});

export const MachineConfigurePayload = Opcua.variable({
  nodeId: NodeIds.Commands.Payloads.Machine.Configure,
  codec: Structures.MachineConfigurePayload,
  access: "readWrite",
});

export const MoveXAxisToTargetPayload = {
  Manual: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Manual.MoveXAxisToTarget,
    codec: Structures.MoveXAxisToTargetPayload,
    access: "readWrite",
  }),
  Maintenance: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.MoveXAxisToTarget,
    codec: Structures.MoveXAxisToTargetPayload,
    access: "readWrite",
  }),
} as const;

export const MoveXAxisToPositionPayload = {
  Manual: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Manual.MoveXAxisToPosition,
    codec: Structures.MoveAxisToPositionPayload,
    access: "readWrite",
  }),
  Maintenance: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.MoveXAxisToPosition,
    codec: Structures.MoveAxisToPositionPayload,
    access: "readWrite",
  }),
} as const;

export const MoveZAxisToTargetPayload = {
  Manual: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Manual.MoveZAxisToTarget,
    codec: Structures.MoveZAxisToTargetPayload,
    access: "readWrite",
  }),
  Maintenance: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.MoveZAxisToTarget,
    codec: Structures.MoveZAxisToTargetPayload,
    access: "readWrite",
  }),
} as const;

export const MoveZAxisToPositionPayload = {
  Manual: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Manual.MoveZAxisToPosition,
    codec: Structures.MoveAxisToPositionPayload,
    access: "readWrite",
  }),
  Maintenance: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.MoveZAxisToPosition,
    codec: Structures.MoveAxisToPositionPayload,
    access: "readWrite",
  }),
} as const;

export const JogPayload = {
  ManualXPositive: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Manual.JogXPositive,
    codec: Structures.JogPayload,
    access: "readWrite",
  }),
  ManualXNegative: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Manual.JogXNegative,
    codec: Structures.JogPayload,
    access: "readWrite",
  }),
  ManualZPositive: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Manual.JogZPositive,
    codec: Structures.JogPayload,
    access: "readWrite",
  }),
  ManualZNegative: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Manual.JogZNegative,
    codec: Structures.JogPayload,
    access: "readWrite",
  }),
  MaintenanceXPositive: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.JogXPositive,
    codec: Structures.JogPayload,
    access: "readWrite",
  }),
  MaintenanceXNegative: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.JogXNegative,
    codec: Structures.JogPayload,
    access: "readWrite",
  }),
  MaintenanceZPositive: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.JogZPositive,
    codec: Structures.JogPayload,
    access: "readWrite",
  }),
  MaintenanceZNegative: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.JogZNegative,
    codec: Structures.JogPayload,
    access: "readWrite",
  }),
} as const;

export const ManualClearActuatorFaultPayload = Opcua.variable({
  nodeId: NodeIds.Commands.Payloads.Manual.ClearActuatorFault,
  codec: Structures.ClearActuatorFaultPayload,
  access: "readWrite",
});

export const AxisSelectionPayload = {
  HomeAxes: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.HomeAxes,
    codec: Structures.AxisSelectionPayload,
    access: "readWrite",
  }),
  EnableAxes: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.EnableAxes,
    codec: Structures.AxisSelectionPayload,
    access: "readWrite",
  }),
  DisableAxes: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.DisableAxes,
    codec: Structures.AxisSelectionPayload,
    access: "readWrite",
  }),
  ClearAxisFault: Opcua.variable({
    nodeId: NodeIds.Commands.Payloads.Maintenance.ClearAxisFault,
    codec: Structures.AxisSelectionPayload,
    access: "readWrite",
  }),
} as const;

export const SnapshotVariables = {
  machineState: numberVariable(NodeIds.State.MachineState),
  operatingMode: numberVariable(NodeIds.State.OperatingMode),
  cyclePhase: numberVariable(NodeIds.State.CyclePhase),
  ready: booleanVariable(NodeIds.State.Ready),
  busy: booleanVariable(NodeIds.State.Busy),
  configurationValid: booleanVariable(NodeIds.State.ConfigurationValid),
  homed: booleanVariable(NodeIds.State.Homed),
  safetyOk: booleanVariable(NodeIds.State.SafetyOk),
  faultActive: booleanVariable(NodeIds.State.FaultActive),
  warningActive: booleanVariable(NodeIds.State.WarningActive),
  productName: stringVariable(NodeIds.State.Configuration.ProductName),
  targetFillVolumeMl: numberVariable(
    NodeIds.State.Configuration.TargetFillVolumeMl,
  ),
  fillToleranceMl: numberVariable(NodeIds.State.Configuration.FillToleranceMl),
  pumpRateMlPerSecond: numberVariable(
    NodeIds.State.Configuration.PumpRateMlPerSecond,
  ),
  batchSize: numberVariable(NodeIds.State.Configuration.BatchSize),
  xAxisSpeedMmPerSecond: numberVariable(
    NodeIds.State.Configuration.XAxisSpeedMmPerSecond,
  ),
  zAxisSpeedMmPerSecond: numberVariable(
    NodeIds.State.Configuration.ZAxisSpeedMmPerSecond,
  ),
  xAxisState: numberVariable(NodeIds.Motion.XAxis.State),
  xAxisActualPositionMm: numberVariable(NodeIds.Motion.XAxis.ActualPositionMm),
  xAxisTargetPositionMm: numberVariable(NodeIds.Motion.XAxis.TargetPositionMm),
  xAxisHomed: booleanVariable(NodeIds.Motion.XAxis.Homed),
  xAxisEnabled: booleanVariable(NodeIds.Motion.XAxis.Enabled),
  xAxisFaultCode: stringVariable(NodeIds.Motion.XAxis.FaultCode),
  xAxisCurrentTarget: numberVariable(NodeIds.Motion.XAxis.CurrentTarget),
  zAxisState: numberVariable(NodeIds.Motion.ZAxis.State),
  zAxisActualPositionMm: numberVariable(NodeIds.Motion.ZAxis.ActualPositionMm),
  zAxisTargetPositionMm: numberVariable(NodeIds.Motion.ZAxis.TargetPositionMm),
  zAxisHomed: booleanVariable(NodeIds.Motion.ZAxis.Homed),
  zAxisEnabled: booleanVariable(NodeIds.Motion.ZAxis.Enabled),
  zAxisFaultCode: stringVariable(NodeIds.Motion.ZAxis.FaultCode),
  zAxisCurrentTarget: numberVariable(NodeIds.Motion.ZAxis.CurrentTarget),
  tankLevelMl: numberVariable(NodeIds.Filling.Tank.LevelMl),
  tankCapacityMl: numberVariable(NodeIds.Filling.Tank.CapacityMl),
  tankLow: booleanVariable(NodeIds.Filling.Tank.LowLevel),
  tankEmpty: booleanVariable(NodeIds.Filling.Tank.Empty),
  pumpState: numberVariable(NodeIds.Filling.Pump.State),
  pumpRunning: booleanVariable(NodeIds.Filling.Pump.Running),
  pumpFaultCode: stringVariable(NodeIds.Filling.Pump.FaultCode),
  nozzleValveState: numberVariable(NodeIds.Filling.NozzleValve.State),
  nozzleValveOpen: booleanVariable(NodeIds.Filling.NozzleValve.Open),
  nozzleValveFaultCode: stringVariable(NodeIds.Filling.NozzleValve.FaultCode),
  clampState: numberVariable(NodeIds.PartHandling.Clamp.State),
  clampOpen: booleanVariable(NodeIds.PartHandling.Clamp.Open),
  clampClosed: booleanVariable(NodeIds.PartHandling.Clamp.Closed),
  clampFaultCode: stringVariable(NodeIds.PartHandling.Clamp.FaultCode),
  partPresent: booleanVariable(NodeIds.PartHandling.PartPresent),
  inspectionFillLevelMl: numberVariable(NodeIds.Inspection.FillLevelMl),
  inspectionFillLevelOk: booleanVariable(NodeIds.Inspection.FillLevelOk),
  inspectionResult: numberVariable(NodeIds.Inspection.Result),
  rejectReason: numberVariable(NodeIds.Inspection.RejectReason),
  inspectionSensorFaultCode: stringVariable(NodeIds.Inspection.SensorFaultCode),
  batchTargetCount: numberVariable(NodeIds.Production.Batch.TargetCount),
  batchStartedCount: numberVariable(NodeIds.Production.Batch.StartedCount),
  batchCompletedCount: numberVariable(NodeIds.Production.Batch.CompletedCount),
  batchGoodCount: numberVariable(NodeIds.Production.Batch.GoodCount),
  batchRejectedCount: numberVariable(NodeIds.Production.Batch.RejectedCount),
  batchRemainingCount: numberVariable(NodeIds.Production.Batch.RemainingCount),
  activeWarningCount: numberVariable(
    NodeIds.Diagnostics.Summary.ActiveWarningCount,
  ),
  activeFaultCount: numberVariable(NodeIds.Diagnostics.Summary.ActiveFaultCount),
  highestSeverity: numberVariable(NodeIds.Diagnostics.Summary.HighestSeverity),
  primaryFaultCode: stringVariable(NodeIds.Diagnostics.Summary.PrimaryFaultCode),
  telemetryRevision: TelemetryRevision,
} as const;

export const Variables = {
  Commands: {
    SubmitRequest: CommandsSubmitRequest,
    Status: CommandsStatus,
    Payloads: {
      Machine: {
        SetMode: MachineSetModePayload,
        Configure: MachineConfigurePayload,
      },
      Manual: {
        MoveXAxisToTarget: MoveXAxisToTargetPayload.Manual,
        MoveXAxisToPosition: MoveXAxisToPositionPayload.Manual,
        MoveZAxisToTarget: MoveZAxisToTargetPayload.Manual,
        MoveZAxisToPosition: MoveZAxisToPositionPayload.Manual,
        ClearActuatorFault: ManualClearActuatorFaultPayload,
      },
      Maintenance: {
        MoveXAxisToTarget: MoveXAxisToTargetPayload.Maintenance,
        MoveXAxisToPosition: MoveXAxisToPositionPayload.Maintenance,
        MoveZAxisToTarget: MoveZAxisToTargetPayload.Maintenance,
        MoveZAxisToPosition: MoveZAxisToPositionPayload.Maintenance,
        HomeAxes: AxisSelectionPayload.HomeAxes,
        EnableAxes: AxisSelectionPayload.EnableAxes,
        DisableAxes: AxisSelectionPayload.DisableAxes,
        ClearAxisFault: AxisSelectionPayload.ClearAxisFault,
      },
    },
  },
  Telemetry: {
    Revision: TelemetryRevision,
  },
} as const;
