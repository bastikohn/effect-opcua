import * as Enums from "../generated/enums.js";
import type { DemoMachineSnapshot } from "../contract/telemetry.js";
import * as Variables from "../generated/variables.js";

export const snapshotVariables = {
  telemetryRevision: Variables.Telemetry.Revision,
  machineState: Variables.State.MachineState,
  operatingMode: Variables.State.OperatingMode,
  cyclePhase: Variables.State.CyclePhase,
  ready: Variables.State.Ready,
  busy: Variables.State.Busy,
  configurationValid: Variables.State.ConfigurationValid,
  homed: Variables.State.Homed,
  safetyOk: Variables.State.SafetyOk,
  faultActive: Variables.State.FaultActive,
  warningActive: Variables.State.WarningActive,
  productName: Variables.State.Configuration.ProductName,
  targetFillVolumeMl: Variables.State.Configuration.TargetFillVolumeMl,
  fillToleranceMl: Variables.State.Configuration.FillToleranceMl,
  pumpRateMlPerSecond: Variables.State.Configuration.PumpRateMlPerSecond,
  batchSize: Variables.State.Configuration.BatchSize,
  xAxisSpeedMmPerSecond: Variables.State.Configuration.XAxisSpeedMmPerSecond,
  zAxisSpeedMmPerSecond: Variables.State.Configuration.ZAxisSpeedMmPerSecond,
  xAxisState: Variables.Motion.XAxis.State,
  xAxisActualPositionMm: Variables.Motion.XAxis.ActualPositionMm,
  xAxisTargetPositionMm: Variables.Motion.XAxis.TargetPositionMm,
  xAxisHomed: Variables.Motion.XAxis.Homed,
  xAxisEnabled: Variables.Motion.XAxis.Enabled,
  xAxisFaultCode: Variables.Motion.XAxis.FaultCode,
  xAxisCurrentTarget: Variables.Motion.XAxis.CurrentTarget,
  zAxisState: Variables.Motion.ZAxis.State,
  zAxisActualPositionMm: Variables.Motion.ZAxis.ActualPositionMm,
  zAxisTargetPositionMm: Variables.Motion.ZAxis.TargetPositionMm,
  zAxisHomed: Variables.Motion.ZAxis.Homed,
  zAxisEnabled: Variables.Motion.ZAxis.Enabled,
  zAxisFaultCode: Variables.Motion.ZAxis.FaultCode,
  zAxisCurrentTarget: Variables.Motion.ZAxis.CurrentTarget,
  tankLevelMl: Variables.Filling.Tank.LevelMl,
  tankCapacityMl: Variables.Filling.Tank.CapacityMl,
  tankLow: Variables.Filling.Tank.LowLevel,
  tankEmpty: Variables.Filling.Tank.Empty,
  pumpState: Variables.Filling.Pump.State,
  pumpRunning: Variables.Filling.Pump.Running,
  pumpFaultCode: Variables.Filling.Pump.FaultCode,
  nozzleValveState: Variables.Filling.NozzleValve.State,
  nozzleValveOpen: Variables.Filling.NozzleValve.Open,
  nozzleValveFaultCode: Variables.Filling.NozzleValve.FaultCode,
  clampState: Variables.PartHandling.Clamp.State,
  clampOpen: Variables.PartHandling.Clamp.Open,
  clampClosed: Variables.PartHandling.Clamp.Closed,
  clampFaultCode: Variables.PartHandling.Clamp.FaultCode,
  partPresent: Variables.PartHandling.PartPresent,
  inspectionFillLevelMl: Variables.Inspection.FillLevelMl,
  inspectionFillLevelOk: Variables.Inspection.FillLevelOk,
  inspectionResult: Variables.Inspection.Result,
  rejectReason: Variables.Inspection.RejectReason,
  inspectionSensorFaultCode: Variables.Inspection.SensorFaultCode,
  batchTargetCount: Variables.Production.Batch.TargetCount,
  batchStartedCount: Variables.Production.Batch.StartedCount,
  batchCompletedCount: Variables.Production.Batch.CompletedCount,
  batchGoodCount: Variables.Production.Batch.GoodCount,
  batchRejectedCount: Variables.Production.Batch.RejectedCount,
  batchRemainingCount: Variables.Production.Batch.RemainingCount,
  activeWarningCount: Variables.Diagnostics.Summary.ActiveWarningCount,
  activeFaultCount: Variables.Diagnostics.Summary.ActiveFaultCount,
  highestSeverity: Variables.Diagnostics.Summary.HighestSeverity,
  primaryFaultCode: Variables.Diagnostics.Summary.PrimaryFaultCode,
} as const;

