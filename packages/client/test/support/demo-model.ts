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
