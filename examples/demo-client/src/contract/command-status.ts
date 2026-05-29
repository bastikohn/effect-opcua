import type * as Enums from "../generated/enums.js";

export type CommandState =
  | "None"
  | "Observed"
  | "Accepted"
  | "Executing"
  | "Completed"
  | "Rejected"
  | "Failed"
  | "Unknown";

export type TerminalCommandState = "Completed" | "Rejected" | "Failed";

export type CommandKindName = keyof typeof Enums.GlobalCommandKind | "Unknown";

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
