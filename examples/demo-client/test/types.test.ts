import { Effect } from "effect";

import * as Root from "../src/index.js";
import * as Generated from "../src/generated/index.js";
import type {
  DemoMachineCommandsService,
} from "../src/DemoMachineCommands.js";
import type {
  DemoMachineTelemetryService,
} from "../src/DemoMachineTelemetry.js";

const runConfiguration = {
  productName: "Water",
  targetFillVolumeMl: 250,
  fillToleranceMl: 2,
  pumpRateMlPerSecond: 50,
  batchSize: 3,
  xAxisSpeedMmPerSecond: 200,
  zAxisSpeedMmPerSecond: 100,
} as const;

const expectCommandTypes = (commands: DemoMachineCommandsService) => {
  commands.machine.configure(runConfiguration);
  commands.machine.configure(runConfiguration, { commandId: "diagnostic-id" });
  commands.manual.moveXAxisToTarget({
    target: "Load",
    velocityMmPerSecond: 100,
  });
  commands.maintenance.homeAxes({ axisSelection: "Both" });
  commands.submit({ _tag: "MachineHome" });

  // @ts-expect-error grouped inputs do not expose raw correlation fields
  commands.machine.configure({ ...runConfiguration, commandId: "raw" });

  // @ts-expect-error grouped inputs use semantic names, not raw enum numbers
  commands.manual.moveXAxisToTarget({ target: 2, velocityMmPerSecond: 100 });

  // @ts-expect-error submit accepts only the tagged schema-backed command union
  commands.submit({ _tag: "MachineHome", commandKind: 102 });
};

void expectCommandTypes;

const expectTelemetryTypes = (telemetry: DemoMachineTelemetryService) => {
  Effect.map(telemetry.readCommandStatus, (status) => {
    const state: string | undefined = status.entries[0]?.state;
    void state;

    // @ts-expect-error curated command status exposes string states, not raw numbers
    const rawState: number | undefined = status.entries[0]?.state;
    void rawState;
  });
};

void expectTelemetryTypes;

const expectGeneratedEscapeHatch = () => {
  const raw: Generated.Structures.RawCommandStatusBuffer = {
    revision: 1,
    capacity: 8,
    entries: [],
  };
  void raw;
  void Generated.Variables.Variables.Commands.Status;

  // @ts-expect-error root exports curated APIs, not generated variable internals
  void Root.Variables;
};

void expectGeneratedEscapeHatch;
