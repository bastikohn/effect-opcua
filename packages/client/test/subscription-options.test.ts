import { describe, expect, it } from "vitest";
import { Duration, Effect } from "effect";

import { isOpcuaError } from "../src/OpcuaError.js";
import { validateSubscriptionOptions } from "../src/internal/subscription-options.js";
import { makeFakeSession } from "./support/fake-session.js";

const invalidSubscriptionOptions = (options: unknown) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeSession();
        return yield* fake.session
          .makeSubscription(options as never)
          .pipe(Effect.flip);
      }),
    ),
  );

const configurationCause = (error: unknown) => {
  expect(isOpcuaError(error)).toBe(true);
  if (!isOpcuaError(error)) return undefined;
  expect(error.reason._tag).toBe("Configuration");
  if (error.reason._tag !== "Configuration") return undefined;
  expect(error.reason.operation).toBe("subscription.options");
  return error.reason.cause;
};

describe("subscription options", () => {
  it("rejects invalid public option objects before node-opcua receives them", async () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [undefined, "options must be an object"],
      [
        {
          publishingInterval: Duration.millis(100),
          unsupported: true,
        },
        "unsupported option: unsupported",
      ],
      [{ publishingInterval: 100 }, "publishingInterval must be a Duration"],
      [
        { publishingInterval: Duration.millis(-1) },
        "publishingInterval must be finite and non-negative",
      ],
      [
        {
          publishingInterval: Duration.millis(100),
          lifetimeCount: 0,
        },
        "lifetimeCount must be a positive integer",
      ],
      [
        {
          publishingInterval: Duration.millis(100),
          maxKeepAliveCount: 0,
        },
        "maxKeepAliveCount must be a positive integer",
      ],
      [
        {
          publishingInterval: Duration.millis(100),
          maxNotificationsPerPublish: -1,
        },
        "maxNotificationsPerPublish must be a non-negative integer",
      ],
      [
        {
          publishingInterval: Duration.millis(100),
          publishingEnabled: "yes",
        },
        "publishingEnabled must be a boolean",
      ],
      [
        {
          publishingInterval: Duration.millis(100),
          priority: 256,
        },
        "priority must be an integer between 0 and 255",
      ],
    ];

    for (const [options, cause] of cases) {
      await expect(invalidSubscriptionOptions(options)).resolves.toSatisfy(
        (error: unknown) => configurationCause(error) === cause,
      );
    }
  });

  it("normalizes valid subscription defaults and OPC UA byte/counter edges", async () => {
    const normalized = await Effect.runPromise(
      validateSubscriptionOptions({
        publishingInterval: Duration.millis(0),
        maxNotificationsPerPublish: 0,
        priority: 255,
      }),
    );

    expect(normalized).toMatchObject({
      publishingInterval: 0,
      maxNotificationsPerPublish: 0,
      publishingEnabled: true,
      priority: 255,
    });
    expect(normalized.lifetimeCount).toBeGreaterThan(0);
    expect(normalized.maxKeepAliveCount).toBeGreaterThan(0);
  });
});
