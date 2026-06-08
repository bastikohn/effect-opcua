import { ClientSubscription, type ClientSession } from "node-opcua";
import { Effect, PubSub } from "effect";

import * as OpcuaError from "../../OpcuaError.js";
import type * as OpcuaSession from "../../OpcuaSession.js";
import { EVENT_BUFFER_SIZE } from "../common/constants.js";
import type { OpcuaSubscriptionEvent } from "../events/model.js";
import { wireSubscriptionEvents } from "../events/wire.js";
import { validateSubscriptionOptions } from "./options.js";

export const makeSubscriptionRuntime = Effect.fnUntraced(function* (
  unsafeRawSession: ClientSession,
  options: OpcuaSession.SubscriptionOptions,
) {
  const normalized = yield* validateSubscriptionOptions(options);
  const events = yield* PubSub.sliding<OpcuaSubscriptionEvent>({
    capacity: EVENT_BUFFER_SIZE,
    replay: 1,
  });
  yield* Effect.addFinalizer(() => PubSub.shutdown(events));

  const unsafeRaw = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: async () =>
        ClientSubscription.create(unsafeRawSession, {
          requestedPublishingInterval: normalized.publishingInterval,
          requestedLifetimeCount: normalized.lifetimeCount,
          requestedMaxKeepAliveCount: normalized.maxKeepAliveCount,
          maxNotificationsPerPublish: normalized.maxNotificationsPerPublish,
          publishingEnabled: normalized.publishingEnabled,
          priority: normalized.priority,
        }),
      catch: (cause) => OpcuaError.subscriptionCreateError({ cause }),
    }).pipe(
      Effect.withSpan("opcua.subscription.create", {
        attributes: {
          "opcua.publishing_interval_ms": normalized.publishingInterval,
        },
        kind: "client",
      }),
    ),
    (subscription) =>
      Effect.tryPromise({
        try: () => subscription.terminate(),
        catch: (cause) => OpcuaError.subscriptionCreateError({ cause }),
      }).pipe(
        Effect.withSpan("opcua.subscription.terminate", {
          attributes: {
            "opcua.subscription_id": subscription.subscriptionId,
          },
          kind: "client",
        }),
        Effect.ignore,
      ),
  );
  yield* wireSubscriptionEvents(unsafeRaw, events);
  return { events, unsafeRaw } as const;
});

export { validateSubscriptionOptions };
