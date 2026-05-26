const demoNodeId = <const Path extends string>(path: Path) =>
  `ns=1;s=DemoFillingCell.${path}` as const;

const dataTypeNodeId = <const Name extends string>(name: Name) =>
  `ns=1;s=DataTypes.${name}` as const;

export const DataTypes = {
  RunConfiguration: dataTypeNodeId("RunConfiguration"),
  GlobalCommandSubmitRequest: dataTypeNodeId("GlobalCommandSubmitRequest"),
  CommandStatusEntry: dataTypeNodeId("CommandStatusEntry"),
  CommandStatusBuffer: dataTypeNodeId("CommandStatusBuffer"),
  MachineSetModePayload: dataTypeNodeId("MachineSetModePayload"),
  MachineConfigurePayload: dataTypeNodeId("MachineConfigurePayload"),
  MoveXAxisToTargetPayload: dataTypeNodeId("MoveXAxisToTargetPayload"),
  MoveZAxisToTargetPayload: dataTypeNodeId("MoveZAxisToTargetPayload"),
  MoveAxisToPositionPayload: dataTypeNodeId("MoveAxisToPositionPayload"),
  JogPayload: dataTypeNodeId("JogPayload"),
  ClearActuatorFaultPayload: dataTypeNodeId("ClearActuatorFaultPayload"),
  AxisSelectionPayload: dataTypeNodeId("AxisSelectionPayload"),
} as const;

export const Commands = {
  SubmitRequest: demoNodeId("Commands.SubmitRequest"),
  Status: demoNodeId("Commands.Status"),
  Payloads: {
    Machine: {
      SetMode: demoNodeId("Commands.Payloads.Machine.SetMode"),
      Configure: demoNodeId("Commands.Payloads.Machine.Configure"),
    },
    Manual: {
      MoveXAxisToTarget: demoNodeId(
        "Commands.Payloads.Manual.MoveXAxisToTarget",
      ),
      MoveXAxisToPosition: demoNodeId(
        "Commands.Payloads.Manual.MoveXAxisToPosition",
      ),
      MoveZAxisToTarget: demoNodeId(
        "Commands.Payloads.Manual.MoveZAxisToTarget",
      ),
      MoveZAxisToPosition: demoNodeId(
        "Commands.Payloads.Manual.MoveZAxisToPosition",
      ),
      JogXPositive: demoNodeId("Commands.Payloads.Manual.JogXPositive"),
      JogXNegative: demoNodeId("Commands.Payloads.Manual.JogXNegative"),
      JogZPositive: demoNodeId("Commands.Payloads.Manual.JogZPositive"),
      JogZNegative: demoNodeId("Commands.Payloads.Manual.JogZNegative"),
      ClearActuatorFault: demoNodeId(
        "Commands.Payloads.Manual.ClearActuatorFault",
      ),
    },
    Maintenance: {
      MoveXAxisToTarget: demoNodeId(
        "Commands.Payloads.Maintenance.MoveXAxisToTarget",
      ),
      MoveXAxisToPosition: demoNodeId(
        "Commands.Payloads.Maintenance.MoveXAxisToPosition",
      ),
      MoveZAxisToTarget: demoNodeId(
        "Commands.Payloads.Maintenance.MoveZAxisToTarget",
      ),
      MoveZAxisToPosition: demoNodeId(
        "Commands.Payloads.Maintenance.MoveZAxisToPosition",
      ),
      JogXPositive: demoNodeId("Commands.Payloads.Maintenance.JogXPositive"),
      JogXNegative: demoNodeId("Commands.Payloads.Maintenance.JogXNegative"),
      JogZPositive: demoNodeId("Commands.Payloads.Maintenance.JogZPositive"),
      JogZNegative: demoNodeId("Commands.Payloads.Maintenance.JogZNegative"),
      HomeAxes: demoNodeId("Commands.Payloads.Maintenance.HomeAxes"),
      EnableAxes: demoNodeId("Commands.Payloads.Maintenance.EnableAxes"),
      DisableAxes: demoNodeId("Commands.Payloads.Maintenance.DisableAxes"),
      ClearAxisFault: demoNodeId(
        "Commands.Payloads.Maintenance.ClearAxisFault",
      ),
    },
  },
} as const;

export const Telemetry = {
  Revision: demoNodeId("Telemetry.Revision"),
} as const;

export const State = {
  MachineState: demoNodeId("State.MachineState"),
  OperatingMode: demoNodeId("State.OperatingMode"),
  CyclePhase: demoNodeId("State.CyclePhase"),
  Ready: demoNodeId("State.Ready"),
  Busy: demoNodeId("State.Busy"),
  ConfigurationValid: demoNodeId("State.ConfigurationValid"),
  Homed: demoNodeId("State.Homed"),
  SafetyOk: demoNodeId("State.SafetyOk"),
  FaultActive: demoNodeId("State.FaultActive"),
  WarningActive: demoNodeId("State.WarningActive"),
  Configuration: {
    ProductName: demoNodeId("State.Configuration.ProductName"),
    TargetFillVolumeMl: demoNodeId("State.Configuration.TargetFillVolumeMl"),
    FillToleranceMl: demoNodeId("State.Configuration.FillToleranceMl"),
    PumpRateMlPerSecond: demoNodeId(
      "State.Configuration.PumpRateMlPerSecond",
    ),
    BatchSize: demoNodeId("State.Configuration.BatchSize"),
    XAxisSpeedMmPerSecond: demoNodeId(
      "State.Configuration.XAxisSpeedMmPerSecond",
    ),
    ZAxisSpeedMmPerSecond: demoNodeId(
      "State.Configuration.ZAxisSpeedMmPerSecond",
    ),
  },
} as const;

