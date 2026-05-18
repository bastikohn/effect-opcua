import type { DataValue, StatusCode } from "node-opcua";
import { Data, Schema } from "effect";

import type { Capability, NodeIdString } from "./capabilities.js";

export class OpcuaConnectError extends Data.TaggedError("OpcuaConnectError")<{
  readonly endpointUrl: string;
  readonly cause?: unknown;
}> {}

export class OpcuaDisconnectError extends Data.TaggedError(
  "OpcuaDisconnectError",
)<{
  readonly endpointUrl?: string;
  readonly cause?: unknown;
}> {}

export class OpcuaSessionCreateError extends Data.TaggedError(
  "OpcuaSessionCreateError",
)<{
  readonly endpointUrl?: string;
  readonly cause?: unknown;
}> {}

export class OpcuaSessionCloseError extends Data.TaggedError(
  "OpcuaSessionCloseError",
)<{
  readonly cause?: unknown;
}> {}

export class OpcuaSubscriptionCreateError extends Data.TaggedError(
  "OpcuaSubscriptionCreateError",
)<{
  readonly cause?: unknown;
}> {}

export class OpcuaMonitorCreateError extends Data.TaggedError(
  "OpcuaMonitorCreateError",
)<{
  readonly subscriptionId?: number;
  readonly nodeIds?: ReadonlyArray<NodeIdString>;
  readonly details?: ReadonlyArray<{
    readonly nodeId: NodeIdString;
    readonly statusCode?: StatusCode;
    readonly cause?: unknown;
  }>;
  readonly cause?: unknown;
}> {}

export class OpcuaServiceError extends Data.TaggedError("OpcuaServiceError")<{
  readonly operation: string;
  readonly nodeId?: NodeIdString;
  readonly cause?: unknown;
}> {}

export class OpcuaNonGoodStatusError extends Data.TaggedError(
  "OpcuaNonGoodStatusError",
)<{
  readonly operation: string;
  readonly nodeId: NodeIdString;
  readonly statusCode: StatusCode;
  readonly dataValue?: DataValue;
  readonly cause?: unknown;
}> {}

export class OpcuaDecodeError extends Data.TaggedError("OpcuaDecodeError")<{
  readonly nodeId: NodeIdString;
  readonly error: Schema.SchemaError;
  readonly dataValue: DataValue;
  readonly cause?: unknown;
}> {}

export class OpcuaEncodeError extends Data.TaggedError("OpcuaEncodeError")<{
  readonly nodeId: NodeIdString;
  readonly value: unknown;
  readonly error: unknown;
  readonly cause?: unknown;
}> {}

export class OpcuaAccessDeniedError extends Data.TaggedError(
  "OpcuaAccessDeniedError",
)<{
  readonly nodeId: NodeIdString;
  readonly requestedCapability: Capability;
  readonly accessLevel?: number;
  readonly userAccessLevel?: number;
  readonly cause?: unknown;
}> {}

export class OpcuaConfigurationError extends Data.TaggedError(
  "OpcuaConfigurationError",
)<{
  readonly operation: string;
  readonly nodeId?: NodeIdString;
  readonly cause?: unknown;
}> {}

export class OpcuaMethodInputError extends Data.TaggedError(
  "OpcuaMethodInputError",
)<{
  readonly objectId: NodeIdString;
  readonly methodId: NodeIdString;
  readonly input: unknown;
  readonly phase:
    | "SchemaValidation"
    | "MissingInputKey"
    | "UnknownInputKey"
    | "ArgumentMapping"
    | "Encoding";
  readonly argumentKey?: string;
  readonly argumentIndex?: number;
  readonly error?: unknown;
  readonly cause?: unknown;
}> {}

export class OpcuaMethodNotExecutableError extends Data.TaggedError(
  "OpcuaMethodNotExecutableError",
)<{
  readonly objectId: NodeIdString;
  readonly methodId: NodeIdString;
  readonly executable?: boolean;
  readonly userExecutable?: boolean;
  readonly cause?: unknown;
}> {}
