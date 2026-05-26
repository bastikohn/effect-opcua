import { Context, Effect, Layer, Stream } from "effect";

import type { CommandStatusBuffer } from "./contract/command-status.js";
import type { DemoMachineOptions } from "./contract/options.js";
import type { DemoMachineSnapshot } from "./contract/telemetry.js";
import { DemoMachineCommandCore } from "./internal/command-core.js";
import { DemoMachineTelemetryCore } from "./internal/telemetry-core.js";

export type DemoMachineTelemetryService = {
  readonly readSnapshot: Effect.Effect<DemoMachineSnapshot>;
  readonly watchSnapshot: Stream.Stream<DemoMachineSnapshot>;
  readonly readCommandStatus: Effect.Effect<CommandStatusBuffer>;
  readonly watchCommandStatus: Stream.Stream<CommandStatusBuffer>;
};

export class DemoMachineTelemetry extends Context.Service<
  DemoMachineTelemetry,
  DemoMachineTelemetryService
>()("@effect-opcua/demo-client/DemoMachineTelemetry") {
  static readonly layer = Layer.effect(
    DemoMachineTelemetry,
    Effect.gen(function* () {
      const telemetry = yield* DemoMachineTelemetryCore;
      const commands = yield* DemoMachineCommandCore;
      return DemoMachineTelemetry.of({
        readSnapshot: telemetry.readSnapshot,
        watchSnapshot: telemetry.watchSnapshot,
        readCommandStatus: commands.readStatus,
        watchCommandStatus: commands.watchStatus,
      });
    }),
  );

  static layerLive = (options: DemoMachineOptions = {}) =>
    DemoMachineTelemetry.layer.pipe(
      Layer.provide(
        Layer.merge(
          DemoMachineCommandCore.layerLive(options),
          DemoMachineTelemetryCore.layerLive(options),
        ),
      ),
    );
}

export const readSnapshot = Effect.flatMap(
  DemoMachineTelemetry,
  (telemetry) => telemetry.readSnapshot,
);

export const watchSnapshot = Stream.unwrap(
  Effect.map(DemoMachineTelemetry, (telemetry) => telemetry.watchSnapshot),
);

export const readCommandStatus = Effect.flatMap(
  DemoMachineTelemetry,
  (telemetry) => telemetry.readCommandStatus,
);

export const watchCommandStatus = Stream.unwrap(
  Effect.map(DemoMachineTelemetry, (telemetry) => telemetry.watchCommandStatus),
);
