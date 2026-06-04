import { Duration, Effect } from "effect";

import {
  DEFAULT_LIFETIME_COUNT,
  DEFAULT_MAX_KEEP_ALIVE_COUNT,
  DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH,
  DEFAULT_PRIORITY,
  DEFAULT_PUBLISHING_ENABLED,
} from "./constants.js";
import {
  isPlainRecord,
  nonNegativeInteger,
  positiveInteger,
} from "./predicates.js";
import {
  configurationError,
  type OpcuaConfigurationError,
} from "../OpcuaError.js";
import type { OpcuaSubscriptionOptions } from "../OpcuaSession.js";

export type NormalizedSubscriptionOptions = {
  readonly publishingInterval: number;
  readonly lifetimeCount: number;
  readonly maxKeepAliveCount: number;
  readonly maxNotificationsPerPublish: number;
  readonly publishingEnabled: boolean;
  readonly priority: number;
};

const allowedSubscriptionOptionKeys = new Set([
  "publishingInterval",
  "lifetimeCount",
  "maxKeepAliveCount",
  "maxNotificationsPerPublish",
  "publishingEnabled",
  "priority",
]);

export const validateSubscriptionOptions = (
  options: OpcuaSubscriptionOptions,
): Effect.Effect<NormalizedSubscriptionOptions, OpcuaConfigurationError> =>
  Effect.suspend(() => {
    if (!isPlainRecord(options)) {
      return Effect.fail(subscriptionOptionsError("options must be an object"));
    }
    const unknown = Object.keys(options).filter(
      (key) => !allowedSubscriptionOptionKeys.has(key),
    );
    if (unknown.length > 0) {
      return Effect.fail(
        subscriptionOptionsError(`unsupported option: ${unknown.join(", ")}`),
      );
    }

    const publishingInterval = durationMillis(options.publishingInterval);
    if (typeof publishingInterval === "string") {
      return Effect.fail(subscriptionOptionsError(publishingInterval));
    }

    const lifetimeCount = options.lifetimeCount ?? DEFAULT_LIFETIME_COUNT;
    if (!positiveInteger(lifetimeCount)) {
      return Effect.fail(
        subscriptionOptionsError("lifetimeCount must be a positive integer"),
      );
    }

    const maxKeepAliveCount =
      options.maxKeepAliveCount ?? DEFAULT_MAX_KEEP_ALIVE_COUNT;
    if (!positiveInteger(maxKeepAliveCount)) {
      return Effect.fail(
        subscriptionOptionsError(
          "maxKeepAliveCount must be a positive integer",
        ),
      );
    }

    const maxNotificationsPerPublish =
      options.maxNotificationsPerPublish ??
      DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH;
    if (!nonNegativeInteger(maxNotificationsPerPublish)) {
      return Effect.fail(
        subscriptionOptionsError(
          "maxNotificationsPerPublish must be a non-negative integer",
        ),
      );
    }

    const publishingEnabled =
      options.publishingEnabled ?? DEFAULT_PUBLISHING_ENABLED;
    if (typeof publishingEnabled !== "boolean") {
      return Effect.fail(
        subscriptionOptionsError("publishingEnabled must be a boolean"),
      );
    }

    const priority = options.priority ?? DEFAULT_PRIORITY;
    if (!nonNegativeInteger(priority) || priority > 255) {
      return Effect.fail(
        subscriptionOptionsError(
          "priority must be an integer between 0 and 255",
        ),
      );
    }

    return Effect.succeed({
      publishingInterval,
      lifetimeCount,
      maxKeepAliveCount,
      maxNotificationsPerPublish,
      publishingEnabled,
      priority,
    });
  });

const durationMillis = (duration: Duration.Duration) => {
  if (!Duration.isDuration(duration)) {
    return "publishingInterval must be a Duration";
  }
  const millis = Duration.toMillis(duration);
  if (!Number.isFinite(millis) || millis < 0) {
    return "publishingInterval must be finite and non-negative";
  }
  return millis;
};

const subscriptionOptionsError = (cause: unknown) =>
  configurationError({
    operation: "subscription.options",
    cause,
  });