export type TelemetryStaging = {
  readonly [Key in keyof typeof snapshotVariables]: unknown;
};

const names = {
  machineState: reverseEnum(Enums.MachineState),
  operatingMode: reverseEnum(Enums.OperatingMode),
  cyclePhase: reverseEnum(Enums.CyclePhase),
  axisState: reverseEnum(Enums.AxisState),
  xAxisTarget: reverseEnum(Enums.XAxisTarget),
  zAxisTarget: reverseEnum(Enums.ZAxisTarget),
  pumpState: reverseEnum(Enums.PumpState),
  nozzleValveState: reverseEnum(Enums.NozzleValveState),
  clampState: reverseEnum(Enums.ClampState),
  inspectionResult: reverseEnum(Enums.InspectionResult),
  rejectReason: reverseEnum(Enums.RejectReason),
  diagnosticSeverity: reverseEnum(Enums.DiagnosticSeverity),
};

export const makeSnapshot = (
  staging: TelemetryStaging,
): DemoMachineSnapshot => ({
  revision: bigintValue(staging.telemetryRevision),
  machine: {
    state: enumName(names.machineState, staging.machineState),
    stateValue: numberValue(staging.machineState),
    operatingMode: enumName(names.operatingMode, staging.operatingMode),
    operatingModeValue: numberValue(staging.operatingMode),
    cyclePhase: enumName(names.cyclePhase, staging.cyclePhase),
    cyclePhaseValue: numberValue(staging.cyclePhase),
    ready: booleanValue(staging.ready),
    busy: booleanValue(staging.busy),
    configurationValid: booleanValue(staging.configurationValid),
    homed: booleanValue(staging.homed),
    safetyOk: booleanValue(staging.safetyOk),
    faultActive: booleanValue(staging.faultActive),
    warningActive: booleanValue(staging.warningActive),
  },
  configuration: {
    productName: stringValue(staging.productName),
    targetFillVolumeMl: numberValue(staging.targetFillVolumeMl),
    fillToleranceMl: numberValue(staging.fillToleranceMl),
    pumpRateMlPerSecond: numberValue(staging.pumpRateMlPerSecond),
    batchSize: numberValue(staging.batchSize),
    xAxisSpeedMmPerSecond: numberValue(staging.xAxisSpeedMmPerSecond),
    zAxisSpeedMmPerSecond: numberValue(staging.zAxisSpeedMmPerSecond),
  },
  motion: {
    xAxis: {
      state: enumName(names.axisState, staging.xAxisState),
      stateValue: numberValue(staging.xAxisState),
      actualPositionMm: numberValue(staging.xAxisActualPositionMm),
      targetPositionMm: numberValue(staging.xAxisTargetPositionMm),
      homed: booleanValue(staging.xAxisHomed),
      enabled: booleanValue(staging.xAxisEnabled),
      faultCode: stringValue(staging.xAxisFaultCode),
      currentTarget: enumName(names.xAxisTarget, staging.xAxisCurrentTarget),
      currentTargetValue: numberValue(staging.xAxisCurrentTarget),
    },
    zAxis: {
      state: enumName(names.axisState, staging.zAxisState),
      stateValue: numberValue(staging.zAxisState),
      actualPositionMm: numberValue(staging.zAxisActualPositionMm),
      targetPositionMm: numberValue(staging.zAxisTargetPositionMm),
      homed: booleanValue(staging.zAxisHomed),
      enabled: booleanValue(staging.zAxisEnabled),
      faultCode: stringValue(staging.zAxisFaultCode),
      currentTarget: enumName(names.zAxisTarget, staging.zAxisCurrentTarget),
      currentTargetValue: numberValue(staging.zAxisCurrentTarget),
    },
  },
  filling: {
    tankLevelMl: numberValue(staging.tankLevelMl),
    tankCapacityMl: numberValue(staging.tankCapacityMl),
    tankLow: booleanValue(staging.tankLow),
    tankEmpty: booleanValue(staging.tankEmpty),
    pumpState: enumName(names.pumpState, staging.pumpState),
    pumpStateValue: numberValue(staging.pumpState),
    pumpRunning: booleanValue(staging.pumpRunning),
    pumpFaultCode: stringValue(staging.pumpFaultCode),
    nozzleValveState: enumName(
      names.nozzleValveState,
      staging.nozzleValveState,
    ),
    nozzleValveStateValue: numberValue(staging.nozzleValveState),
    nozzleValveOpen: booleanValue(staging.nozzleValveOpen),
    nozzleValveFaultCode: stringValue(staging.nozzleValveFaultCode),
  },
  partHandling: {
    clampState: enumName(names.clampState, staging.clampState),
    clampStateValue: numberValue(staging.clampState),
    clampOpen: booleanValue(staging.clampOpen),
    clampClosed: booleanValue(staging.clampClosed),
    clampFaultCode: stringValue(staging.clampFaultCode),
    partPresent: booleanValue(staging.partPresent),
  },
  inspection: {
    fillLevelMl: numberValue(staging.inspectionFillLevelMl),
    fillLevelOk: booleanValue(staging.inspectionFillLevelOk),
    result: enumName(names.inspectionResult, staging.inspectionResult),
    resultValue: numberValue(staging.inspectionResult),
    rejectReason: enumName(names.rejectReason, staging.rejectReason),
    rejectReasonValue: numberValue(staging.rejectReason),
    sensorFaultCode: stringValue(staging.inspectionSensorFaultCode),
  },
  production: {
    targetCount: numberValue(staging.batchTargetCount),
    startedCount: numberValue(staging.batchStartedCount),
    completedCount: numberValue(staging.batchCompletedCount),
    goodCount: numberValue(staging.batchGoodCount),
    rejectedCount: numberValue(staging.batchRejectedCount),
    remainingCount: numberValue(staging.batchRemainingCount),
  },
  diagnostics: {
    activeWarningCount: numberValue(staging.activeWarningCount),
    activeFaultCount: numberValue(staging.activeFaultCount),
    highestSeverity: enumName(
      names.diagnosticSeverity,
      staging.highestSeverity,
    ),
    highestSeverityValue: numberValue(staging.highestSeverity),
    primaryFaultCode: stringValue(staging.primaryFaultCode),
  },
});

