import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, vi } from "vitest";
import { Effect, Layer, Scope } from "effect";

import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";

import {
  startDemoOpcuaServer,
  type DemoOpcuaServer,
} from "../../../examples/demo-machine/server/src/index.js";

vi.setConfig({ testTimeout: 30_000 });

export const makeLiveTestContext = (suite: string, offset: number) => {
  let demo: DemoOpcuaServer;

  beforeAll(async () => {
    const poolId = Number(process.env.VITEST_POOL_ID ?? 0);
    const port = 50_000 + offset * 100 + poolId;
    const certificateRootFolder = join(
      tmpdir(),
      `effect-opcua-client-${suite}-${process.pid}-${port}`,
    );
    demo = await startDemoOpcuaServer({ port, certificateRootFolder });
  }, 30_000);

  afterAll(async () => {
    await demo?.stop();
  }, 30_000);

  const makeLiveLayer = () =>
    OpcuaSession.layer().pipe(
      Layer.provideMerge(
        OpcuaClient.layer({
          endpointUrl: demo.endpointUrl,
          clientOptions: { endpointMustExist: false },
        }),
      ),
    );

  const runLive = <A, E>(
    effect: Effect.Effect<A, E, OpcuaSession.Session | Scope.Scope>,
  ) =>
    Effect.runPromise(
      Effect.scoped(effect).pipe(
        Effect.provide(makeLiveLayer()),
        Effect.timeout("10 seconds"),
      ),
    );

  return { runLive };
};
