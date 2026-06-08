import { Effect } from "effect";

import {
  DEFAULT_LIFETIME_COUNT,
  DEFAULT_MAX_KEEP_ALIVE_COUNT,
  DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH,
  DEFAULT_PRIORITY,
  DEFAULT_PUBLISHING_ENABLED,
} from "../common/constants.js";
import {
  durationToMillis,
  nonNegativeIntegerOption,
  positiveIntegerOption,
  unknownKeys,
} from "../common/options.js";
import { isPlainRecord } from "../common/predicates.js";
import {
  configurationError,
  type OpcuaConfigurationError,
} from "../../OpcuaError.js";
import type { SubscriptionOptions } from "../../OpcuaSession.js";

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
  options: SubscriptionOptions,
): Effect.Effect<NormalizedSubscriptionOptions, OpcuaConfigurationError> =>
  Effect.suspend(() => {
    if (!isPlainRecord(options)) {
      return Effect.fail(subscriptionOptionsError("options must be an object"));
    }
    const unknown = unknownKeys(options, allowedSubscriptionOptionKeys);
    if (unknown.length > 0) {
      return Effect.fail(
        subscriptionOptionsError(`unsupported option: ${unknown.join(", ")}`),
      );
    }

    const publishingInterval = durationToMillis(options.publishingInterval, {
      notDuration: "publishingInterval must be a Duration",
      invalidDuration: "publishingInterval must be finite and non-negative",
    });
    if (typeof publishingInterval === "string") {
      return Effect.fail(subscriptionOptionsError(publishingInterval));
    }

    const lifetimeCount = options.lifetimeCount ?? DEFAULT_LIFETIME_COUNT;
    if (!positiveIntegerOption(lifetimeCount)) {
      return Effect.fail(
        subscriptionOptionsError("lifetimeCount must be a positive integer"),
      );
    }

    const maxKeepAliveCount =
      options.maxKeepAliveCount ?? DEFAULT_MAX_KEEP_ALIVE_COUNT;
    if (!positiveIntegerOption(maxKeepAliveCount)) {
      return Effect.fail(
        subscriptionOptionsError(
          "maxKeepAliveCount must be a positive integer",
        ),
      );
    }

    const maxNotificationsPerPublish =
      options.maxNotificationsPerPublish ??
      DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH;
    if (!nonNegativeIntegerOption(maxNotificationsPerPublish)) {
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
    if (!nonNegativeIntegerOption(priority) || priority > 255) {
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

const subscriptionOptionsError = (cause: unknown) =>
  configurationError({
    operation: "subscription.options",
    cause,
  });
