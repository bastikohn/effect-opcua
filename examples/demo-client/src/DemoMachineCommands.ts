import { Context, Effect, Layer } from "effect";

import type {
  AxisSelectionCommandInput,
  ClearActuatorFaultInput,
  DemoMachineCommand,
  JogInput,
  MoveAxisToPositionInput,
  MoveXAxisToTargetInput,
  MoveZAxisToTargetInput,
  OperatingModeInput,
  RunConfigurationInput,
} from "./contract/commands.js";
import type { DemoMachineCommandOptions, DemoMachineOptions } from "./contract/options.js";
import type { DemoMachineCommandCoreService } from "./internal/command-core.js";
import { DemoMachineCommandCore } from "./internal/command-core.js";

export type DemoMachineCommandsService = {
  readonly submit: DemoMachineCommandCoreService["submit"];
  readonly machine: {
    readonly setMode: (
      targetMode: OperatingModeInput,
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
    readonly configure: (
      runConfiguration: RunConfigurationInput,
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
    readonly home: (
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
    readonly start: (
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
    readonly pause: (
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
    readonly resume: (
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
    readonly abort: (
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
    readonly reset: (
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
    readonly clearCompleted: (
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
    readonly acknowledgeSafetyReset: (
      options?: DemoMachineCommandOptions,
    ) => ReturnType<DemoMachineCommandCoreService["submit"]>;
  };
  readonly manual: ManualCommands;
  readonly maintenance: MaintenanceCommands;
};

export type ManualCommands = {
  readonly homeX: MethodWithoutInput;
  readonly homeZ: MethodWithoutInput;
  readonly moveXAxisToTarget: MethodWithInput<MoveXAxisToTargetInput>;
  readonly moveXAxisToPosition: MethodWithInput<MoveAxisToPositionInput>;
  readonly moveZAxisToTarget: MethodWithInput<MoveZAxisToTargetInput>;
  readonly moveZAxisToPosition: MethodWithInput<MoveAxisToPositionInput>;
  readonly jogXPositive: MethodWithInput<JogInput>;
  readonly jogXNegative: MethodWithInput<JogInput>;
  readonly jogZPositive: MethodWithInput<JogInput>;
  readonly jogZNegative: MethodWithInput<JogInput>;
  readonly openClamp: MethodWithoutInput;
  readonly closeClamp: MethodWithoutInput;
  readonly primePump: MethodWithoutInput;
  readonly stopPump: MethodWithoutInput;
  readonly openNozzleValve: MethodWithoutInput;
  readonly closeNozzleValve: MethodWithoutInput;
  readonly triggerInspectionOnce: MethodWithoutInput;
  readonly clearActuatorFault: MethodWithInput<ClearActuatorFaultInput>;
};

export type MaintenanceCommands = {
  readonly refillTank: MethodWithoutInput;
  readonly drainTank: MethodWithoutInput;
  readonly primePump: MethodWithoutInput;
  readonly cleanNozzle: MethodWithoutInput;
  readonly resetPumpFault: MethodWithoutInput;
  readonly resetValveFault: MethodWithoutInput;
  readonly calibrateFillLevelSensor: MethodWithoutInput;
  readonly simulateSensorCheck: MethodWithoutInput;
  readonly resetInspectionFault: MethodWithoutInput;
  readonly moveXAxisToTarget: MethodWithInput<MoveXAxisToTargetInput>;
  readonly moveXAxisToPosition: MethodWithInput<MoveAxisToPositionInput>;
  readonly moveZAxisToTarget: MethodWithInput<MoveZAxisToTargetInput>;
  readonly moveZAxisToPosition: MethodWithInput<MoveAxisToPositionInput>;
  readonly jogXPositive: MethodWithInput<JogInput>;
  readonly jogXNegative: MethodWithInput<JogInput>;
  readonly jogZPositive: MethodWithInput<JogInput>;
  readonly jogZNegative: MethodWithInput<JogInput>;
  readonly homeAxes: MethodWithInput<AxisSelectionCommandInput>;
  readonly enableAxes: MethodWithInput<AxisSelectionCommandInput>;
  readonly disableAxes: MethodWithInput<AxisSelectionCommandInput>;
  readonly clearAxisFault: MethodWithInput<AxisSelectionCommandInput>;
  readonly openClamp: MethodWithoutInput;
  readonly closeClamp: MethodWithoutInput;
  readonly clearClampFault: MethodWithoutInput;
};

type MethodWithoutInput = (
  options?: DemoMachineCommandOptions,
) => ReturnType<DemoMachineCommandCoreService["submit"]>;

type MethodWithInput<Input> = (
  input: Input,
  options?: DemoMachineCommandOptions,
) => ReturnType<DemoMachineCommandCoreService["submit"]>;

export class DemoMachineCommands extends Context.Service<
  DemoMachineCommands,
  DemoMachineCommandsService
>()("@effect-opcua/demo-client/DemoMachineCommands") {
  static readonly layer = Layer.effect(
    DemoMachineCommands,
    Effect.gen(function* () {
      const core = yield* DemoMachineCommandCore;
      const submit = core.submit;
      const noInput =
        <Tag extends DemoMachineCommand["_tag"]>(tag: Tag) =>
        (options?: DemoMachineCommandOptions) =>
          submit({ _tag: tag } as DemoMachineCommand, options);
      const withInput =
        <Tag extends DemoMachineCommand["_tag"], Input>(tag: Tag) =>
        (input: Input, options?: DemoMachineCommandOptions) =>
          submit({ _tag: tag, ...(input as object) } as DemoMachineCommand, options);

      return DemoMachineCommands.of({
        submit,
        machine: {
          setMode: (targetMode, options) =>
            submit({ _tag: "MachineSetMode", targetMode }, options),
          configure: (runConfiguration, options) =>
            submit(
              { _tag: "MachineConfigure", runConfiguration },
              options,
            ),
          home: noInput("MachineHome"),
          start: noInput("MachineStart"),
          pause: noInput("MachinePause"),
          resume: noInput("MachineResume"),
          abort: noInput("MachineAbort"),
          reset: noInput("MachineReset"),
          clearCompleted: noInput("MachineClearCompleted"),
          acknowledgeSafetyReset: noInput("MachineAcknowledgeSafetyReset"),
        },
        manual: {
          homeX: noInput("ManualHomeX"),
          homeZ: noInput("ManualHomeZ"),
          moveXAxisToTarget: withInput("ManualMoveXAxisToTarget"),
          moveXAxisToPosition: withInput("ManualMoveXAxisToPosition"),
          moveZAxisToTarget: withInput("ManualMoveZAxisToTarget"),
          moveZAxisToPosition: withInput("ManualMoveZAxisToPosition"),
          jogXPositive: withInput("ManualJogXPositive"),
          jogXNegative: withInput("ManualJogXNegative"),
          jogZPositive: withInput("ManualJogZPositive"),
          jogZNegative: withInput("ManualJogZNegative"),
          openClamp: noInput("ManualOpenClamp"),
          closeClamp: noInput("ManualCloseClamp"),
          primePump: noInput("ManualPrimePump"),
          stopPump: noInput("ManualStopPump"),
          openNozzleValve: noInput("ManualOpenNozzleValve"),
          closeNozzleValve: noInput("ManualCloseNozzleValve"),
          triggerInspectionOnce: noInput("ManualTriggerInspectionOnce"),
          clearActuatorFault: withInput("ManualClearActuatorFault"),
        },
        maintenance: {
          refillTank: noInput("MaintenanceRefillTank"),
          drainTank: noInput("MaintenanceDrainTank"),
          primePump: noInput("MaintenancePrimePump"),
          cleanNozzle: noInput("MaintenanceCleanNozzle"),
          resetPumpFault: noInput("MaintenanceResetPumpFault"),
          resetValveFault: noInput("MaintenanceResetValveFault"),
          calibrateFillLevelSensor: noInput(
            "MaintenanceCalibrateFillLevelSensor",
          ),
          simulateSensorCheck: noInput("MaintenanceSimulateSensorCheck"),
          resetInspectionFault: noInput("MaintenanceResetInspectionFault"),
          moveXAxisToTarget: withInput("MaintenanceMoveXAxisToTarget"),
          moveXAxisToPosition: withInput("MaintenanceMoveXAxisToPosition"),
          moveZAxisToTarget: withInput("MaintenanceMoveZAxisToTarget"),
          moveZAxisToPosition: withInput("MaintenanceMoveZAxisToPosition"),
          jogXPositive: withInput("MaintenanceJogXPositive"),
          jogXNegative: withInput("MaintenanceJogXNegative"),
          jogZPositive: withInput("MaintenanceJogZPositive"),
          jogZNegative: withInput("MaintenanceJogZNegative"),
          homeAxes: withInput("MaintenanceHomeAxes"),
          enableAxes: withInput("MaintenanceEnableAxes"),
          disableAxes: withInput("MaintenanceDisableAxes"),
          clearAxisFault: withInput("MaintenanceClearAxisFault"),
          openClamp: noInput("MaintenanceOpenClamp"),
          closeClamp: noInput("MaintenanceCloseClamp"),
          clearClampFault: noInput("MaintenanceClearClampFault"),
        },
      });
    }),
  );

  static layerLive = (options: DemoMachineOptions = {}) =>
    DemoMachineCommands.layer.pipe(
      Layer.provide(DemoMachineCommandCore.layerLive(options)),
    );
}

export const submit = (
  command: DemoMachineCommand,
  options?: DemoMachineCommandOptions,
) => Effect.flatMap(DemoMachineCommands, (commands) => commands.submit(command, options));
