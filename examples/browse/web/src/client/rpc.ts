import { BrowserSocket } from "@effect/platform-browser";
import { Context, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import {
  RpcClient,
  RpcClientError,
  RpcSerialization,
} from "effect/unstable/rpc";
import type { RpcGroup } from "effect/unstable/rpc";

import { UaBrowserRpcs } from "../shared/rpc.js";

export class UaBrowserClient extends Context.Service<
  UaBrowserClient,
  RpcClient.RpcClient<
    RpcGroup.Rpcs<typeof UaBrowserRpcs>,
    RpcClientError.RpcClientError
  >
>()("@effect-opcua/web/UaBrowserClient") {
  static layer = (url: string) =>
    Layer.effect(UaBrowserClient, RpcClient.make(UaBrowserRpcs)).pipe(
      Layer.provide(RpcClient.layerProtocolSocket()),
      Layer.provide(BrowserSocket.layerWebSocket(url)),
      Layer.provide(RpcSerialization.layerJson),
    );
}

export type ClientHandle = {
  readonly client: UaBrowserClient["Service"];
  readonly close: () => Promise<void>;
};

export const makeClientHandle = (url = rpcUrl()): Promise<ClientHandle> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.build(UaBrowserClient.layer(url)).pipe(
        Scope.provide(scope),
      );
      const client = Context.get(context, UaBrowserClient);
      return {
        client,
        close: () => Effect.runPromise(Scope.close(scope, Exit.void)),
      };
    }),
  );

export const run = <A, E>(
  effect: Effect.Effect<A, E>,
): Promise<Exit.Exit<A, E>> => Effect.runPromiseExit(effect);

export const runFork = <A, E>(effect: Effect.Effect<A, E>): Fiber.Fiber<A, E> =>
  Effect.runFork(effect);

export const awaitFiber = <A, E>(
  fiber: Fiber.Fiber<A, E>,
): Promise<Exit.Exit<A, E>> => Effect.runPromise(Fiber.await(fiber));

export const runStream = <A, E>(
  stream: Stream.Stream<A, E>,
  onSample: (sample: A) => void,
  onError: (error: E) => void,
): Fiber.Fiber<void, never> =>
  Effect.runFork(
    stream.pipe(
      Stream.runForEach((sample) => Effect.sync(() => onSample(sample))),
      Effect.matchEffect({
        onFailure: (error) => Effect.sync(() => onError(error)),
        onSuccess: () => Effect.void,
      }),
    ),
  );

export const interrupt = (fiber: Fiber.Fiber<unknown, unknown>) => {
  Effect.runFork(Fiber.interrupt(fiber));
};

const rpcUrl = () => {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/rpc`;
};
