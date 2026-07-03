import { Schema } from "effect";

export class InvalidCommandInput extends Schema.TaggedErrorClass<InvalidCommandInput>()(
  "InvalidCommandInput",
  {
    command: Schema.Defect(),
    cause: Schema.Defect(),
  },
) {}

export class CommandSubmissionInProgress extends Schema.TaggedErrorClass<CommandSubmissionInProgress>()(
  "CommandSubmissionInProgress",
  {
    commandId: Schema.String,
  },
) {}

export class CommandObservationTimeout extends Schema.TaggedErrorClass<CommandObservationTimeout>()(
  "CommandObservationTimeout",
  {
    commandId: Schema.String,
  },
) {}

export class CommandTimeout extends Schema.TaggedErrorClass<CommandTimeout>()(
  "CommandTimeout",
  {
    commandId: Schema.String,
  },
) {}

export class CommandStatusUnavailable extends Schema.TaggedErrorClass<CommandStatusUnavailable>()(
  "CommandStatusUnavailable",
  {
    operation: Schema.String,
    nodeId: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
