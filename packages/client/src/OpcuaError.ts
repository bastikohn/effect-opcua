import type { StatusCode } from "node-opcua";
import { Data } from "effect";

import type {
  NodeIdString,
  VariableCapability,
} from "./internal/capabilities.js";
import type { OpcuaStatusInfo } from "./internal/normalize.js";

export type OpcuaErrorReason =
  | {
      readonly _tag: "Configuration";
      readonly operation: string;
      readonly key?: string;
      readonly nodeId?: NodeIdString;
      readonly objectId?: NodeIdString;
      readonly methodId?: NodeIdString;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "Service";
      readonly operation: string;
      readonly key?: string;
      readonly nodeId?: NodeIdString;
      readonly objectId?: NodeIdString;
      readonly methodId?: NodeIdString;
      readonly status?: OpcuaStatusInfo;
      readonly statusCode?: StatusCode;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "Connect";
      readonly endpointUrl: string;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "Disconnect";
      readonly endpointUrl?: string;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "SessionCreate";
      readonly endpointUrl?: string;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "SessionClose";
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "SubscriptionCreate";
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "AccessDenied";
      readonly nodeId: NodeIdString;
      readonly requestedCapability: VariableCapability;
      readonly accessLevel?: number;
      readonly userAccessLevel?: number;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "Encode";
      readonly nodeId: NodeIdString;
      readonly value: unknown;
      readonly error?: unknown;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "Decode";
      readonly nodeId: NodeIdString;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "MethodInput";
      readonly objectId: NodeIdString;
      readonly methodId: NodeIdString;
      readonly input: unknown;
      readonly phase:
        | "MissingInputKey"
        | "UnknownInputKey"
        | "ArgumentMapping"
        | "Encoding";
      readonly argumentKey?: string;
      readonly argumentIndex?: number;
      readonly error?: unknown;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "MethodNotExecutable";
      readonly objectId: NodeIdString;
      readonly methodId: NodeIdString;
      readonly executable?: boolean;
      readonly userExecutable?: boolean;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "MonitorConfiguration";
      readonly operation: string;
      readonly key?: string;
      readonly nodeId?: NodeIdString;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "MonitorCreate";
      readonly subscriptionId?: number;
      readonly startup: unknown;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "MonitorStartup";
      readonly phase: "Validation" | "Create";
      readonly key?: string;
      readonly nodeId: NodeIdString;
      readonly statusCode?: StatusCode;
      readonly status?: OpcuaStatusInfo;
      readonly cause?: unknown;
    }
  | {
      readonly _tag: "MonitorRuntime";
      readonly subscriptionId?: number;
      readonly nodeIds?: ReadonlyArray<NodeIdString>;
      readonly cause?: unknown;
    };

export class OpcuaError extends Data.TaggedError("OpcuaError")<{
  readonly reason: OpcuaErrorReason;
}> {}

export type OpcuaConfigurationError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "Configuration" }>;
};
export type OpcuaServiceError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "Service" }>;
};
export type OpcuaConnectError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "Connect" }>;
};
export type OpcuaDisconnectError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "Disconnect" }>;
};
export type OpcuaSessionCreateError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "SessionCreate" }>;
};
export type OpcuaSessionCloseError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "SessionClose" }>;
};
export type OpcuaSubscriptionCreateError = OpcuaError & {
  readonly reason: Extract<
    OpcuaErrorReason,
    { readonly _tag: "SubscriptionCreate" }
  >;
};
export type OpcuaAccessDeniedError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "AccessDenied" }>;
};
export type OpcuaEncodeError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "Encode" }>;
};
export type OpcuaDecodeError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "Decode" }>;
};
export type OpcuaMethodInputError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "MethodInput" }>;
};
export type OpcuaMethodNotExecutableError = OpcuaError & {
  readonly reason: Extract<
    OpcuaErrorReason,
    { readonly _tag: "MethodNotExecutable" }
  >;
};
export type OpcuaMonitorConfigurationError = OpcuaError & {
  readonly reason: Extract<
    OpcuaErrorReason,
    { readonly _tag: "MonitorConfiguration" }
  >;
};
export type OpcuaMonitorCreateError<Items = Record<string, unknown>> =
  OpcuaError & {
    readonly reason: {
      readonly _tag: "MonitorCreate";
      readonly subscriptionId?: number;
      readonly startup: import("./OpcuaSubscription.js").MonitorStartupReport<Items>;
      readonly cause?: unknown;
    };
  };
