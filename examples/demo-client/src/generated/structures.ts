import { Opcua } from "@effect-opcua/client";
import { Schema } from "effect";

import { DataTypes } from "./nodeIds.js";

export const RunConfigurationSchema = Schema.Struct({
  productName: Schema.String,
  targetFillVolumeMl: Schema.Number,
  fillToleranceMl: Schema.Number,
  pumpRateMlPerSecond: Schema.Number,
  batchSize: Schema.Number,
  xAxisSpeedMmPerSecond: Schema.Number,
  zAxisSpeedMmPerSecond: Schema.Number,
});

export type RunConfiguration = typeof RunConfigurationSchema.Type;

export const RunConfiguration = Opcua.structure({
  name: "RunConfiguration",
  dataTypeId: DataTypes.RunConfiguration,
  schema: RunConfigurationSchema,
});

export const GlobalCommandSubmitRequestSchema = Schema.Struct({
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
});

export type GlobalCommandSubmitRequest =
  typeof GlobalCommandSubmitRequestSchema.Type;

export const GlobalCommandSubmitRequest = Opcua.structure({
  name: "GlobalCommandSubmitRequest",
  dataTypeId: DataTypes.GlobalCommandSubmitRequest,
  schema: GlobalCommandSubmitRequestSchema,
});

export const CommandStatusEntrySchema = Schema.Struct({
  sequence: Schema.Number,
  commandId: Schema.String,
  commandKind: Schema.Number,
  clientId: Schema.String,
  state: Schema.Number,
  statusCode: Schema.String,
  statusMessage: Schema.String,
  observedAt: Schema.Date,
  updatedAt: Schema.Date,
});

export type RawCommandStatusEntry = typeof CommandStatusEntrySchema.Type;

export const CommandStatusEntry = Opcua.structure({
  name: "CommandStatusEntry",
  dataTypeId: DataTypes.CommandStatusEntry,
  schema: CommandStatusEntrySchema,
});

export const CommandStatusBufferSchema = Schema.Struct({
  revision: Schema.Number,
  capacity: Schema.Number,
  entries: Schema.Array(CommandStatusEntrySchema),
});

export type RawCommandStatusBuffer = typeof CommandStatusBufferSchema.Type;

export const CommandStatusBuffer = Opcua.structure({
  name: "CommandStatusBuffer",
  dataTypeId: DataTypes.CommandStatusBuffer,
  schema: CommandStatusBufferSchema,
});

export const MachineSetModePayloadSchema = Schema.Struct({
  commandId: Schema.String,
  targetMode: Schema.Number,
});

export type MachineSetModePayload = typeof MachineSetModePayloadSchema.Type;

export const MachineSetModePayload = Opcua.structure({
  name: "MachineSetModePayload",
  dataTypeId: DataTypes.MachineSetModePayload,
  schema: MachineSetModePayloadSchema,
});

export const MachineConfigurePayloadSchema = Schema.Struct({
  commandId: Schema.String,
  configuration: RunConfigurationSchema,
});

export type MachineConfigurePayload = typeof MachineConfigurePayloadSchema.Type;

export const MachineConfigurePayload = Opcua.structure({
  name: "MachineConfigurePayload",
  dataTypeId: DataTypes.MachineConfigurePayload,
  schema: MachineConfigurePayloadSchema,
});

export const MoveXAxisToTargetPayloadSchema = Schema.Struct({
  commandId: Schema.String,
  target: Schema.Number,
  velocityMmPerSecond: Schema.Number,
});

export type MoveXAxisToTargetPayload =
  typeof MoveXAxisToTargetPayloadSchema.Type;

export const MoveXAxisToTargetPayload = Opcua.structure({
  name: "MoveXAxisToTargetPayload",
  dataTypeId: DataTypes.MoveXAxisToTargetPayload,
  schema: MoveXAxisToTargetPayloadSchema,
});

export const MoveZAxisToTargetPayloadSchema = Schema.Struct({
  commandId: Schema.String,
  target: Schema.Number,
  velocityMmPerSecond: Schema.Number,
});

export type MoveZAxisToTargetPayload =
  typeof MoveZAxisToTargetPayloadSchema.Type;

export const MoveZAxisToTargetPayload = Opcua.structure({
  name: "MoveZAxisToTargetPayload",
  dataTypeId: DataTypes.MoveZAxisToTargetPayload,
  schema: MoveZAxisToTargetPayloadSchema,
});

export const MoveAxisToPositionPayloadSchema = Schema.Struct({
  commandId: Schema.String,
  targetPositionMm: Schema.Number,
  velocityMmPerSecond: Schema.Number,
});

export type MoveAxisToPositionPayload =
  typeof MoveAxisToPositionPayloadSchema.Type;

export const MoveAxisToPositionPayload = Opcua.structure({
  name: "MoveAxisToPositionPayload",
  dataTypeId: DataTypes.MoveAxisToPositionPayload,
  schema: MoveAxisToPositionPayloadSchema,
});

export const JogPayloadSchema = Schema.Struct({
  commandId: Schema.String,
  velocityMmPerSecond: Schema.Number,
  maxDurationMs: Schema.Number,
});

export type JogPayload = typeof JogPayloadSchema.Type;

export const JogPayload = Opcua.structure({
  name: "JogPayload",
  dataTypeId: DataTypes.JogPayload,
  schema: JogPayloadSchema,
});

export const ClearActuatorFaultPayloadSchema = Schema.Struct({
  commandId: Schema.String,
  actuator: Schema.Number,
});

export type ClearActuatorFaultPayload =
  typeof ClearActuatorFaultPayloadSchema.Type;

export const ClearActuatorFaultPayload = Opcua.structure({
  name: "ClearActuatorFaultPayload",
  dataTypeId: DataTypes.ClearActuatorFaultPayload,
  schema: ClearActuatorFaultPayloadSchema,
});

export const AxisSelectionPayloadSchema = Schema.Struct({
  commandId: Schema.String,
  axisSelection: Schema.Number,
});

export type AxisSelectionPayload = typeof AxisSelectionPayloadSchema.Type;

export const AxisSelectionPayload = Opcua.structure({
  name: "AxisSelectionPayload",
  dataTypeId: DataTypes.AxisSelectionPayload,
  schema: AxisSelectionPayloadSchema,
});
