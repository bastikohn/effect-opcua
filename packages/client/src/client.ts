import { OPCUAClient, type OPCUAClientOptions } from "node-opcua";
import { Config, Context, Effect, Layer, PubSub, Stream } from "effect";

import { EVENT_BUFFER_SIZE } from "./constants.js";
import { OpcuaConnectError, OpcuaDisconnectError } from "./errors.js";
import {
  type OpcuaClientEvent,
  publishUnsafe,
  wireClientEvents,
} from "./events.js";

export type OpcuaClient = {
  readonly events: Stream.Stream<OpcuaClientEvent>;
  readonly raw: OPCUAClient;
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

export const makeOpcuaClient = (options: OpcuaClientLayerOptions) =>
  Effect.gen(function* () {
    const events = yield* PubSub.sliding<OpcuaClientEvent>(EVENT_BUFFER_SIZE);
    const raw = OPCUAClient.create(options.clientOptions ?? {});
    wireClientEvents(raw, events);
    yield* Effect.acquireRelease(
      Effect.tryPromise({
        try: async () => {
          await raw.connect(options.endpointUrl);
          publishUnsafe(events, {
            _tag: "Connected",
            endpointUrl: options.endpointUrl,
          });
          return raw;
        },
        catch: (cause) => {
          publishUnsafe(events, {
            _tag: "ConnectionFailed",
            endpointUrl: options.endpointUrl,
            cause,
          });
          return new OpcuaConnectError({
            endpointUrl: options.endpointUrl,
            cause,
          });
        },
      }),
      () =>
        Effect.tryPromise({
          try: async () => {
            await raw.disconnect();
            publishUnsafe(events, {
              _tag: "Disconnected",
              endpointUrl: options.endpointUrl,
            });
          },
          catch: (cause) =>
            new OpcuaDisconnectError({
              endpointUrl: options.endpointUrl,
              cause,
            }),
        }).pipe(Effect.ignore, Effect.andThen(PubSub.shutdown(events))),
    );
    return {
      events: Stream.fromPubSub(events),
      raw,
    };
  });
