import type { Duration } from "effect";

import type { DemoMachineCommand } from "../contract/commands.js";
import * as Enums from "../generated/enums.js";

export type CommandSpec<
  Tag extends DemoMachineCommand["_tag"] = DemoMachineCommand["_tag"],
  Input extends DemoMachineCommand = Extract<DemoMachineCommand, { _tag: Tag }>,
> = {
  readonly tag: Tag;
  readonly kind: Enums.GlobalCommandKind;
  readonly domain: "machine" | "manual" | "maintenance";
  readonly buildPayload?: (input: Input) => unknown;
  readonly timeouts?: {
    readonly observedTimeout?: Duration.Input;
    readonly timeout?: Duration.Input;
  };
};

export const commandSpecs = {
  MachineSetMode: spec("MachineSetMode", {
    kind: Enums.GlobalCommandKind.MachineSetMode,
    domain: "machine",
    buildPayload: (input) => ({
      targetMode: Enums.OperatingMode[input.targetMode],
    }),
  }),
  MachineConfigure: spec("MachineConfigure", {
    kind: Enums.GlobalCommandKind.MachineConfigure,
    domain: "machine",
    buildPayload: (input) => ({
      configuration: input.runConfiguration,
    }),
  }),
  MachineHome: spec("MachineHome", {
    kind: Enums.GlobalCommandKind.MachineHome,
    domain: "machine",
  }),
  MachineStart: spec("MachineStart", {
    kind: Enums.GlobalCommandKind.MachineStart,
    domain: "machine",
  }),
  MachinePause: spec("MachinePause", {
    kind: Enums.GlobalCommandKind.MachinePause,
    domain: "machine",
  }),
  MachineResume: spec("MachineResume", {
    kind: Enums.GlobalCommandKind.MachineResume,
    domain: "machine",
  }),
  MachineAbort: spec("MachineAbort", {
    kind: Enums.GlobalCommandKind.MachineAbort,
    domain: "machine",
  }),
  MachineReset: spec("MachineReset", {
    kind: Enums.GlobalCommandKind.MachineReset,
    domain: "machine",
  }),
  MachineClearCompleted: spec("MachineClearCompleted", {
    kind: Enums.GlobalCommandKind.MachineClearCompleted,
    domain: "machine",
  }),
  MachineAcknowledgeSafetyReset: spec("MachineAcknowledgeSafetyReset", {
    kind: Enums.GlobalCommandKind.MachineAcknowledgeSafetyReset,
    domain: "machine",
  }),
  ManualHomeX: spec("ManualHomeX", {
    kind: Enums.GlobalCommandKind.ManualHomeX,
    domain: "manual",
  }),
  ManualHomeZ: spec("ManualHomeZ", {
    kind: Enums.GlobalCommandKind.ManualHomeZ,
    domain: "manual",
  }),
  ManualMoveXAxisToTarget: targetSpec(
    "ManualMoveXAxisToTarget",
    Enums.GlobalCommandKind.ManualMoveXAxisToTarget,
    "manual",
    Enums.XAxisTarget,
  ),
  ManualMoveXAxisToPosition: positionSpec(
    "ManualMoveXAxisToPosition",
    Enums.GlobalCommandKind.ManualMoveXAxisToPosition,
    "manual",
  ),
  ManualMoveZAxisToTarget: targetSpec(
    "ManualMoveZAxisToTarget",
    Enums.GlobalCommandKind.ManualMoveZAxisToTarget,
    "manual",
    Enums.ZAxisTarget,
  ),
  ManualMoveZAxisToPosition: positionSpec(
    "ManualMoveZAxisToPosition",
    Enums.GlobalCommandKind.ManualMoveZAxisToPosition,
    "manual",
  ),
  ManualJogXPositive: jogSpec(
    "ManualJogXPositive",
    Enums.GlobalCommandKind.ManualJogXPositive,
    "manual",
  ),
  ManualJogXNegative: jogSpec(
    "ManualJogXNegative",
    Enums.GlobalCommandKind.ManualJogXNegative,
    "manual",
  ),
  ManualJogZPositive: jogSpec(
    "ManualJogZPositive",
    Enums.GlobalCommandKind.ManualJogZPositive,
    "manual",
  ),
  ManualJogZNegative: jogSpec(
    "ManualJogZNegative",
    Enums.GlobalCommandKind.ManualJogZNegative,
    "manual",
  ),
  ManualOpenClamp: spec("ManualOpenClamp", {
    kind: Enums.GlobalCommandKind.ManualOpenClamp,
    domain: "manual",
  }),
  ManualCloseClamp: spec("ManualCloseClamp", {
    kind: Enums.GlobalCommandKind.ManualCloseClamp,
    domain: "manual",
  }),
  ManualPrimePump: spec("ManualPrimePump", {
    kind: Enums.GlobalCommandKind.ManualPrimePump,
    domain: "manual",
  }),
  ManualStopPump: spec("ManualStopPump", {
    kind: Enums.GlobalCommandKind.ManualStopPump,
    domain: "manual",
  }),
  ManualOpenNozzleValve: spec("ManualOpenNozzleValve", {
    kind: Enums.GlobalCommandKind.ManualOpenNozzleValve,
    domain: "manual",
  }),
  ManualCloseNozzleValve: spec("ManualCloseNozzleValve", {
    kind: Enums.GlobalCommandKind.ManualCloseNozzleValve,
    domain: "manual",
  }),
  ManualTriggerInspectionOnce: spec("ManualTriggerInspectionOnce", {
    kind: Enums.GlobalCommandKind.ManualTriggerInspectionOnce,
    domain: "manual",
  }),
  ManualClearActuatorFault: spec("ManualClearActuatorFault", {
    kind: Enums.GlobalCommandKind.ManualClearActuatorFault,
    domain: "manual",
    buildPayload: (input) => ({
      actuator: Enums.ActuatorId[input.actuator],
    }),
  }),
  MaintenanceRefillTank: spec("MaintenanceRefillTank", {
    kind: Enums.GlobalCommandKind.MaintenanceRefillTank,
    domain: "maintenance",
  }),
  MaintenanceDrainTank: spec("MaintenanceDrainTank", {
    kind: Enums.GlobalCommandKind.MaintenanceDrainTank,
    domain: "maintenance",
  }),
  MaintenancePrimePump: spec("MaintenancePrimePump", {
    kind: Enums.GlobalCommandKind.MaintenancePrimePump,
    domain: "maintenance",
  }),
  MaintenanceCleanNozzle: spec("MaintenanceCleanNozzle", {
    kind: Enums.GlobalCommandKind.MaintenanceCleanNozzle,
    domain: "maintenance",
  }),
  MaintenanceResetPumpFault: spec("MaintenanceResetPumpFault", {
    kind: Enums.GlobalCommandKind.MaintenanceResetPumpFault,
    domain: "maintenance",
  }),
  MaintenanceResetValveFault: spec("MaintenanceResetValveFault", {
    kind: Enums.GlobalCommandKind.MaintenanceResetValveFault,
    domain: "maintenance",
  }),
  MaintenanceCalibrateFillLevelSensor: spec(
    "MaintenanceCalibrateFillLevelSensor",
    {
      kind: Enums.GlobalCommandKind.MaintenanceCalibrateFillLevelSensor,
      domain: "maintenance",
    },
  ),
  MaintenanceSimulateSensorCheck: spec("MaintenanceSimulateSensorCheck", {
    kind: Enums.GlobalCommandKind.MaintenanceSimulateSensorCheck,
    domain: "maintenance",
  }),
  MaintenanceResetInspectionFault: spec("MaintenanceResetInspectionFault", {
    kind: Enums.GlobalCommandKind.MaintenanceResetInspectionFault,
    domain: "maintenance",
  }),
  MaintenanceMoveXAxisToTarget: targetSpec(
    "MaintenanceMoveXAxisToTarget",
    Enums.GlobalCommandKind.MaintenanceMoveXAxisToTarget,
    "maintenance",
    Enums.XAxisTarget,
  ),
  MaintenanceMoveXAxisToPosition: positionSpec(
    "MaintenanceMoveXAxisToPosition",
    Enums.GlobalCommandKind.MaintenanceMoveXAxisToPosition,
    "maintenance",
  ),
  MaintenanceMoveZAxisToTarget: targetSpec(
    "MaintenanceMoveZAxisToTarget",
    Enums.GlobalCommandKind.MaintenanceMoveZAxisToTarget,
    "maintenance",
    Enums.ZAxisTarget,
  ),
  MaintenanceMoveZAxisToPosition: positionSpec(
    "MaintenanceMoveZAxisToPosition",
    Enums.GlobalCommandKind.MaintenanceMoveZAxisToPosition,
    "maintenance",
  ),
  MaintenanceJogXPositive: jogSpec(
    "MaintenanceJogXPositive",
    Enums.GlobalCommandKind.MaintenanceJogXPositive,
    "maintenance",
  ),
  MaintenanceJogXNegative: jogSpec(
    "MaintenanceJogXNegative",
    Enums.GlobalCommandKind.MaintenanceJogXNegative,
    "maintenance",
  ),
  MaintenanceJogZPositive: jogSpec(
    "MaintenanceJogZPositive",
    Enums.GlobalCommandKind.MaintenanceJogZPositive,
    "maintenance",
  ),
  MaintenanceJogZNegative: jogSpec(
    "MaintenanceJogZNegative",
    Enums.GlobalCommandKind.MaintenanceJogZNegative,
    "maintenance",
  ),
  MaintenanceHomeAxes: axisSelectionSpec(
    "MaintenanceHomeAxes",
    Enums.GlobalCommandKind.MaintenanceHomeAxes,
  ),
  MaintenanceEnableAxes: axisSelectionSpec(
    "MaintenanceEnableAxes",
    Enums.GlobalCommandKind.MaintenanceEnableAxes,
  ),
  MaintenanceDisableAxes: axisSelectionSpec(
    "MaintenanceDisableAxes",
    Enums.GlobalCommandKind.MaintenanceDisableAxes,
  ),
  MaintenanceClearAxisFault: axisSelectionSpec(
    "MaintenanceClearAxisFault",
    Enums.GlobalCommandKind.MaintenanceClearAxisFault,
  ),
  MaintenanceOpenClamp: spec("MaintenanceOpenClamp", {
    kind: Enums.GlobalCommandKind.MaintenanceOpenClamp,
    domain: "maintenance",
  }),
  MaintenanceCloseClamp: spec("MaintenanceCloseClamp", {
    kind: Enums.GlobalCommandKind.MaintenanceCloseClamp,
    domain: "maintenance",
  }),
  MaintenanceClearClampFault: spec("MaintenanceClearClampFault", {
    kind: Enums.GlobalCommandKind.MaintenanceClearClampFault,
    domain: "maintenance",
  }),
} satisfies {
  readonly [Tag in DemoMachineCommand["_tag"]]: CommandSpec<Tag>;
};