export const Motion = {
  XAxis: {
    State: demoNodeId("Motion.XAxis.State"),
    ActualPositionMm: demoNodeId("Motion.XAxis.ActualPositionMm"),
    TargetPositionMm: demoNodeId("Motion.XAxis.TargetPositionMm"),
    ActualVelocityMmPerSecond: demoNodeId(
      "Motion.XAxis.ActualVelocityMmPerSecond",
    ),
    CommandedVelocityMmPerSecond: demoNodeId(
      "Motion.XAxis.CommandedVelocityMmPerSecond",
    ),
    Homed: demoNodeId("Motion.XAxis.Homed"),
    Enabled: demoNodeId("Motion.XAxis.Enabled"),
    FaultCode: demoNodeId("Motion.XAxis.FaultCode"),
    CurrentTarget: demoNodeId("Motion.XAxis.CurrentTarget"),
  },
  ZAxis: {
    State: demoNodeId("Motion.ZAxis.State"),
    ActualPositionMm: demoNodeId("Motion.ZAxis.ActualPositionMm"),
    TargetPositionMm: demoNodeId("Motion.ZAxis.TargetPositionMm"),
    ActualVelocityMmPerSecond: demoNodeId(
      "Motion.ZAxis.ActualVelocityMmPerSecond",
    ),
    CommandedVelocityMmPerSecond: demoNodeId(
      "Motion.ZAxis.CommandedVelocityMmPerSecond",
    ),
    Homed: demoNodeId("Motion.ZAxis.Homed"),
    Enabled: demoNodeId("Motion.ZAxis.Enabled"),
    FaultCode: demoNodeId("Motion.ZAxis.FaultCode"),
    CurrentTarget: demoNodeId("Motion.ZAxis.CurrentTarget"),
  },
} as const;

export const Safety = {
  EmergencyStopState: demoNodeId("Safety.EmergencyStopState"),
  GuardDoorState: demoNodeId("Safety.GuardDoorState"),
  SafetyCircuitState: demoNodeId("Safety.SafetyCircuitState"),
  ResetRequired: demoNodeId("Safety.ResetRequired"),
  StopReason: demoNodeId("Safety.StopReason"),
} as const;

export const Filling = {
  Tank: {
    CapacityMl: demoNodeId("Filling.Tank.CapacityMl"),
    LevelMl: demoNodeId("Filling.Tank.LevelMl"),
    LowLevel: demoNodeId("Filling.Tank.LowLevel"),
    Empty: demoNodeId("Filling.Tank.Empty"),
  },
  Pump: {
    State: demoNodeId("Filling.Pump.State"),
    Running: demoNodeId("Filling.Pump.Running"),
    RateMlPerSecond: demoNodeId("Filling.Pump.RateMlPerSecond"),
    FaultCode: demoNodeId("Filling.Pump.FaultCode"),
  },
  NozzleValve: {
    State: demoNodeId("Filling.NozzleValve.State"),
    Open: demoNodeId("Filling.NozzleValve.Open"),
    FaultCode: demoNodeId("Filling.NozzleValve.FaultCode"),
  },
} as const;

export const PartHandling = {
  Clamp: {
    State: demoNodeId("PartHandling.Clamp.State"),
    Open: demoNodeId("PartHandling.Clamp.Open"),
    Closed: demoNodeId("PartHandling.Clamp.Closed"),
    FaultCode: demoNodeId("PartHandling.Clamp.FaultCode"),
  },
  PartPresent: demoNodeId("PartHandling.PartPresent"),
} as const;

export const Inspection = {
  FillLevelMl: demoNodeId("Inspection.FillLevelMl"),
  FillLevelOk: demoNodeId("Inspection.FillLevelOk"),
  Result: demoNodeId("Inspection.Result"),
  RejectReason: demoNodeId("Inspection.RejectReason"),
  SensorFaultCode: demoNodeId("Inspection.SensorFaultCode"),
} as const;

export const Production = {
  Batch: {
    TargetCount: demoNodeId("Production.Batch.TargetCount"),
    StartedCount: demoNodeId("Production.Batch.StartedCount"),
    CompletedCount: demoNodeId("Production.Batch.CompletedCount"),
    GoodCount: demoNodeId("Production.Batch.GoodCount"),
    RejectedCount: demoNodeId("Production.Batch.RejectedCount"),
    RemainingCount: demoNodeId("Production.Batch.RemainingCount"),
  },
} as const;

export const Diagnostics = {
  Summary: {
    ActiveWarningCount: demoNodeId("Diagnostics.Summary.ActiveWarningCount"),
    ActiveFaultCount: demoNodeId("Diagnostics.Summary.ActiveFaultCount"),
    HighestSeverity: demoNodeId("Diagnostics.Summary.HighestSeverity"),
    PrimaryFaultCode: demoNodeId("Diagnostics.Summary.PrimaryFaultCode"),
  },
} as const;

export const NodeIds = {
  Commands,
  Telemetry,
  State,
  Motion,
  Safety,
  Filling,
  PartHandling,
  Inspection,
  Production,
  Diagnostics,
  DataTypes,
} as const;
