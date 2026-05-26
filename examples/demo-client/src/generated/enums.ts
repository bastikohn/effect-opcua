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

export type GlobalCommandKindValue =
  (typeof GlobalCommandKind)[keyof typeof GlobalCommandKind];

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

export type CommandStateValue =
  (typeof CommandState)[keyof typeof CommandState];

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

export const DiagnosticSeverity = {
  None: 0,
  Warning: 1,
  Fault: 2,
  Safety: 3,
} as const;
