import { Schema } from "effect";

export const OperatingModeInput = Schema.Literals([
  "Automatic",
  "Manual",
  "Maintenance",
]);
export type OperatingModeInput = typeof OperatingModeInput.Type;

export const XAxisTargetInput = Schema.Literals([
  "Home",
  "Load",
  "Fill",
  "Inspect",
  "Unload",
]);
export type XAxisTargetInput = typeof XAxisTargetInput.Type;

export const ZAxisTargetInput = Schema.Literals([
  "Home",
  "Safe",
  "Fill",
  "Maintenance",
]);
export type ZAxisTargetInput = typeof ZAxisTargetInput.Type;

export const AxisSelectionInput = Schema.Literals(["XAxis", "ZAxis", "Both"]);
export type AxisSelectionInput = typeof AxisSelectionInput.Type;

export const ActuatorInput = Schema.Literals([
  "XAxis",
  "ZAxis",
  "Clamp",
  "Pump",
  "NozzleValve",
  "InspectionSensor",
]);
export type ActuatorInput = typeof ActuatorInput.Type;

const PositiveNumber = Schema.Number.check(Schema.isGreaterThan(0));
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));
const NonNegativeNumber = Schema.Number.check(Schema.isGreaterThanOrEqualTo(0));

export const RunConfigurationInput = Schema.Struct({
  productName: Schema.String.check(Schema.isMinLength(1)),
  targetFillVolumeMl: PositiveNumber,
  fillToleranceMl: NonNegativeNumber,
  pumpRateMlPerSecond: PositiveNumber,
  batchSize: PositiveInt,
  xAxisSpeedMmPerSecond: PositiveNumber,
  zAxisSpeedMmPerSecond: PositiveNumber,
});

export type RunConfigurationInput = typeof RunConfigurationInput.Type;

export const MoveXAxisToTargetInput = Schema.Struct({
  target: XAxisTargetInput,
  velocityMmPerSecond: PositiveNumber,
});
export type MoveXAxisToTargetInput = typeof MoveXAxisToTargetInput.Type;

export const MoveZAxisToTargetInput = Schema.Struct({
  target: ZAxisTargetInput,
  velocityMmPerSecond: PositiveNumber,
});
export type MoveZAxisToTargetInput = typeof MoveZAxisToTargetInput.Type;

export const MoveAxisToPositionInput = Schema.Struct({
  targetPositionMm: Schema.Number,
  velocityMmPerSecond: PositiveNumber,
});
export type MoveAxisToPositionInput = typeof MoveAxisToPositionInput.Type;

export const JogInput = Schema.Struct({
  velocityMmPerSecond: PositiveNumber,
  maxDurationMs: PositiveInt.check(Schema.isLessThanOrEqualTo(5_000)),
});
export type JogInput = typeof JogInput.Type;

export const ClearActuatorFaultInput = Schema.Struct({
  actuator: ActuatorInput,
});
export type ClearActuatorFaultInput = typeof ClearActuatorFaultInput.Type;

export const AxisSelectionCommandInput = Schema.Struct({
  axisSelection: AxisSelectionInput,
});
export type AxisSelectionCommandInput =
  typeof AxisSelectionCommandInput.Type;

