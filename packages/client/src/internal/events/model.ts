import type { NodeIdString } from "../common/node-id.js";

export type OpcuaClientEvent =
  | { readonly _tag: "Connected"; readonly endpointUrl: string }
  | { readonly _tag: "Backoff"; readonly unsafeRaw: unknown }
  | { readonly _tag: "StartReconnection"; readonly unsafeRaw: unknown }
  | { readonly _tag: "AfterReconnection"; readonly unsafeRaw: unknown }
  | { readonly _tag: "ConnectionLost"; readonly unsafeRaw: unknown }
  | { readonly _tag: "ConnectionReestablished"; readonly unsafeRaw: unknown }
  | { readonly _tag: "Disconnected"; readonly endpointUrl?: string };

export type OpcuaSessionEvent =
  | { readonly _tag: "KeepAlive"; readonly unsafeRaw: unknown }
  | { readonly _tag: "KeepAliveFailure"; readonly unsafeRaw: unknown }
  | { readonly _tag: "SessionClosed"; readonly unsafeRaw: unknown }
  | { readonly _tag: "SessionRestored" };

export type OpcuaSubscriptionEvent =
  | { readonly _tag: "Started"; readonly subscriptionId: number }
  | {
      readonly _tag: "Terminated";
      readonly subscriptionId?: number;
      readonly cause?: unknown;
    }
  | { readonly _tag: "KeepAlive"; readonly subscriptionId: number }
  | {
      readonly _tag: "InternalError";
      readonly subscriptionId?: number;
      readonly cause: unknown;
    }
  | {
      readonly _tag: "StatusChanged";
      readonly subscriptionId?: number;
      readonly unsafeRaw: unknown;
    }
  | {
      readonly _tag: "ClientBufferDropped";
      readonly subscriptionId?: number;
      readonly nodeId: NodeIdString;
    }
  | {
      readonly _tag: "MonitorItemsCreated";
      readonly subscriptionId?: number;
      readonly nodeIds: ReadonlyArray<NodeIdString>;
    }
  | {
      readonly _tag: "MonitorItemsTerminated";
      readonly subscriptionId?: number;
      readonly nodeIds: ReadonlyArray<NodeIdString>;
    };
