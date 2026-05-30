import { Effect } from "effect";
import { describe, expect, it } from "tstyche";

import * as Root from "../src/index.js";
import * as Generated from "../src/generated/index.js";
import type { DemoMachineCommandsService } from "../src/DemoMachineCommands.js";
import type { DemoMachineTelemetryService } from "../src/DemoMachineTelemetry.js";

declare const commands: DemoMachineCommandsService;
declare const telemetry: DemoMachineTelemetryService;

const runConfiguration = {
  productName: "Water",
  targetFillVolumeMl: 250,
  fillToleranceMl: 2,
  pumpRateMlPerSecond: 50,
  batchSize: 3,
  xAxisSpeedMmPerSecond: 200,
  zAxisSpeedMmPerSecond: 100,
} as const;

describe("Demo client", () => {
  it("checks command service types", () => {
    expect(commands.machine.configure).type.toBeCallableWith(runConfiguration);
    expect(commands.machine.configure).type.toBeCallableWith(runConfiguration, {
      commandId: "diagnostic-id",
    });
    expect(commands.manual.moveXAxisToTarget).type.toBeCallableWith({
      target: "Load",
      velocityMmPerSecond: 100,
    });
    expect(commands.maintenance.homeAxes).type.toBeCallableWith({
      axisSelection: "Both",
    });
    expect(commands.submit).type.toBeCallableWith({ _tag: "MachineHome" });

    expect(commands.machine.configure).type.not.toBeCallableWith({
      ...runConfiguration,
      commandId: "raw",
    });
    expect(commands.manual.moveXAxisToTarget).type.not.toBeCallableWith({
      target: 2,
      velocityMmPerSecond: 100,
    });
    expect(commands.submit).type.not.toBeCallableWith({
      _tag: "MachineHome",
      commandKind: 102,
    });
  });

  it("checks command status service types", () => {
    Effect.map(commands.readCommandStatus, (status) => {
      expect(status.entries[0]?.state).type.toBeAssignableTo<string>();
      expect(status.entries[0]?.state).type.not.toBeAssignableTo<number>();
    });
  });

  it("checks telemetry service types", () => {
    Effect.map(telemetry.readSnapshot, (snapshot) => {
      expect(snapshot.revision).type.toBe<bigint>();
    });
  });

  it("checks generated escape hatch types", () => {
    const raw: Generated.Structures.CommandStatusBuffer = {
      revision: 1,
      capacity: 8,
      entries: [],
    };

    expect(raw).type.toBe<Generated.Structures.CommandStatusBuffer>();
    expect<typeof Generated.Variables.Commands>().type.toHaveProperty("Status");
    expect<typeof Root>().type.not.toHaveProperty("Variables");
  });
});
