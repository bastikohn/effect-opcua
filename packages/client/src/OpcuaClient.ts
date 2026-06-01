import { OPCUAClient, type OPCUAClientOptions } from "node-opcua";
import { Config, Context, Effect, Layer, PubSub, Stream } from "effect";

import { EVENT_BUFFER_SIZE } from "./internal/constants.js";
import { connectError, disconnectError } from "./OpcuaError.js";
import {
  EventBus,
  type OpcuaClientEvent,
  wireClientEvents,
} from "./internal/events.js";

export type OpcuaClient = {
  readonly events: Stream.Stream<OpcuaClientEvent>;
  readonly unsafeRaw: OPCUAClient;
};

export type OpcuaClientLayerOptions = {
  readonly endpointUrl: string;
  readonly clientOptions?: OPCUAClientOptions;
};

export type OpcuaClientLayerConfig = {
  readonly endpointUrl: Config.Config<string>;
  readonly clientOptions?:
    | OPCUAClientOptions
    | Config.Config<OPCUAClientOptions>;
};

export const OpcuaClient = Object.assign(
  Context.Service<OpcuaClient>("@effect-opcua/client/OpcuaClient"),
  {
    layer: (options: OpcuaClientLayerOptions) =>
      Layer.effect(OpcuaClient, makeOpcuaClient(options)),
    layerConfig: (options: OpcuaClientLayerConfig) =>
      Layer.effect(
        OpcuaClient,
        Effect.gen(function* () {
          const endpointUrl = yield* options.endpointUrl;
          const clientOptions =
            options.clientOptions === undefined
              ? undefined
              : Config.isConfig(options.clientOptions)
                ? yield* options.clientOptions
                : options.clientOptions;

          return yield* makeOpcuaClient({ endpointUrl, clientOptions });
        }),
      ),
  },
);

export const layer = OpcuaClient.layer;
export const layerConfig = OpcuaClient.layerConfig;

export const makeOpcuaClient = (options: OpcuaClientLayerOptions) =>
  Effect.gen(function* () {
    const events = yield* PubSub.sliding<OpcuaClientEvent>(EVENT_BUFFER_SIZE);
    const unsafeRaw = OPCUAClient.create(options.clientOptions ?? {});
    yield* wireClientEvents(unsafeRaw, events);
    yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async (signal) => {
          const abort = () => {
            void unsafeRaw.disconnect().catch(() => undefined);
          };
          signal.addEventListener("abort", abort, { once: true });
          try {
            await unsafeRaw.connect(options.endpointUrl);
            EventBus.publishUnsafe(events, {
              _tag: "Connected",
              endpointUrl: options.endpointUrl,
            });
            return unsafeRaw;
          } finally {
            signal.removeEventListener("abort", abort);
          }
        },
        catch: (cause) => {
          EventBus.publishUnsafe(events, {
            _tag: "ConnectionFailed",
            endpointUrl: options.endpointUrl,
            cause,
          });
          return connectError({
            endpointUrl: options.endpointUrl,
            cause,
          });
        },
      }),
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
        }).pipe(Effect.ignore, Effect.andThen(PubSub.shutdown(events))),
    );
    return {
      events: Stream.fromPubSub(events),
      unsafeRaw,
    };
  });

export const make = makeOpcuaClient;
