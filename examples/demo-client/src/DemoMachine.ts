import { Layer } from "effect";

import type { DemoMachineOptions } from "./contract/options.js";
import { DemoMachineCommandCore } from "./internal/command-core.js";
import { DemoMachineTelemetryCore } from "./internal/telemetry-core.js";
import { DemoMachineCommands } from "./DemoMachineCommands.js";
import { DemoMachineTelemetry } from "./DemoMachineTelemetry.js";

export class DemoMachine {
  static layerLive = (options: DemoMachineOptions = {}) => {
    const coreLayer = Layer.merge(
      DemoMachineCommandCore.layerLive(options),
      DemoMachineTelemetryCore.layerLive(options),
    );
    return Layer.merge(DemoMachineCommands.layer, DemoMachineTelemetry.layer).pipe(
      Layer.provide(coreLayer),
    );
  };
}
