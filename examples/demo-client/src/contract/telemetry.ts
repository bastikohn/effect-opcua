export type DemoMachineSnapshot = {
  readonly revision: number;
  readonly machine: {
    readonly state: string;
    readonly stateValue: number;
    readonly operatingMode: string;
    readonly operatingModeValue: number;
    readonly cyclePhase: string;
    readonly cyclePhaseValue: number;
    readonly ready: boolean;
    readonly busy: boolean;
    readonly configurationValid: boolean;
    readonly homed: boolean;
    readonly safetyOk: boolean;
    readonly faultActive: boolean;
    readonly warningActive: boolean;
  };
  readonly configuration: {
    readonly productName: string;
    readonly targetFillVolumeMl: number;
    readonly fillToleranceMl: number;
    readonly pumpRateMlPerSecond: number;
    readonly batchSize: number;
    readonly xAxisSpeedMmPerSecond: number;
    readonly zAxisSpeedMmPerSecond: number;
  };
  readonly motion: {
    readonly xAxis: AxisSnapshot;
    readonly zAxis: AxisSnapshot;
  };
  readonly filling: {
    readonly tankLevelMl: number;
    readonly tankCapacityMl: number;
    readonly tankLow: boolean;
    readonly tankEmpty: boolean;
    readonly pumpState: string;
    readonly pumpStateValue: number;
    readonly pumpRunning: boolean;
    readonly pumpFaultCode: string;
    readonly nozzleValveState: string;
    readonly nozzleValveStateValue: number;
    readonly nozzleValveOpen: boolean;
    readonly nozzleValveFaultCode: string;
  };
  readonly partHandling: {
    readonly clampState: string;
    readonly clampStateValue: number;
    readonly clampOpen: boolean;
    readonly clampClosed: boolean;
    readonly clampFaultCode: string;
    readonly partPresent: boolean;
  };
  readonly inspection: {
    readonly fillLevelMl: number;
    readonly fillLevelOk: boolean;
    readonly result: string;
    readonly resultValue: number;
    readonly rejectReason: string;
    readonly rejectReasonValue: number;
    readonly sensorFaultCode: string;
  };
  readonly production: {
    readonly targetCount: number;
    readonly startedCount: number;
    readonly completedCount: number;
    readonly goodCount: number;
    readonly rejectedCount: number;
    readonly remainingCount: number;
  };
  readonly diagnostics: {
    readonly activeWarningCount: number;
    readonly activeFaultCount: number;
    readonly highestSeverity: string;
    readonly highestSeverityValue: number;
    readonly primaryFaultCode: string;
  };
};

export type AxisSnapshot = {
  readonly state: string;
  readonly stateValue: number;
  readonly actualPositionMm: number;
  readonly targetPositionMm: number;
  readonly homed: boolean;
  readonly enabled: boolean;
  readonly faultCode: string;
  readonly currentTarget: string;
  readonly currentTargetValue: number;
};
