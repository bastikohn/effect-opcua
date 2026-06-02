import { BrowserSocket } from "@effect/platform-browser";
import {
  Context,
  Effect,
  Fiber,
  Layer,
  ManagedRuntime,
  Stream,
  type Exit,
} from "effect";
import {
  RpcClient,
  RpcClientError,
  RpcSerialization,
} from "effect/unstable/rpc";
import type { RpcGroup } from "effect/unstable/rpc";

import { UaBrowserRpcs } from "../../shared/rpc.js";

export class UaBrowserClient extends Context.Service<
  UaBrowserClient,
  RpcClient.RpcClient<
    RpcGroup.Rpcs<typeof UaBrowserRpcs>,
    RpcClientError.RpcClientError
  >
>()("@effect-opcua/web/UaBrowserClient") {
  static layer = (url: string) =>
    Layer.effect(
      UaBrowserClient,
      RpcClient.make(UaBrowserRpcs, { spanPrefix: "web.client.rpc" }),
    ).pipe(
      Layer.provide(RpcClient.layerProtocolSocket()),
      Layer.provide(BrowserSocket.layerWebSocket(url)),
      Layer.provide(RpcSerialization.layerJson),
    );
}

export type HmiFiber<A = unknown, E = unknown> = Fiber.Fiber<A, E>;

export type HmiRuntime = {
  readonly rpc: UaBrowserClient["Service"];
  readonly runExit: <A, E>(
    effect: Effect.Effect<A, E>,
  ) => Promise<Exit.Exit<A, E>>;
  readonly fork: <A, E>(effect: Effect.Effect<A, E>) => HmiFiber<A, E>;
  readonly awaitFiber: <A, E>(
    fiber: HmiFiber<A, E>,
  ) => Promise<Exit.Exit<A, E>>;
  readonly interrupt: (fiber: HmiFiber) => void;
  readonly runStream: <A, E>(
    stream: Stream.Stream<A, E>,
    onSample: (sample: A) => void,
    onError: (error: E) => void,
  ) => HmiFiber<void, never>;
  readonly dispose: () => Promise<void>;
};

export const makeHmiRuntime = async (url = rpcUrl()): Promise<HmiRuntime> => {
  const managed = ManagedRuntime.make(UaBrowserClient.layer(url));
  const context = await managed.context();
  const rpc = Context.get(context, UaBrowserClient);
  return {
    rpc,
    runExit: (effect) => managed.runPromiseExit(effect),
    fork: (effect) => managed.runFork(effect),
    awaitFiber: (fiber) => Effect.runPromise(Fiber.await(fiber)),
    interrupt: (fiber) => {
      Effect.runFork(Fiber.interrupt(fiber));
    },
    runStream: (stream, onSample, onError) =>
      managed.runFork(
        stream.pipe(
          Stream.runForEach((sample) => Effect.sync(() => onSample(sample))),
          Effect.matchEffect({
            onFailure: (error) => Effect.sync(() => onError(error)),
            onSuccess: () => Effect.void,
          }),
        ),
      ),
    dispose: () => managed.dispose(),
  };
};

const rpcUrl = () => {
  const configured = import.meta.env.VITE_EFFECT_OPCUA_RPC_URL as
    | string
    | undefined;
  if (configured && configured.length > 0) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/rpc`;
};