export const numberValue = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (
    value &&
    typeof value === "object" &&
    "_tag" in value &&
    ((value as { readonly _tag: unknown })._tag === "UInt64" ||
      (value as { readonly _tag: unknown })._tag === "Int64")
  ) {
    return Number((value as unknown as { readonly text: string }).text);
  }
  if (Array.isArray(value) && value.length === 2) {
    return numberValue(value[0]) * 2 ** 32 + numberValue(value[1]);
  }
  return Number(value);
};

export const bigintValue = (value: unknown): bigint => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.max(0, Math.trunc(value)));
  if (
    value &&
    typeof value === "object" &&
    "_tag" in value &&
    ((value as { readonly _tag: unknown })._tag === "UInt64" ||
      (value as { readonly _tag: unknown })._tag === "Int64")
  ) {
    return BigInt((value as unknown as { readonly text: string }).text);
  }
  if (Array.isArray(value) && value.length === 2) {
    return (
      BigInt(numberValue(value[0])) * 2n ** 32n + BigInt(numberValue(value[1]))
    );
  }
  return BigInt(Math.max(0, Math.trunc(Number(value))));
};

const booleanValue = (value: unknown): boolean => value === true;
const stringValue = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);

const enumName = (map: ReadonlyMap<number, string>, value: unknown) =>
  map.get(numberValue(value)) ?? "Unknown";

function reverseEnum(values: Record<string, number>) {
  return new Map(Object.entries(values).map(([key, value]) => [value, key]));
}
