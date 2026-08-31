import { Schema } from "effect";

export class InvalidCommandInput extends Schema.TaggedError<InvalidCommandInput>()(
  "InvalidCommandInput",
  {
    command: Schema.Defect(),
    cause: Schema.Defect(),
  },
) {}

export class CommandSubmissionInProgress extends Schema.TaggedError<CommandSubmissionInProgress>()(
  "CommandSubmissionInProgress",
  {
    commandId: Schema.String,
  },
) {}

export class CommandObservationTimeout extends Schema.TaggedError<CommandObservationTimeout>()(
  "CommandObservationTimeout",
  {
    commandId: Schema.String,
  },
) {}

export class CommandTimeout extends Schema.TaggedError<CommandTimeout>()(
  "CommandTimeout",
  {
    commandId: Schema.String,
  },
) {}

export class CommandStatusUnavailable extends Schema.TaggedError<CommandStatusUnavailable>()(
  "CommandStatusUnavailable",
  {
    operation: Schema.String,
    nodeId: Schema.optional(Schema.String),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
