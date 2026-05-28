import { Schema } from "effect";

import * as Opcua from "../../src/Opcua.js";

export const demoNodeId = <const Path extends string>(path: Path) =>
  `ns=1;s=DemoFillingCell.${path}` as const;

const dataTypeNodeId = <const Name extends string>(name: Name) =>
  `ns=1;s=DataTypes.${name}` as const;

export const RunConfigurationSchema = Schema.Struct({
  productName: Schema.String,
  targetFillVolumeMl: Schema.Number,
  fillToleranceMl: Schema.Number,
  pumpRateMlPerSecond: Schema.Number,
  batchSize: Schema.Number,
  xAxisSpeedMmPerSecond: Schema.Number,
  zAxisSpeedMmPerSecond: Schema.Number,
});

export const RunConfiguration = Opcua.structure({
  name: "RunConfiguration",
  dataTypeId: dataTypeNodeId("RunConfiguration"),
  schema: RunConfigurationSchema,
});

export const MachineConfigurePayload = Opcua.structure({
  name: "MachineConfigurePayload",
  dataTypeId: dataTypeNodeId("MachineConfigurePayload"),
  schema: Schema.Struct({
    commandId: Schema.String,
    configuration: RunConfigurationSchema,
  }),
});

export const MoveAxisToPositionPayload = Opcua.structure({
  name: "MoveAxisToPositionPayload",
  dataTypeId: dataTypeNodeId("MoveAxisToPositionPayload"),
  schema: Schema.Struct({
    commandId: Schema.String,
    targetPositionMm: Schema.Number,
    velocityMmPerSecond: Schema.Number,
  }),
});

export const GlobalCommandSubmitRequest = Opcua.structure({
  name: "GlobalCommandSubmitRequest",
  dataTypeId: dataTypeNodeId("GlobalCommandSubmitRequest"),
  schema: Schema.Struct({
    commandId: Schema.String,
    commandKind: Schema.Number,
    clientId: Schema.String,
    targetMode: Schema.Number,
    configuration: RunConfigurationSchema,
    target: Schema.Number,
    targetPositionMm: Schema.Number,
    velocityMmPerSecond: Schema.Number,
    maxDurationMs: Schema.Number,
    actuator: Schema.Number,
    axisSelection: Schema.Number,
  }),
});

export const defaultRunConfiguration = {
  productName: "Water",
  targetFillVolumeMl: 250,
  fillToleranceMl: 2,
  pumpRateMlPerSecond: 50,
  batchSize: 3,
  xAxisSpeedMmPerSecond: 200,
  zAxisSpeedMmPerSecond: 100,
} as const;

export const emptySubmitPayload = {
  targetMode: 0,
  configuration: {
    productName: "",
    targetFillVolumeMl: 0,
    fillToleranceMl: 0,
    pumpRateMlPerSecond: 0,
    batchSize: 0,
    xAxisSpeedMmPerSecond: 0,
    zAxisSpeedMmPerSecond: 0,
  },
  target: 0,
  targetPositionMm: 0,
  velocityMmPerSecond: 0,
  maxDurationMs: 0,
  actuator: 0,
  axisSelection: 0,
} as const;
