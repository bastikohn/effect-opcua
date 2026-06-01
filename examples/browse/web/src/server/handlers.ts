import { Effect, Layer, Queue, Stream } from "effect";
import { Rpc, RpcServer } from "effect/unstable/rpc";

import {
  UaBrowserRpcs,
  WebRpcError,
  type ConnectRequest,
} from "../shared/rpc.js";
import {
  browseNode,
  monitorValues,
  readNode,
  writeNode,
} from "./dto.js";
import { SessionRegistry, rpcError } from "./session-registry.js";

export const UaBrowserHandlers = UaBrowserRpcs.toLayer(
  Effect.gen(function* () {
    const registry = yield* SessionRegistry;
    return UaBrowserRpcs.of({
      Connect: (request: ConnectRequest, { client }) =>
        Effect.gen(function* () {
          const session = yield* registry.connect(client.id, request);
          return yield* readNode(session, request.startNodeId ?? "i=85");
        }).pipe(Effect.onInterrupt(() => registry.cleanup(client.id))),
      Disconnect: (_payload, { client }) =>
        Effect.map(registry.disconnect(client.id), (disconnected) => ({
          disconnected,
        })),
      Browse: ({ nodeId }, { client }) =>
        Effect.gen(function* () {
          const session = yield* registry.get(client.id);
          return yield* browseNode(session, nodeId);
        }),
      ReadNode: ({ nodeId }, { client }) =>
        Effect.gen(function* () {
          const session = yield* registry.get(client.id);
          return yield* readNode(session, nodeId);
        }),
      WriteNode: ({ nodeId, value }, { client }) =>
        Effect.gen(function* () {
          const session = yield* registry.get(client.id);
          return yield* writeNode(session, nodeId, value);
        }),
      MonitorValues: ({ nodeIds, samplingIntervalMs }, { client }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            if (nodeIds.length === 0) {
              return yield* Effect.fail(
                new WebRpcError({
                  message: "At least one nodeId is required",
                  operation: "MonitorValues",
                }),
              );
            }
            const session = yield* registry.get(client.id);
            return yield* monitorValues(session, {
              nodeIds,
              samplingIntervalMs: Math.max(50, samplingIntervalMs),
            });
          }),
        ).pipe(
          Stream.mapError((cause) =>
            cause instanceof WebRpcError
              ? cause
              : rpcError("MonitorValues", undefined, cause),
          ),
        ),
    });
  }),
);

export const UaBrowserRpcLive = RpcServer.layer(UaBrowserRpcs, {
  disableFatalDefects: true,
}).pipe(Layer.provide(UaBrowserHandlers));

export const withClientCleanup = <E, R>(
  protocol: Layer.Layer<RpcServer.Protocol, E, R>,
) =>
  Layer.effect(
    RpcServer.Protocol,
    Effect.gen(function* () {
      const base = yield* RpcServer.Protocol;
      const registry = yield* SessionRegistry;
      const forwarded = yield* Queue.make<number>();
      yield* Effect.forkScoped(
        Effect.forever(
          Effect.flatMap(Queue.take(base.disconnects), (clientId) =>
            registry.cleanup(clientId).pipe(
              Effect.andThen(Queue.offer(forwarded, clientId)),
            ),
          ),
        ),
      );
      return {
        ...base,
        disconnects: forwarded,
      };
    }),
  ).pipe(Layer.provide(protocol));