export type OpcuaMonitorStartupError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "MonitorStartup" }>;
};
export type OpcuaMonitorRuntimeError = OpcuaError & {
  readonly reason: Extract<OpcuaErrorReason, { readonly _tag: "MonitorRuntime" }>;
};

export const isOpcuaError = (value: unknown): value is OpcuaError =>
  value instanceof OpcuaError ||
  (typeof value === "object" &&
    value !== null &&
    "_tag" in value &&
    (value as { readonly _tag?: unknown })._tag === "OpcuaError" &&
    "reason" in value);

export const isConfigurationError = (
  value: unknown,
): value is OpcuaConfigurationError =>
  isOpcuaError(value) && value.reason._tag === "Configuration";

const makeError = <Reason extends OpcuaErrorReason>(reason: Reason) =>
  new OpcuaError({ reason }) as OpcuaError & { readonly reason: Reason };

export const configurationError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "Configuration" }>,
    "_tag"
  >,
): OpcuaConfigurationError =>
  makeError({ _tag: "Configuration", ...reason });

export const serviceError = (
  reason: Omit<Extract<OpcuaErrorReason, { readonly _tag: "Service" }>, "_tag">,
): OpcuaServiceError =>
  makeError({ _tag: "Service", ...reason });

export const connectError = (
  reason: Omit<Extract<OpcuaErrorReason, { readonly _tag: "Connect" }>, "_tag">,
): OpcuaConnectError =>
  makeError({ _tag: "Connect", ...reason });

export const disconnectError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "Disconnect" }>,
    "_tag"
  >,
): OpcuaDisconnectError =>
  makeError({ _tag: "Disconnect", ...reason });

export const sessionCreateError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "SessionCreate" }>,
    "_tag"
  >,
): OpcuaSessionCreateError =>
  makeError({ _tag: "SessionCreate", ...reason });

export const sessionCloseError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "SessionClose" }>,
    "_tag"
  >,
): OpcuaSessionCloseError =>
  makeError({ _tag: "SessionClose", ...reason });

export const subscriptionCreateError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "SubscriptionCreate" }>,
    "_tag"
  >,
): OpcuaSubscriptionCreateError =>
  makeError({ _tag: "SubscriptionCreate", ...reason });

export const accessDeniedError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "AccessDenied" }>,
    "_tag"
  >,
): OpcuaAccessDeniedError =>
  makeError({ _tag: "AccessDenied", ...reason });

export const encodeError = (
  reason: Omit<Extract<OpcuaErrorReason, { readonly _tag: "Encode" }>, "_tag">,
): OpcuaEncodeError =>
  makeError({ _tag: "Encode", ...reason });

export const decodeError = (
  reason: Omit<Extract<OpcuaErrorReason, { readonly _tag: "Decode" }>, "_tag">,
): OpcuaDecodeError =>
  makeError({ _tag: "Decode", ...reason });

export const methodInputError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "MethodInput" }>,
    "_tag"
  >,
): OpcuaMethodInputError =>
  makeError({ _tag: "MethodInput", ...reason });

export const methodNotExecutableError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "MethodNotExecutable" }>,
    "_tag"
  >,
): OpcuaMethodNotExecutableError =>
  makeError({ _tag: "MethodNotExecutable", ...reason });

export const monitorConfigurationError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "MonitorConfiguration" }>,
    "_tag"
  >,
): OpcuaMonitorConfigurationError =>
  makeError({ _tag: "MonitorConfiguration", ...reason });

export const monitorCreateError = <Items>(
  reason: {
    readonly subscriptionId?: number;
    readonly startup: import("./OpcuaSubscription.js").MonitorStartupReport<Items>;
    readonly cause?: unknown;
  },
): OpcuaMonitorCreateError<Items> =>
  makeError({ _tag: "MonitorCreate", ...reason }) as OpcuaMonitorCreateError<Items>;

export const monitorStartupError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "MonitorStartup" }>,
    "_tag"
  >,
): OpcuaMonitorStartupError =>
  makeError({ _tag: "MonitorStartup", ...reason });

export const monitorRuntimeError = (
  reason: Omit<
    Extract<OpcuaErrorReason, { readonly _tag: "MonitorRuntime" }>,
    "_tag"
  >,
): OpcuaMonitorRuntimeError =>
  makeError({ _tag: "MonitorRuntime", ...reason });
