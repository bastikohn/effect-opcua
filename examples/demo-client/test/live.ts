import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, vi } from "vitest";
import { Effect, Layer, Scope } from "effect";

import {
  startDemoOpcuaServer,
  type DemoOpcuaServer,
} from "../../demo-server/src/index.js";
import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";
import { DemoMachine } from "../src/DemoMachine.js";

vi.setConfig({ testTimeout: 120_000 });

export const makeLiveTestContext = (suite: string, offset: number) => {
  let demo: DemoOpcuaServer;

  beforeEach(async () => {
    const poolId = Number(process.env.VITEST_POOL_ID ?? 0);
    const port =
      52_000 +
      ((process.pid + offset * 100 + poolId + Date.now()) % 10_000);
    const certificateRootFolder = join(
      tmpdir(),
      `effect-opcua-demo-client-${suite}-${process.pid}-${port}`,
    );
    demo = await startDemoOpcuaServer({ port, certificateRootFolder });
  }, 30_000);

  afterEach(async () => {
    await demo?.stop();
  }, 30_000);

  const makeLiveLayer = (clientId = "demo-client-vitest") =>
    DemoMachine.layerLive({ clientId }).pipe(
      Layer.provide(
        OpcuaSession.layer().pipe(
          Layer.provideMerge(
            OpcuaClient.layer({
              endpointUrl: demo.endpointUrl,
              clientOptions: { endpointMustExist: false },
            }),
          ),
        ),
      ),
    );

  const runLive = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      Scope.Scope | import("../src/DemoMachineCommands.js").DemoMachineCommands | import("../src/DemoMachineTelemetry.js").DemoMachineTelemetry
    >,
    clientId?: string,
  ) =>
    Effect.runPromise(
      Effect.scoped(effect).pipe(
        Effect.provide(makeLiveLayer(clientId)),
        Effect.timeout("90 seconds"),
      ),
    );

  return { runLive };
};
