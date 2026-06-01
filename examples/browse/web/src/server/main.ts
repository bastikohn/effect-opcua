import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";
import { createServer } from "node:http";

import {
  UaBrowserRpcLive,
  withClientCleanup,
} from "./handlers.js";
import { SessionRegistry } from "./session-registry.js";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 4123);

const RpcProtocol = withClientCleanup(
  RpcServer.layerProtocolWebsocket({ path: "/rpc" }).pipe(
    Layer.provide(HttpRouter.layer),
  ),
);

export const ServerLive = UaBrowserRpcLive.pipe(
  Layer.provideMerge(RpcProtocol),
  Layer.provide(HttpRouter.serve(RpcProtocol)),
  Layer.provide(SessionRegistry.live),
  Layer.provide(NodeHttpServer.layer(createServer, { host, port })),
  Layer.provide(RpcSerialization.layerJson),
);

NodeRuntime.runMain(
  Effect.log(`Effect OPC UA web RPC listening on ws://${host}:${port}/rpc`)
    .pipe(Effect.andThen(Layer.launch(ServerLive))),
);
