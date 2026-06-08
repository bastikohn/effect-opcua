import { Effect, PubSub } from "effect";

import * as OpcuaClient from "../../OpcuaClient.js";
import * as OpcuaError from "../../OpcuaError.js";
import type * as OpcuaSession from "../../OpcuaSession.js";
import { EVENT_BUFFER_SIZE } from "../common/constants.js";
import type { OpcuaSessionEvent } from "../events/model.js";
import { wireSessionEvents } from "../events/wire.js";
import { makeSession } from "./service.js";

export const make = Effect.fnUntraced(function* (
  options?: OpcuaSession.SessionOptions,
) {
  const client = yield* OpcuaClient.Client;
  const events = yield* PubSub.sliding<OpcuaSessionEvent>({
    capacity: EVENT_BUFFER_SIZE,
    replay: 1,
  });
  yield* Effect.addFinalizer(() => PubSub.shutdown(events));

  const raw = yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: async (signal) => {
        const session = await client.unsafeRawClient.createSession(
          options?.userIdentity,
        );
        if (signal.aborted) {
          await session.close(true).catch(() => undefined);
          throw new Error("Session creation aborted");
        }
        return session;
      },
      catch: (cause) => OpcuaError.sessionCreateError({ cause }),
    }).pipe(Effect.withSpan("opcua.session.create", { kind: "client" })),
    (session) =>
      Effect.tryPromise({
        try: () => session.close(true),
        catch: (cause) => OpcuaError.sessionCloseError({ cause }),
      }).pipe(
        Effect.withSpan("opcua.session.close", { kind: "client" }),
        Effect.ignore,
      ),
  );
  yield* wireSessionEvents(raw, events);
  return yield* makeSession(raw, events, { batching: options?.batching });
});
