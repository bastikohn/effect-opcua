import type { Duration } from "effect";

import type { DemoMachineCommand } from "../contract/commands.js";
import * as Enums from "../generated/enums.js";

export type CommandSpec<
  Tag extends DemoMachineCommand["_tag"] = DemoMachineCommand["_tag"],
  Input extends DemoMachineCommand = Extract<DemoMachineCommand, { _tag: Tag }>,
> = {
  readonly tag: Tag;
  readonly kind: Enums.GlobalCommandKindValue;
  readonly domain: "machine" | "manual" | "maintenance";
  readonly buildPayload?: (input: Input) => unknown;
  readonly timeouts?: {
    readonly observedTimeout?: Duration.Input;
    readonly timeout?: Duration.Input;
  };
};

export const commandSpecs = {
  MachineSetMode: spec("MachineSetMode", {
    kind: Enums.GlobalCommandKind.Machine_SetMode,
    domain: "machine",
    buildPayload: (input) => ({
      targetMode: Enums.OperatingMode[input.targetMode],
    }),
  }),
  MachineConfigure: spec("MachineConfigure", {
    kind: Enums.GlobalCommandKind.Machine_Configure,
    domain: "machine",
    buildPayload: (input) => ({
      configuration: input.runConfiguration,
    }),
  }),
  MachineHome: spec("MachineHome", {
    kind: Enums.GlobalCommandKind.Machine_Home,
    domain: "machine",
  }),
  MachineStart: spec("MachineStart", {
    kind: Enums.GlobalCommandKind.Machine_Start,
    domain: "machine",
  }),
  MachinePause: spec("MachinePause", {
    kind: Enums.GlobalCommandKind.Machine_Pause,
    domain: "machine",
  }),
  MachineResume: spec("MachineResume", {
    kind: Enums.GlobalCommandKind.Machine_Resume,
    domain: "machine",
  }),
  MachineAbort: spec("MachineAbort", {
    kind: Enums.GlobalCommandKind.Machine_Abort,
    domain: "machine",
  }),
  MachineReset: spec("MachineReset", {
    kind: Enums.GlobalCommandKind.Machine_Reset,
    domain: "machine",
  }),
  MachineClearCompleted: spec("MachineClearCompleted", {
    kind: Enums.GlobalCommandKind.Machine_ClearCompleted,
    domain: "machine",
  }),
  MachineAcknowledgeSafetyReset: spec("MachineAcknowledgeSafetyReset", {
    kind: Enums.GlobalCommandKind.Machine_AcknowledgeSafetyReset,
    domain: "machine",
  }),
  ManualHomeX: spec("ManualHomeX", {
    kind: Enums.GlobalCommandKind.Manual_HomeX,
    domain: "manual",
  }),
  ManualHomeZ: spec("ManualHomeZ", {
    kind: Enums.GlobalCommandKind.Manual_HomeZ,
    domain: "manual",
  }),
  ManualMoveXAxisToTarget: targetSpec(
    "ManualMoveXAxisToTarget",
    Enums.GlobalCommandKind.Manual_MoveXAxisToTarget,
    "manual",
    Enums.XAxisTarget,
  ),
  ManualMoveXAxisToPosition: positionSpec(
    "ManualMoveXAxisToPosition",
    Enums.GlobalCommandKind.Manual_MoveXAxisToPosition,
    "manual",
  ),
  ManualMoveZAxisToTarget: targetSpec(
    "ManualMoveZAxisToTarget",
    Enums.GlobalCommandKind.Manual_MoveZAxisToTarget,
    "manual",
    Enums.ZAxisTarget,
  ),
  ManualMoveZAxisToPosition: positionSpec(
    "ManualMoveZAxisToPosition",
    Enums.GlobalCommandKind.Manual_MoveZAxisToPosition,
    "manual",
  ),
  ManualJogXPositive: jogSpec(
    "ManualJogXPositive",
    Enums.GlobalCommandKind.Manual_JogXPositive,
    "manual",
  ),
  ManualJogXNegative: jogSpec(
    "ManualJogXNegative",
    Enums.GlobalCommandKind.Manual_JogXNegative,
    "manual",
  ),
  ManualJogZPositive: jogSpec(
    "ManualJogZPositive",
    Enums.GlobalCommandKind.Manual_JogZPositive,
    "manual",
  ),
  ManualJogZNegative: jogSpec(
    "ManualJogZNegative",
    Enums.GlobalCommandKind.Manual_JogZNegative,
    "manual",
  ),
  ManualOpenClamp: spec("ManualOpenClamp", {
    kind: Enums.GlobalCommandKind.Manual_OpenClamp,
    domain: "manual",
  }),
  ManualCloseClamp: spec("ManualCloseClamp", {
    kind: Enums.GlobalCommandKind.Manual_CloseClamp,
    domain: "manual",
  }),
  ManualPrimePump: spec("ManualPrimePump", {
    kind: Enums.GlobalCommandKind.Manual_PrimePump,
    domain: "manual",
  }),
  ManualStopPump: spec("ManualStopPump", {
    kind: Enums.GlobalCommandKind.Manual_StopPump,
    domain: "manual",
  }),
  ManualOpenNozzleValve: spec("ManualOpenNozzleValve", {
    kind: Enums.GlobalCommandKind.Manual_OpenNozzleValve,
    domain: "manual",
  }),
  ManualCloseNozzleValve: spec("ManualCloseNozzleValve", {
    kind: Enums.GlobalCommandKind.Manual_CloseNozzleValve,
    domain: "manual",
  }),
  ManualTriggerInspectionOnce: spec("ManualTriggerInspectionOnce", {
    kind: Enums.GlobalCommandKind.Manual_TriggerInspectionOnce,
    domain: "manual",
  }),
  ManualClearActuatorFault: spec("ManualClearActuatorFault", {
    kind: Enums.GlobalCommandKind.Manual_ClearActuatorFault,
    domain: "manual",
    buildPayload: (input) => ({
      actuator: Enums.ActuatorId[input.actuator],
    }),
  }),
  MaintenanceRefillTank: spec("MaintenanceRefillTank", {
    kind: Enums.GlobalCommandKind.Maintenance_RefillTank,
    domain: "maintenance",
  }),
  MaintenanceDrainTank: spec("MaintenanceDrainTank", {
    kind: Enums.GlobalCommandKind.Maintenance_DrainTank,
    domain: "maintenance",
  }),
  MaintenancePrimePump: spec("MaintenancePrimePump", {
    kind: Enums.GlobalCommandKind.Maintenance_PrimePump,
    domain: "maintenance",
  }),
  MaintenanceCleanNozzle: spec("MaintenanceCleanNozzle", {
    kind: Enums.GlobalCommandKind.Maintenance_CleanNozzle,
    domain: "maintenance",
  }),
  MaintenanceResetPumpFault: spec("MaintenanceResetPumpFault", {
    kind: Enums.GlobalCommandKind.Maintenance_ResetPumpFault,
    domain: "maintenance",
  }),
  MaintenanceResetValveFault: spec("MaintenanceResetValveFault", {
    kind: Enums.GlobalCommandKind.Maintenance_ResetValveFault,
    domain: "maintenance",
  }),
  MaintenanceCalibrateFillLevelSensor: spec(
    "MaintenanceCalibrateFillLevelSensor",
    {
      kind: Enums.GlobalCommandKind.Maintenance_CalibrateFillLevelSensor,
      domain: "maintenance",
    },
  ),
  MaintenanceSimulateSensorCheck: spec("MaintenanceSimulateSensorCheck", {
    kind: Enums.GlobalCommandKind.Maintenance_SimulateSensorCheck,
    domain: "maintenance",
  }),
  MaintenanceResetInspectionFault: spec("MaintenanceResetInspectionFault", {
    kind: Enums.GlobalCommandKind.Maintenance_ResetInspectionFault,
    domain: "maintenance",
  }),
  MaintenanceMoveXAxisToTarget: targetSpec(
    "MaintenanceMoveXAxisToTarget",
    Enums.GlobalCommandKind.Maintenance_MoveXAxisToTarget,
    "maintenance",
    Enums.XAxisTarget,
  ),
  MaintenanceMoveXAxisToPosition: positionSpec(
    "MaintenanceMoveXAxisToPosition",
    Enums.GlobalCommandKind.Maintenance_MoveXAxisToPosition,
    "maintenance",
  ),
  MaintenanceMoveZAxisToTarget: targetSpec(
    "MaintenanceMoveZAxisToTarget",
    Enums.GlobalCommandKind.Maintenance_MoveZAxisToTarget,
    "maintenance",
    Enums.ZAxisTarget,
  ),
  MaintenanceMoveZAxisToPosition: positionSpec(
    "MaintenanceMoveZAxisToPosition",
    Enums.GlobalCommandKind.Maintenance_MoveZAxisToPosition,
    "maintenance",
  ),
  MaintenanceJogXPositive: jogSpec(
    "MaintenanceJogXPositive",
    Enums.GlobalCommandKind.Maintenance_JogXPositive,
    "maintenance",
  ),
  MaintenanceJogXNegative: jogSpec(
    "MaintenanceJogXNegative",
    Enums.GlobalCommandKind.Maintenance_JogXNegative,
    "maintenance",
  ),
  MaintenanceJogZPositive: jogSpec(
    "MaintenanceJogZPositive",
    Enums.GlobalCommandKind.Maintenance_JogZPositive,
    "maintenance",
  ),
  MaintenanceJogZNegative: jogSpec(
    "MaintenanceJogZNegative",
    Enums.GlobalCommandKind.Maintenance_JogZNegative,
    "maintenance",
  ),
  MaintenanceHomeAxes: axisSelectionSpec(
    "MaintenanceHomeAxes",
    Enums.GlobalCommandKind.Maintenance_HomeAxes,
  ),
  MaintenanceEnableAxes: axisSelectionSpec(
    "MaintenanceEnableAxes",
    Enums.GlobalCommandKind.Maintenance_EnableAxes,
  ),
  MaintenanceDisableAxes: axisSelectionSpec(
    "MaintenanceDisableAxes",
    Enums.GlobalCommandKind.Maintenance_DisableAxes,
  ),
  MaintenanceClearAxisFault: axisSelectionSpec(
    "MaintenanceClearAxisFault",
    Enums.GlobalCommandKind.Maintenance_ClearAxisFault,
  ),
  MaintenanceOpenClamp: spec("MaintenanceOpenClamp", {
    kind: Enums.GlobalCommandKind.Maintenance_OpenClamp,
    domain: "maintenance",
  }),
  MaintenanceCloseClamp: spec("MaintenanceCloseClamp", {
    kind: Enums.GlobalCommandKind.Maintenance_CloseClamp,
    domain: "maintenance",
  }),
  MaintenanceClearClampFault: spec("MaintenanceClearClampFault", {
    kind: Enums.GlobalCommandKind.Maintenance_ClearClampFault,
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
  kind: Enums.GlobalCommandKindValue,
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
>(
  tag: Tag,
  kind: Enums.GlobalCommandKindValue,
  domain: "manual" | "maintenance",
) {
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
>(
  tag: Tag,
  kind: Enums.GlobalCommandKindValue,
  domain: "manual" | "maintenance",
) {
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
>(tag: Tag, kind: Enums.GlobalCommandKindValue) {
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
