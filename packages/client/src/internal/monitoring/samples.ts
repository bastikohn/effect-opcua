import type { DataValue } from "node-opcua";
import { Effect } from "effect";

import * as OpcuaError from "../../OpcuaError.js";
import type * as OpcuaSubscription from "../../OpcuaSubscription.js";
import type * as OpcuaVariable from "../../OpcuaVariable.js";
import type { NodeIdString } from "../common/node-id.js";
import type { OpcuaStructureRuntime } from "../structures/runtime.js";
import { Codec } from "../values/codec.js";
import { normalizeStatusCode } from "../values/normalize.js";
import { resultFromStatusAndDecode } from "../values/result.js";

export type MonitorKey<Items> = keyof Items & string;

export type WireMonitorEntry<Items> = {
  readonly key: MonitorKey<Items>;
  readonly nodeId: NodeIdString;
  readonly def: OpcuaVariable.ReadableVariableDef;
  readonly timestamps: OpcuaSubscription.MonitorTimestamps;
};

export type RawMonitorNotification<Items> = {
  readonly entry: WireMonitorEntry<Items>;
  readonly dataValue: DataValue;
};

export const monitorSampleFromDataValue = <Items>(
  entry: WireMonitorEntry<Items>,
  dataValue: DataValue,
  structureRuntime: OpcuaStructureRuntime,
): Effect.Effect<OpcuaSubscription.MonitorSample<Items>> =>
  Effect.suspend(() => {
    const base = monitorSampleBase(entry, dataValue);
    return resultFromStatusAndDecode<
      unknown,
      typeof base,
      OpcuaSubscription.MonitorSample<Items>
    >({
      statusCode: dataValue.statusCode,
      status: base,
      decode: Codec.decode(
        entry.def.codec,
        dataValue.value,
        dataValue,
        structureRuntime,
      ),
      nonGoodStatus: (base) =>
        ({ _tag: "Status", ...base }) as OpcuaSubscription.MonitorSample<Items>,
      decodeError: (error, base) =>
        ({
          _tag: "DecodeError",
          ...base,
          error: OpcuaError.decodeError({
            nodeId: entry.nodeId,
            cause: error,
          }),
          rawValue: dataValue.value?.value,
        }) as OpcuaSubscription.MonitorSample<Items>,
      value: (value) =>
        ({
          _tag: "Value",
          ...base,
          value,
        }) as OpcuaSubscription.MonitorSample<Items>,
    });
  });

const monitorSampleBase = <Items>(
  entry: WireMonitorEntry<Items>,
  dataValue: DataValue,
) => ({
  key: entry.key,
  nodeId: entry.nodeId,
  status: normalizeStatusCode(dataValue.statusCode),
  sourceTimestamp:
    entry.timestamps === "source" || entry.timestamps === "both"
      ? dateTimestamp(dataValue.sourceTimestamp)
      : undefined,
  serverTimestamp:
    entry.timestamps === "server" || entry.timestamps === "both"
      ? dateTimestamp(dataValue.serverTimestamp)
      : undefined,
});

const dateTimestamp = (timestamp: Date | null | undefined) =>
  timestamp instanceof Date ? timestamp : undefined;
