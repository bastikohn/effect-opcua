import { Effect, Layer, Queue, Stream } from "effect";
import { Rpc, RpcServer } from "effect/unstable/rpc";

import {
  UaBrowserRpcs,
  WebRpcError,
  type ConnectRequest,
} from "../shared/rpc.js";
import {
  browseContinuation,
  browseNode,
  monitorValues,
  readNode,
  writeNode,
  type BrowsePage,
} from "./dto.js";
import {
  SessionRegistry,
  rpcError,
  type SessionRegistryService,
} from "./session-registry.js";
import { readWritePolicy } from "./config.js";

const DEFAULT_MAX_REFERENCES_PER_NODE = 100;

export const UaBrowserHandlers = UaBrowserRpcs.toLayer(
  Effect.gen(function* () {
    const registry = yield* SessionRegistry;
    return UaBrowserRpcs.of({
      GetConfig: () =>
        Effect.succeed({
          writePolicy: readWritePolicy(),
        }),
      Connect: (request: ConnectRequest, { client }) =>
        Effect.gen(function* () {
          yield* registry.connect(client.id, request);
          return { connected: true as const, endpointUrl: request.endpointUrl };
        }).pipe(Effect.onInterrupt(() => registry.cleanup(client.id))),
      Disconnect: (_payload, { client }) =>
        Effect.map(registry.disconnect(client.id), (disconnected) => ({
          disconnected,
        })),
      Browse: (
        { nodeId, maxReferencesPerNode, continuationToken },
        { client },
      ) =>
        Effect.gen(function* () {
          const session = yield* registry.get(client.id);
          if (!continuationToken) {
            yield* registry.releaseContinuations(client.id, nodeId);
          }
          const page = continuationToken
            ? yield* browseContinuation(
                session,
                yield* registry.takeContinuation(client.id, continuationToken),
              )
            : yield* browseNode(
                session,
                nodeId,
                maxReferencesPerNode ?? DEFAULT_MAX_REFERENCES_PER_NODE,
              );
          return yield* withContinuationToken(registry, client.id, page);
        }),
      ReleaseBrowseContinuation: ({ continuationToken }, { client }) =>
        Effect.map(registry.releaseContinuation(client.id, continuationToken), (released) => ({
          released,
        })),
      ReadNode: ({ nodeId }, { client }) =>
        Effect.gen(function* () {
          const session = yield* registry.get(client.id);
          return yield* readNode(session, nodeId);
        }),
      WriteNode: ({ nodeId, value }, { client }) =>
        Effect.gen(function* () {
          const writePolicy = readWritePolicy();
          if (writePolicy._tag === "Disabled") {
            return yield* Effect.fail(
              new WebRpcError({
                category: "Configuration",
                message: "Writes are disabled by server policy",
                operation: "WriteNode",
                nodeId,
              }),
            );
          }
          const session = yield* registry.get(client.id);
          return yield* writeNode(session, nodeId, value);
        }),
      MonitorValues: ({ nodeIds, samplingIntervalMs }, { client }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            if (nodeIds.length === 0) {
              return yield* Effect.fail(
                new WebRpcError({
                  category: "Configuration",
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

const withContinuationToken = (
  registry: SessionRegistryService,
  clientId: number,
  page: BrowsePage,
) =>
  page.response._tag === "Browsed" && page.continuation
    ? Effect.map(
        registry.storeContinuation(clientId, page.continuation),
        (continuationToken) => ({
          ...page.response,
          continuationToken,
        }),
      )
    : Effect.succeed(page.response);

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