export const DemoMachineCommand = Schema.Union([
  Schema.TaggedStruct("MachineSetMode", { targetMode: OperatingModeInput }),
  Schema.TaggedStruct("MachineConfigure", {
    runConfiguration: RunConfigurationInput,
  }),
  Schema.TaggedStruct("MachineHome", {}),
  Schema.TaggedStruct("MachineStart", {}),
  Schema.TaggedStruct("MachinePause", {}),
  Schema.TaggedStruct("MachineResume", {}),
  Schema.TaggedStruct("MachineAbort", {}),
  Schema.TaggedStruct("MachineReset", {}),
  Schema.TaggedStruct("MachineClearCompleted", {}),
  Schema.TaggedStruct("MachineAcknowledgeSafetyReset", {}),
  Schema.TaggedStruct("ManualHomeX", {}),
  Schema.TaggedStruct("ManualHomeZ", {}),
  Schema.TaggedStruct("ManualMoveXAxisToTarget", MoveXAxisToTargetInput.fields),
  Schema.TaggedStruct(
    "ManualMoveXAxisToPosition",
    MoveAxisToPositionInput.fields,
  ),
  Schema.TaggedStruct("ManualMoveZAxisToTarget", MoveZAxisToTargetInput.fields),
  Schema.TaggedStruct(
    "ManualMoveZAxisToPosition",
    MoveAxisToPositionInput.fields,
  ),
  Schema.TaggedStruct("ManualJogXPositive", JogInput.fields),
  Schema.TaggedStruct("ManualJogXNegative", JogInput.fields),
  Schema.TaggedStruct("ManualJogZPositive", JogInput.fields),
  Schema.TaggedStruct("ManualJogZNegative", JogInput.fields),
  Schema.TaggedStruct("ManualOpenClamp", {}),
  Schema.TaggedStruct("ManualCloseClamp", {}),
  Schema.TaggedStruct("ManualPrimePump", {}),
  Schema.TaggedStruct("ManualStopPump", {}),
  Schema.TaggedStruct("ManualOpenNozzleValve", {}),
  Schema.TaggedStruct("ManualCloseNozzleValve", {}),
  Schema.TaggedStruct("ManualTriggerInspectionOnce", {}),
  Schema.TaggedStruct(
    "ManualClearActuatorFault",
    ClearActuatorFaultInput.fields,
  ),
  Schema.TaggedStruct("MaintenanceRefillTank", {}),
  Schema.TaggedStruct("MaintenanceDrainTank", {}),
  Schema.TaggedStruct("MaintenancePrimePump", {}),
  Schema.TaggedStruct("MaintenanceCleanNozzle", {}),
  Schema.TaggedStruct("MaintenanceResetPumpFault", {}),
  Schema.TaggedStruct("MaintenanceResetValveFault", {}),
  Schema.TaggedStruct("MaintenanceCalibrateFillLevelSensor", {}),
  Schema.TaggedStruct("MaintenanceSimulateSensorCheck", {}),
  Schema.TaggedStruct("MaintenanceResetInspectionFault", {}),
  Schema.TaggedStruct(
    "MaintenanceMoveXAxisToTarget",
    MoveXAxisToTargetInput.fields,
  ),
  Schema.TaggedStruct(
    "MaintenanceMoveXAxisToPosition",
    MoveAxisToPositionInput.fields,
  ),
  Schema.TaggedStruct(
    "MaintenanceMoveZAxisToTarget",
    MoveZAxisToTargetInput.fields,
  ),
  Schema.TaggedStruct(
    "MaintenanceMoveZAxisToPosition",
    MoveAxisToPositionInput.fields,
  ),
  Schema.TaggedStruct("MaintenanceJogXPositive", JogInput.fields),
  Schema.TaggedStruct("MaintenanceJogXNegative", JogInput.fields),
  Schema.TaggedStruct("MaintenanceJogZPositive", JogInput.fields),
  Schema.TaggedStruct("MaintenanceJogZNegative", JogInput.fields),
  Schema.TaggedStruct("MaintenanceHomeAxes", AxisSelectionCommandInput.fields),
  Schema.TaggedStruct("MaintenanceEnableAxes", AxisSelectionCommandInput.fields),
  Schema.TaggedStruct(
    "MaintenanceDisableAxes",
    AxisSelectionCommandInput.fields,
  ),
  Schema.TaggedStruct(
    "MaintenanceClearAxisFault",
    AxisSelectionCommandInput.fields,
  ),
  Schema.TaggedStruct("MaintenanceOpenClamp", {}),
  Schema.TaggedStruct("MaintenanceCloseClamp", {}),
  Schema.TaggedStruct("MaintenanceClearClampFault", {}),
]);

export type DemoMachineCommand = typeof DemoMachineCommand.Type;
