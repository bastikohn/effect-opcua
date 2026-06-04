import { OPCUAClient, type OPCUAClientOptions } from "node-opcua";
import { type Config, Context, Effect, Layer, PubSub, Stream } from "effect";

import { EVENT_BUFFER_SIZE } from "./internal/constants.js";
import { connectError, disconnectError } from "./OpcuaError.js";
import {
  EventBus,
  type OpcuaClientEvent,
  wireClientEvents,
} from "./internal/events.js";

export type OpcuaClientService = {
  readonly events: Stream.Stream<OpcuaClientEvent>;
  readonly unsafeRaw: OPCUAClient;
};

export class OpcuaClient extends Context.Service<
  OpcuaClient,
  OpcuaClientService
>()("@effect-opcua/client/OpcuaClient") {}

const connect = async (
  client: OPCUAClient,
  endpointUrl: string,
  events: PubSub.PubSub<OpcuaClientEvent>,
  signal: AbortSignal,
) => {
  let disconnectAfterAbort: Promise<void> | undefined;
  const disconnectOnAbort = () => {
    disconnectAfterAbort ??= client.disconnect().catch(() => undefined);
  };

  signal.addEventListener("abort", disconnectOnAbort, { once: true });
  try {
    await client.connect(endpointUrl);
    if (signal.aborted) {
      disconnectOnAbort();
      await disconnectAfterAbort;
      throw new Error("Connection aborted");
    }
    EventBus.publishUnsafe(events, { _tag: "Connected", endpointUrl });
    return client;
  } finally {
    signal.removeEventListener("abort", disconnectOnAbort);
  }
};

export type OpcuaClientLayerOptions = {
  readonly endpointUrl: string;
  readonly clientOptions?: OPCUAClientOptions;
};

const make = Effect.fnUntraced(function* (options: OpcuaClientLayerOptions) {
  const events = yield* PubSub.sliding<OpcuaClientEvent>({
    capacity: EVENT_BUFFER_SIZE,
    replay: 1,
  });
  yield* Effect.addFinalizer(() => PubSub.shutdown(events));

  const unsafeRaw = yield* Effect.try({
    try: () => OPCUAClient.create(options.clientOptions ?? {}),
    catch: (cause) => connectError({ endpointUrl: options.endpointUrl, cause }),
  });
  yield* wireClientEvents(unsafeRaw, events);
  yield* Effect.acquireRelease(
    Effect.tryPromise({
      try: (signal) => connect(unsafeRaw, options.endpointUrl, events, signal),
      catch: (cause) =>
        connectError({
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
          await unsafeRaw.disconnect();
          EventBus.publishUnsafe(events, {
            _tag: "Disconnected",
            endpointUrl: options.endpointUrl,
          });
        },
        catch: (cause) =>
          disconnectError({
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
  return OpcuaClient.of({
    events: Stream.fromPubSub(events),
    unsafeRaw,
  });
});

export const layer = (options: OpcuaClientLayerOptions) =>
  Layer.effect(OpcuaClient, make(options));

export type OpcuaClientLayerConfig = Config.Config<OpcuaClientLayerOptions>;

export const layerConfig = (config: OpcuaClientLayerConfig) =>
  Layer.effect(OpcuaClient, Effect.flatMap(config, make));
