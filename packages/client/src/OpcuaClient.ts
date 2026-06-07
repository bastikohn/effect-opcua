import { OPCUAClient, type OPCUAClientOptions } from "node-opcua";
import { type Config, Context, Effect, Layer, PubSub, Stream } from "effect";

import { OpcuaError } from "@effect-opcua/client";

import { EVENT_BUFFER_SIZE } from "./internal/constants.js";
import {
  EventBus,
  type OpcuaClientEvent,
  wireClientEvents,
} from "./internal/events.js";

const TypeId = "@effect-opcua/client/OpcuaClient";

export interface ClientService {
  readonly events: Stream.Stream<OpcuaClientEvent>;
  readonly unsafeRawClient: OPCUAClient;
}
export class Client extends Context.Service<Client, ClientService>()(TypeId) {}

export const make = Effect.fnUntraced(function* (options: ClientLayerOptions) {
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
  return Client.of({
    events: Stream.fromPubSub(events),
    unsafeRawClient,
  });
});

export type ClientLayerOptions = {
  readonly endpointUrl: string;
  readonly clientOptions?: OPCUAClientOptions;
};

export const layer = (options: ClientLayerOptions) =>
  Layer.effect(Client, make(options));

export type ClientLayerConfig = Config.Config<ClientLayerOptions>;

export const layerConfig = (config: ClientLayerConfig) =>
  Layer.effect(Client, Effect.flatMap(config, make));
