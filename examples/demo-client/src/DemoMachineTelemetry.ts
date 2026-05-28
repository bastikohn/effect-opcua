import { Context, Effect, Layer, Stream } from "effect";

import type { DemoMachineOptions } from "./contract/options.js";
import type { DemoMachineSnapshot } from "./contract/telemetry.js";
import { DemoMachineTelemetryCore } from "./internal/telemetry-core.js";

export type DemoMachineTelemetryService = {
  readonly readSnapshot: Effect.Effect<DemoMachineSnapshot>;
  readonly watchSnapshot: Stream.Stream<DemoMachineSnapshot>;
};

export class DemoMachineTelemetry extends Context.Service<
  DemoMachineTelemetry,
  DemoMachineTelemetryService
>()("@effect-opcua/demo-client/DemoMachineTelemetry") {
  static readonly layer = Layer.effect(
    DemoMachineTelemetry,
    Effect.gen(function* () {
      const telemetry = yield* DemoMachineTelemetryCore;
      return DemoMachineTelemetry.of({
        readSnapshot: telemetry.readSnapshot,
        watchSnapshot: telemetry.watchSnapshot,
      });
    }),
  );

  static layerLive = (options: DemoMachineOptions = {}) =>
    DemoMachineTelemetry.layer.pipe(
      Layer.provide(DemoMachineTelemetryCore.layerLive(options)),
    );
}

export const readSnapshot = Effect.flatMap(
  DemoMachineTelemetry,
  (telemetry) => telemetry.readSnapshot,
);

export const watchSnapshot = Stream.unwrap(
  Effect.map(DemoMachineTelemetry, (telemetry) => telemetry.watchSnapshot),
);