export const getCommandSpec = <Tag extends DemoMachineCommand["_tag"]>(
  tag: Tag,
) => commandSpecs[tag] as CommandSpec<Tag>;

function spec<Tag extends DemoMachineCommand["_tag"]>(
  tag: Tag,
  value: Omit<CommandSpec<Tag>, "tag">,
): CommandSpec<Tag> {
  return { tag, ...value };
}

function targetSpec<
  Tag extends
    | "ManualMoveXAxisToTarget"
    | "ManualMoveZAxisToTarget"
    | "MaintenanceMoveXAxisToTarget"
    | "MaintenanceMoveZAxisToTarget",
>(
  tag: Tag,
  kind: Enums.GlobalCommandKind,
  domain: "manual" | "maintenance",
  targetEnum: Record<string, number>,
) {
  return spec(tag, {
    kind,
    domain,
    buildPayload: (input) => ({
      target: targetEnum[(input as { readonly target: string }).target],
      velocityMmPerSecond: (input as { readonly velocityMmPerSecond: number })
        .velocityMmPerSecond,
    }),
  });
}

function positionSpec<
  Tag extends
    | "ManualMoveXAxisToPosition"
    | "ManualMoveZAxisToPosition"
    | "MaintenanceMoveXAxisToPosition"
    | "MaintenanceMoveZAxisToPosition",
