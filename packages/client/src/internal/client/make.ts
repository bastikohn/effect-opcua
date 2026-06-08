import { OPCUAClient } from "node-opcua";
import { Effect, PubSub, Stream } from "effect";

import * as OpcuaError from "../../OpcuaError.js";
import type { ClientLayerOptions, ClientService } from "../../OpcuaClient.js";
import { EVENT_BUFFER_SIZE } from "../common/constants.js";
import { EventBus, wireClientEvents } from "../events/wire.js";
import type { OpcuaClientEvent } from "../events/model.js";

export const makeClientService = Effect.fnUntraced(function* (
  options: ClientLayerOptions,
) {
  const events = yield* PubSub.sliding<OpcuaClientEvent>({
    capacity: EVENT_BUFFER_SIZE,
    replay: 1,
  });
  yield* Effect.addFinalizer(() => PubSub.shutdown(events));

  const unsafeRawClient = yield* Effect.try({
    try: () => OPCUAClient.create(options.clientOptions ?? {}),
    catch: (cause) =>
      OpcuaError.connectError({ endpointUrl: options.endpointUrl, cause }),
  });
  yield* wireClientEvents(unsafeRawClient, events);
  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: async (signal) => {
        let disconnectAfterAbort: Promise<void> | undefined;
        const disconnectOnAbort = () => {
          disconnectAfterAbort ??= unsafeRawClient
            .disconnect()
            .catch(() => undefined);
        };

        signal.addEventListener("abort", disconnectOnAbort, { once: true });
        try {
          await unsafeRawClient.connect(options.endpointUrl);
          if (signal.aborted) {
            disconnectOnAbort();
            await disconnectAfterAbort;
            throw new Error("Connection aborted");
          }
          EventBus.publishUnsafe(events, {
            _tag: "Connected",
            endpointUrl: options.endpointUrl,
          });
          return unsafeRawClient;
        } finally {
          signal.removeEventListener("abort", disconnectOnAbort);
        }
      },
      catch: (cause) =>
        OpcuaError.connectError({
          endpointUrl: options.endpointUrl,
          cause,
        }),
    }).pipe(
      Effect.withSpan("opcua.connect", {
        attributes: { "opcua.endpoint_url": options.endpointUrl },
        kind: "client",
      }),
    ),
    () =>
      Effect.tryPromise({
        try: async () => {
          await unsafeRawClient.disconnect();
          EventBus.publishUnsafe(events, {
            _tag: "Disconnected",
            endpointUrl: options.endpointUrl,
          });
        },
        catch: (cause) =>
          OpcuaError.disconnectError({
            endpointUrl: options.endpointUrl,
            cause,
          }),
      }).pipe(
        Effect.withSpan("opcua.disconnect", {
          attributes: { "opcua.endpoint_url": options.endpointUrl },
          kind: "client",
        }),
        Effect.ignore,
      ),
  );
  return {
    events: Stream.fromPubSub(events),
    unsafeRawClient,
  } satisfies ClientService;
});
