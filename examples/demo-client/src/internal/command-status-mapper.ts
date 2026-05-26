import * as Enums from "../generated/enums.js";
import type {
  RawCommandStatusBuffer,
  RawCommandStatusEntry,
} from "../generated/structures.js";
import type {
  CommandKindName,
  CommandState,
  CommandStatusBuffer,
  CommandStatusEntry,
} from "../contract/command-status.js";

const commandKindNames = reverseEnum(Enums.GlobalCommandKind);
const commandStateNames = reverseEnum(Enums.CommandState);

export const mapCommandStatusBuffer = (
  raw: RawCommandStatusBuffer,
): CommandStatusBuffer => ({
  revision: raw.revision,
  capacity: raw.capacity,
  entries: raw.entries.map(mapCommandStatusEntry),
});

const mapCommandStatusEntry = (
  raw: RawCommandStatusEntry,
): CommandStatusEntry => ({
  sequence: raw.sequence,
  commandId: raw.commandId,
  commandKind:
    (commandKindNames.get(raw.commandKind) as CommandKindName | undefined) ??
    "Unknown",
  commandKindValue: raw.commandKind,
  clientId: raw.clientId,
  state:
    (commandStateNames.get(raw.state) as CommandState | undefined) ??
    "Unknown",
  stateValue: raw.state,
  statusCode: raw.statusCode,
  statusMessage: raw.statusMessage,
  observedAt: raw.observedAt,
  updatedAt: raw.updatedAt,
});

function reverseEnum(values: Record<string, number>) {
  return new Map(Object.entries(values).map(([key, value]) => [value, key]));
}
