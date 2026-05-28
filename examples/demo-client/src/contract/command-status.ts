export type CommandState =
  | "None"
  | "Observed"
  | "Accepted"
  | "Executing"
  | "Completed"
  | "Rejected"
  | "Failed"
  | "Unknown";

export type TerminalCommandState =
  | "Completed"
  | "Rejected"
  | "Failed";

export type CommandKindName =
  | "None"
  | "Machine_SetMode"
  | "Machine_Configure"
  | "Machine_Home"
  | "Machine_Start"
  | "Machine_Pause"
  | "Machine_Resume"
  | "Machine_Abort"
  | "Machine_Reset"
  | "Machine_ClearCompleted"
  | "Machine_AcknowledgeSafetyReset"
  | "Manual_HomeX"
  | "Manual_HomeZ"
  | "Manual_MoveXAxisToTarget"
  | "Manual_MoveXAxisToPosition"
  | "Manual_MoveZAxisToTarget"
  | "Manual_MoveZAxisToPosition"
  | "Manual_JogXPositive"
  | "Manual_JogXNegative"
  | "Manual_JogZPositive"
  | "Manual_JogZNegative"
  | "Manual_OpenClamp"
  | "Manual_CloseClamp"
  | "Manual_PrimePump"
  | "Manual_StopPump"
  | "Manual_OpenNozzleValve"
  | "Manual_CloseNozzleValve"
  | "Manual_TriggerInspectionOnce"
  | "Manual_ClearActuatorFault"
  | "Maintenance_RefillTank"
  | "Maintenance_DrainTank"
  | "Maintenance_PrimePump"
  | "Maintenance_CleanNozzle"
  | "Maintenance_ResetPumpFault"
  | "Maintenance_ResetValveFault"
  | "Maintenance_CalibrateFillLevelSensor"
  | "Maintenance_SimulateSensorCheck"
  | "Maintenance_ResetInspectionFault"
  | "Maintenance_MoveXAxisToTarget"
  | "Maintenance_MoveXAxisToPosition"
  | "Maintenance_MoveZAxisToTarget"
  | "Maintenance_MoveZAxisToPosition"
  | "Maintenance_JogXPositive"
  | "Maintenance_JogXNegative"
  | "Maintenance_JogZPositive"
  | "Maintenance_JogZNegative"
  | "Maintenance_HomeAxes"
  | "Maintenance_EnableAxes"
  | "Maintenance_DisableAxes"
  | "Maintenance_ClearAxisFault"
  | "Maintenance_OpenClamp"
  | "Maintenance_CloseClamp"
  | "Maintenance_ClearClampFault"
  | "Unknown";

export type CommandStatusEntry = {
  readonly sequence: bigint;
  readonly commandId: string;
  readonly commandKind: CommandKindName;
  readonly commandKindValue: number;
  readonly clientId: string;
  readonly state: CommandState;
  readonly stateValue: number;
  readonly statusCode: string;
  readonly statusMessage: string;
  readonly observedAt: Date;
  readonly updatedAt: Date;
};

export type CommandStatusBuffer = {
  readonly revision: bigint;
  readonly capacity: number;
  readonly entries: ReadonlyArray<CommandStatusEntry>;
};

export type TerminalCommandStatusEntry = CommandStatusEntry & {
  readonly state: TerminalCommandState;
};

export type CommandOutcome = TerminalCommandStatusEntry;

export const terminalCommandStates = new Set<CommandState>([
  "Completed",
  "Rejected",
  "Failed",
]);

export const isTerminalCommandStatusEntry = (
  entry: CommandStatusEntry,
): entry is TerminalCommandStatusEntry =>
  terminalCommandStates.has(entry.state);

export const isCommandCompleted = (outcome: CommandOutcome) =>
  outcome.state === "Completed";

export const isCommandRejected = (outcome: CommandOutcome) =>
  outcome.state === "Rejected";

export const isCommandFailed = (outcome: CommandOutcome) =>
  outcome.state === "Failed";
