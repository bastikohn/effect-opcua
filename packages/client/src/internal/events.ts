import type {
  ClientSession,
  ClientSubscription,
  OPCUAClient,
} from "node-opcua";
import { Effect, PubSub } from "effect";

import type { NodeIdString } from "./common/node-id.js";

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

type Emitter = {
  readonly on: (
    event: string,
    listener: (...args: ReadonlyArray<unknown>) => void,
  ) => unknown;
  readonly off?: (
    event: string,
    listener: (...args: ReadonlyArray<unknown>) => void,
  ) => unknown;
  readonly removeListener?: (
    event: string,
    listener: (...args: ReadonlyArray<unknown>) => void,
  ) => unknown;
};

type EventMapping<A> = {
  readonly event: string;
  readonly make: (...args: ReadonlyArray<unknown>) => A;
};

export const EventBus = {
  publishUnsafe: <A>(pubsub: PubSub.PubSub<A>, event: A) =>
    PubSub.publishUnsafe(pubsub, event),
  wireEmitter: <A>(
    emitter: Emitter,
    mappings: ReadonlyArray<EventMapping<A>>,
    pubsub: PubSub.PubSub<A>,
  ) =>
    Effect.acquireRelease(
      Effect.sync(() =>
        mappings.map((mapping) => {
          const listener = (...args: ReadonlyArray<unknown>) => {
            EventBus.publishUnsafe(pubsub, mapping.make(...args));
          };
          emitter.on(mapping.event, listener);
          return { event: mapping.event, listener };
        }),
      ),
      (listeners) =>
        Effect.sync(() => {
          for (const { event, listener } of listeners) {
            if (emitter.off) emitter.off(event, listener);
            else emitter.removeListener?.(event, listener);
          }
        }),
    ),
};

export const wireClientEvents = (
  client: OPCUAClient,
  events: PubSub.PubSub<OpcuaClientEvent>,
) =>
  EventBus.wireEmitter(
    client as unknown as Emitter,
    [
      {
        event: "backoff",
        make: (...unsafeRaw) => ({ _tag: "Backoff", unsafeRaw }) as const,
      },
      {
        event: "start_reconnection",
        make: (...unsafeRaw) =>
          ({ _tag: "StartReconnection", unsafeRaw }) as const,
      },
      {
        event: "after_reconnection",
        make: (...unsafeRaw) =>
          ({ _tag: "AfterReconnection", unsafeRaw }) as const,
      },
      {
        event: "connection_lost",
        make: (...unsafeRaw) =>
          ({ _tag: "ConnectionLost", unsafeRaw }) as const,
      },
      {
        event: "connection_reestablished",
        make: (...unsafeRaw) =>
          ({ _tag: "ConnectionReestablished", unsafeRaw }) as const,
      },
    ],
    events,
  );

export const wireSessionEvents = (
  session: ClientSession,
  events: PubSub.PubSub<OpcuaSessionEvent>,
) =>
  EventBus.wireEmitter(
    session as unknown as Emitter,
    [
      {
        event: "keepalive",
        make: (unsafeRaw) => ({ _tag: "KeepAlive", unsafeRaw }) as const,
      },
      {
        event: "keepalive_failure",
        make: (unsafeRaw) => ({ _tag: "KeepAliveFailure", unsafeRaw }) as const,
      },
      {
        event: "session_closed",
        make: (unsafeRaw) => ({ _tag: "SessionClosed", unsafeRaw }) as const,
      },
      {
        event: "session_restored",
        make: () => ({ _tag: "SessionRestored" }) as const,
      },
    ],
    events,
  );

export const wireSubscriptionEvents = (
  subscription: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
) =>
  EventBus.wireEmitter(
    subscription as unknown as Emitter,
    [
      {
        event: "started",
        make: (subscriptionId) =>
          ({
            _tag: "Started",
            subscriptionId: Number(subscriptionId),
          }) as const,
      },
      {
        event: "terminated",
        make: (...unsafeRaw) =>
          ({
            _tag: "Terminated",
            subscriptionId: subscription.subscriptionId,
            cause: unsafeRaw,
          }) as const,
      },
      {
        event: "keepalive",
        make: () =>
          ({
            _tag: "KeepAlive",
            subscriptionId: subscription.subscriptionId,
          }) as const,
      },
      {
        event: "internal_error",
        make: (cause) =>
          ({
            _tag: "InternalError",
            subscriptionId: subscription.subscriptionId,
            cause,
          }) as const,
      },
      {
        event: "status_changed",
        make: (...unsafeRaw) =>
          ({
            _tag: "StatusChanged",
            subscriptionId: subscription.subscriptionId,
            unsafeRaw,
          }) as const,
      },
    ],
    events,
  );
