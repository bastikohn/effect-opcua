import type { OPCUAClient, OPCUAClientOptions } from "node-opcua";
import { type Config, Context, Effect, Layer, type Stream } from "effect";

import { makeClientService } from "./internal/client/make.js";
import type { OpcuaClientEvent } from "./internal/events/model.js";

const TypeId = "@effect-opcua/client/OpcuaClient";

export interface ClientService {
  readonly events: Stream.Stream<OpcuaClientEvent>;
  readonly unsafeRawClient: OPCUAClient;
}
export class Client extends Context.Service<Client, ClientService>()(TypeId) {}

export const make = (options: ClientLayerOptions) =>
  Effect.map(makeClientService(options), Client.of);

export type ClientLayerOptions = {
  readonly endpointUrl: string;
  readonly clientOptions?: OPCUAClientOptions;
};

export const layer = (options: ClientLayerOptions) =>
  Layer.effect(Client, make(options));

export type ClientLayerConfig = Config.Config<ClientLayerOptions>;

export const layerConfig = (config: ClientLayerConfig) =>
  Layer.effect(Client, Effect.flatMap(config, make));