>(tag: Tag, kind: Enums.GlobalCommandKind, domain: "manual" | "maintenance") {
  return spec(tag, {
    kind,
    domain,
    buildPayload: (input) => ({
      targetPositionMm: (input as { readonly targetPositionMm: number })
        .targetPositionMm,
      velocityMmPerSecond: (input as { readonly velocityMmPerSecond: number })
        .velocityMmPerSecond,
    }),
  });
}

function jogSpec<
  Tag extends
    | "ManualJogXPositive"
    | "ManualJogXNegative"
    | "ManualJogZPositive"
    | "ManualJogZNegative"
    | "MaintenanceJogXPositive"
    | "MaintenanceJogXNegative"
    | "MaintenanceJogZPositive"
    | "MaintenanceJogZNegative",
>(tag: Tag, kind: Enums.GlobalCommandKind, domain: "manual" | "maintenance") {
  return spec(tag, {
    kind,
    domain,
    buildPayload: (input) => ({
      velocityMmPerSecond: (input as { readonly velocityMmPerSecond: number })
        .velocityMmPerSecond,
      maxDurationMs: (input as { readonly maxDurationMs: number })
        .maxDurationMs,
    }),
  });
}

function axisSelectionSpec<
  Tag extends
    | "MaintenanceHomeAxes"
    | "MaintenanceEnableAxes"
    | "MaintenanceDisableAxes"
    | "MaintenanceClearAxisFault",
>(tag: Tag, kind: Enums.GlobalCommandKind) {
  return spec(tag, {
    kind,
    domain: "maintenance",
    buildPayload: (input) => ({
      axisSelection:
        Enums.AxisSelection[
          (
            input as {
              readonly axisSelection: keyof typeof Enums.AxisSelection;
            }
          ).axisSelection
        ],
    }),
  });
}
