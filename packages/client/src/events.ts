import type {
  ClientSession,
  ClientSubscription,
  OPCUAClient,
} from "node-opcua";
import { Effect, PubSub } from "effect";

import type { NodeIdString } from "./capabilities.js";

export type OpcuaClientEvent =
  | { readonly _tag: "Connected"; readonly endpointUrl: string }
  | {
      readonly _tag: "ConnectionFailed";
      readonly endpointUrl: string;
      readonly cause: unknown;
    }
  | { readonly _tag: "Backoff"; readonly raw: unknown }
  | { readonly _tag: "StartReconnection"; readonly raw: unknown }
  | { readonly _tag: "AfterReconnection"; readonly raw: unknown }
  | { readonly _tag: "ConnectionLost"; readonly raw: unknown }
  | { readonly _tag: "ConnectionReestablished"; readonly raw: unknown }
  | { readonly _tag: "Disconnected"; readonly endpointUrl?: string };

export type OpcuaSessionEvent =
  | { readonly _tag: "KeepAlive"; readonly raw: unknown }
  | { readonly _tag: "KeepAliveFailure"; readonly raw: unknown }
  | { readonly _tag: "SessionClosed"; readonly raw: unknown }
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
      readonly raw: unknown;
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

export const publishUnsafe = <A>(pubsub: PubSub.PubSub<A>, event: A) => {
  Effect.runFork(PubSub.publish(pubsub, event));
};

export const wireClientEvents = (
  client: OPCUAClient,
  events: PubSub.PubSub<OpcuaClientEvent>,
) => {
  client.on("backoff", (...raw) =>
    publishUnsafe(events, { _tag: "Backoff", raw }),
  );
  client.on("start_reconnection", (...raw) =>
    publishUnsafe(events, { _tag: "StartReconnection", raw }),
  );
  client.on("after_reconnection", (...raw) =>
    publishUnsafe(events, { _tag: "AfterReconnection", raw }),
  );
  client.on("connection_lost", (...raw) =>
    publishUnsafe(events, { _tag: "ConnectionLost", raw }),
  );
  client.on("connection_reestablished", (...raw) =>
    publishUnsafe(events, { _tag: "ConnectionReestablished", raw }),
  );
};

export const wireSessionEvents = (
  session: ClientSession,
  events: PubSub.PubSub<OpcuaSessionEvent>,
) => {
  session.on("keepalive", (raw) =>
    publishUnsafe(events, { _tag: "KeepAlive", raw }),
  );
  session.on("keepalive_failure", (raw) =>
    publishUnsafe(events, { _tag: "KeepAliveFailure", raw }),
  );
  session.on("session_closed", (raw) =>
    publishUnsafe(events, { _tag: "SessionClosed", raw }),
  );
  session.on("session_restored", () =>
    publishUnsafe(events, { _tag: "SessionRestored" }),
  );
};

export const wireSubscriptionEvents = (
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
) => {
  subscription.on("started", (subscriptionId) =>
    publishUnsafe(events, { _tag: "Started", subscriptionId }),
  );
  subscription.on("terminated", (...raw) =>
    publishUnsafe(events, {
      _tag: "Terminated",
      subscriptionId: subscription.subscriptionId,
      cause: raw,
    }),
  );
  subscription.on("keepalive", () =>
    publishUnsafe(events, {
      _tag: "KeepAlive",
      subscriptionId: subscription.subscriptionId,
    }),
  );
  subscription.on("internal_error", (cause) =>
    publishUnsafe(events, {
      _tag: "InternalError",
      subscriptionId: subscription.subscriptionId,
      cause,
    }),
  );
  subscription.on("status_changed", (...raw) =>
    publishUnsafe(events, {
      _tag: "StatusChanged",
      subscriptionId: subscription.subscriptionId,
      raw,
    }),
  );
};
