import {
  DataChangeFilter,
  DataChangeTrigger,
  DeadbandType,
  TimestampsToReturn,
  coerceNodeId,
  type NodeId,
} from "node-opcua";
import { Effect, type Duration } from "effect";

import type { NodeIdString } from "../common/node-id.js";
import {
  durationToMillis,
  positiveIntegerOption,
  unknownKeys,
} from "../common/options.js";
import { isPlainRecord } from "../common/predicates.js";
import {
  monitorConfigurationError,
  type OpcuaMonitorConfigurationError,
} from "../../OpcuaError.js";
import type { ReadableVariableDef } from "../../OpcuaVariable.js";
import type {
  BufferPolicy,
  EffectiveMonitorItemOptions,
  MonitorDeadband,
  MonitorFilter,
  MonitorItemDictionary,
  MonitorOptions,
  MonitorTimestamps,
} from "../../OpcuaSubscription.js";

export type NormalizedCreateOptions = {
  readonly maxItemsPerRequest: number;
  readonly maxConcurrentRequests: number;
};

export type NormalizedMonitorItem<Items> = {
  readonly key: keyof Items & string;
  readonly def: ReadableVariableDef;
  readonly nodeId: NodeIdString;
  readonly rawNodeId: NodeId;
};

export type EffectiveMonitorItem<Items> = NormalizedMonitorItem<Items> & {
  readonly requested: EffectiveMonitorItemOptions;
  readonly nodeOpcuaFilter?: DataChangeFilter;
  readonly timestampsToReturn: TimestampsToReturn;
  readonly compatibilityKey: string;
};

const defaultCreate: NormalizedCreateOptions = {
  maxItemsPerRequest: 250,
  maxConcurrentRequests: 1,
};

const allowedOverrideKeys = new Set([
  "samplingInterval",
  "queueSize",
  "discardOldest",
  "filter",
  "timestamps",
]);

const allowedCreateKeys = new Set([
  "maxItemsPerRequest",
  "maxConcurrentRequests",
]);

export const normalizeMonitorItems = <Items extends MonitorItemDictionary>(
  items: Items,
): Effect.Effect<
  ReadonlyArray<NormalizedMonitorItem<Items>>,
  OpcuaMonitorConfigurationError
> =>
  Effect.suspend(() => {
    if (!isPlainRecord(items)) {
      return Effect.fail(
        makeMonitorConfigurationErrorForOperation("monitor.items", {
          cause: "items must be a named item dictionary",
        }),
      );
    }
    const entries = Object.entries(items);
    if (entries.length === 0) {
      return Effect.fail(
        makeMonitorConfigurationErrorForOperation("monitor.items", {
          cause: "items dictionary must not be empty",
        }),
      );
    }

    const normalized: Array<NormalizedMonitorItem<Items>> = [];
    const seenNodeIds = new Map<string, string>();
    for (const [key, value] of entries) {
      if (!isReadableVariableDef(value)) {
        return Effect.fail(
          makeMonitorConfigurationErrorForOperation("monitor.items", {
            key,
            cause: "monitor inputs must be readable variable definitions",
          }),
        );
      }
      let rawNodeId: NodeId;
      try {
        rawNodeId = coerceNodeId(value.nodeId);
      } catch (cause) {
        return Effect.fail(
          makeMonitorConfigurationErrorForOperation("monitor.items", {
            key,
            nodeId: value.nodeId,
            cause,
          }),
        );
      }
      const nodeId = rawNodeId.toString();
      const duplicate = seenNodeIds.get(nodeId);
      if (duplicate !== undefined) {
        return Effect.fail(
          makeMonitorConfigurationErrorForOperation("monitor.items", {
            key,
            nodeId,
            cause: `duplicate NodeId also used by ${duplicate}`,
          }),
        );
      }
      seenNodeIds.set(nodeId, key);
      normalized.push({
        key: key as keyof Items & string,
        def: value,
        nodeId,
        rawNodeId,
      });
    }
    return Effect.succeed(normalized);
  });

export const validateMonitorOptions = <Items>(
  items: ReadonlyArray<NormalizedMonitorItem<Items>>,
  options: MonitorOptions<Items>,
): Effect.Effect<NormalizedCreateOptions, OpcuaMonitorConfigurationError> =>
  Effect.suspend(() => {
    if (!isPlainRecord(options)) {
      return Effect.fail(
        makeMonitorConfigurationErrorForOperation("monitor.options", {
          cause: "options must be an object",
        }),
      );
    }
    if (options.startup !== "strict" && options.startup !== "bestEffort") {
      return Effect.fail(
        makeMonitorConfigurationErrorForOperation("monitor.options.startup", {
          cause: 'startup must be "strict" or "bestEffort"',
        }),
      );
    }
    if (
      options.validation !== "none" &&
      options.validation !== "access" &&
      options.validation !== "strict"
    ) {
      return Effect.fail(
        makeMonitorConfigurationErrorForOperation(
          "monitor.options.validation",
          {
            cause: 'validation must be "none", "access", or "strict"',
          },
        ),
      );
    }
    const bufferError = bufferPolicyError(options.clientBuffer);
    if (bufferError) return Effect.fail(bufferError);
    const globalError = effectiveOptionsError({
      samplingInterval: options.samplingInterval,
      queueSize: options.queueSize,
      discardOldest: options.discardOldest,
      filter: options.filter,
      timestamps: options.timestamps,
    });
    if (globalError) return Effect.fail(globalError);

    const itemKeys = new Set(items.map((item) => item.key));
    const overrides = options.overrides;
    if (overrides !== undefined) {
      if (!isPlainRecord(overrides)) {
        return Effect.fail(
          makeMonitorConfigurationErrorForOperation(
            "monitor.options.overrides",
            {
              cause: "overrides must be an object keyed by item name",
            },
          ),
        );
      }
      for (const [key, override] of Object.entries(overrides)) {
        if (!itemKeys.has(key as keyof Items & string)) {
          return Effect.fail(
            makeMonitorConfigurationErrorForOperation(
              "monitor.options.overrides",
              {
                key,
                cause: "override key does not exist in monitor items",
              },
            ),
          );
        }
        if (!isPlainRecord(override)) {
          return Effect.fail(
            makeMonitorConfigurationErrorForOperation(
              "monitor.options.overrides",
              {
                key,
                cause: "override must be an object",
              },
            ),
          );
        }
        const unknown = unknownKeys(override, allowedOverrideKeys);
        if (unknown.length > 0) {
          return Effect.fail(
            makeMonitorConfigurationErrorForOperation(
              "monitor.options.overrides",
              {
                key,
                cause: `unsupported override option: ${unknown.join(", ")}`,
              },
            ),
          );
        }
      }
    }

    const create = options.create;
    if (create !== undefined) {
      if (!isPlainRecord(create)) {
        return Effect.fail(
          makeMonitorConfigurationErrorForOperation("monitor.options.create", {
            cause: "create must be an object",
          }),
        );
      }
      const unknown = unknownKeys(create, allowedCreateKeys);
      if (unknown.length > 0) {
        return Effect.fail(
          makeMonitorConfigurationErrorForOperation("monitor.options.create", {
            cause: `unsupported create option: ${unknown.join(", ")}`,
          }),
        );
      }
    }

    const maxItemsPerRequest =
      create?.maxItemsPerRequest ?? defaultCreate.maxItemsPerRequest;
    const maxConcurrentRequests =
      create?.maxConcurrentRequests ?? defaultCreate.maxConcurrentRequests;
    if (!positiveIntegerOption(maxItemsPerRequest)) {
      return Effect.fail(
        makeMonitorConfigurationErrorForOperation("monitor.options.create", {
          cause: "maxItemsPerRequest must be a positive integer",
        }),
      );
    }
    if (!positiveIntegerOption(maxConcurrentRequests)) {
      return Effect.fail(
        makeMonitorConfigurationErrorForOperation("monitor.options.create", {
          cause: "maxConcurrentRequests must be a positive integer",
        }),
      );
    }
    return Effect.succeed({
      maxItemsPerRequest,
      maxConcurrentRequests,
    });
  });

export const applyMonitorOptions = <Items>(
  items: ReadonlyArray<NormalizedMonitorItem<Items>>,
  options: MonitorOptions<Items>,
): Effect.Effect<
  ReadonlyArray<EffectiveMonitorItem<Items>>,
  OpcuaMonitorConfigurationError
> =>
  Effect.forEach(items, (item) => {
    const override = options.overrides?.[item.key];
    return normalizeEffectiveOptions(item, {
      samplingInterval: override?.samplingInterval ?? options.samplingInterval,
      queueSize: override?.queueSize ?? options.queueSize,
      discardOldest: override?.discardOldest ?? options.discardOldest,
      filter: override?.filter ?? options.filter,
      timestamps: override?.timestamps ?? options.timestamps,
    });
  });

const normalizeEffectiveOptions = <Items>(
  item: NormalizedMonitorItem<Items>,
  options: {
    readonly samplingInterval: Duration.Duration;
    readonly queueSize: number;
    readonly discardOldest: boolean;
    readonly filter: MonitorFilter;
    readonly timestamps: MonitorTimestamps;
  },
): Effect.Effect<EffectiveMonitorItem<Items>, OpcuaMonitorConfigurationError> =>
  Effect.suspend(() => {
    const error = effectiveOptionsError(options, item.key, item.nodeId);
    if (error) return Effect.fail(error);
    const requested = {
      samplingInterval: durationToMillis(options.samplingInterval, {
        notDuration: "samplingInterval must be a Duration",
        invalidDuration: "samplingInterval must be finite and non-negative",
      }) as number,
      queueSize: options.queueSize,
      discardOldest: options.discardOldest,
      filter: options.filter,
      timestamps: options.timestamps,
    };
    const nodeOpcuaFilter = toNodeOpcuaDataChangeFilter(options.filter);
    const timestampsToReturn = toNodeOpcuaTimestamps(options.timestamps);
    return Effect.succeed({
      ...item,
      requested,
      nodeOpcuaFilter,
      timestampsToReturn,
      compatibilityKey: compatibilityKey(
        requested,
        nodeOpcuaFilter,
        timestampsToReturn,
      ),
    });
  });

const effectiveOptionsError = (
  options: {
    readonly samplingInterval: Duration.Duration;
    readonly queueSize: number;
    readonly discardOldest: boolean;
    readonly filter: MonitorFilter;
    readonly timestamps: MonitorTimestamps;
  },
  key?: string,
  nodeId?: NodeIdString,
) => {
  const samplingInterval = durationToMillis(options.samplingInterval, {
    notDuration: "samplingInterval must be a Duration",
    invalidDuration: "samplingInterval must be finite and non-negative",
  });
  if (typeof samplingInterval === "string") {
    return makeMonitorConfigurationErrorForOperation(
      "monitor.options.samplingInterval",
      {
        key,
        nodeId,
        cause: samplingInterval,
      },
    );
  }
  if (!positiveIntegerOption(options.queueSize)) {
    return makeMonitorConfigurationErrorForOperation(
      "monitor.options.queueSize",
      {
        key,
        nodeId,
        cause: "queueSize must be a positive integer",
      },
    );
  }
  if (typeof options.discardOldest !== "boolean") {
    return makeMonitorConfigurationErrorForOperation(
      "monitor.options.discardOldest",
      {
        key,
        nodeId,
        cause: "discardOldest must be a boolean",
      },
    );
  }
  if (!isMonitorFilter(options.filter)) {
    return makeMonitorConfigurationErrorForOperation("monitor.options.filter", {
      key,
      nodeId,
      cause: "filter must be a MonitorFilter",
    });
  }
  if (!isMonitorTimestamps(options.timestamps)) {
    return makeMonitorConfigurationErrorForOperation(
      "monitor.options.timestamps",
      {
        key,
        nodeId,
        cause: 'timestamps must be "none", "source", "server", or "both"',
      },
    );
  }
  return undefined;
};

const bufferPolicyError = (policy: BufferPolicy) => {
  if (
    !policy ||
    (policy._tag !== "Sliding" && policy._tag !== "Dropping") ||
    !positiveIntegerOption(policy.capacity)
  ) {
    return makeMonitorConfigurationErrorForOperation(
      "monitor.options.clientBuffer",
      {
        cause: "clientBuffer capacity must be a positive integer",
      },
    );
  }
  return undefined;
};

const compatibilityKey = (
  requested: EffectiveMonitorItemOptions,
  nodeOpcuaFilter: DataChangeFilter | undefined,
  timestampsToReturn: TimestampsToReturn,
) =>
  JSON.stringify({
    samplingInterval: requested.samplingInterval,
    queueSize: requested.queueSize,
    discardOldest: requested.discardOldest,
    filter: nodeOpcuaFilterKey(nodeOpcuaFilter),
    timestamps: timestampsToReturn,
  });

const nodeOpcuaFilterKey = (filter: DataChangeFilter | undefined) => {
  if (!filter) return "None";
  const normalized = filter as unknown as {
    readonly trigger?: number;
    readonly deadbandType?: number;
    readonly deadbandValue?: number;
  };
  return JSON.stringify({
    trigger: normalized.trigger ?? null,
    deadbandType: normalized.deadbandType ?? null,
    deadbandValue: normalized.deadbandValue ?? null,
  });
};

const toNodeOpcuaDataChangeFilter = (filter: MonitorFilter) =>
  filter._tag !== "None"
    ? new DataChangeFilter({
        trigger: toNodeOpcuaDataChangeTrigger(filter),
        ...toNodeOpcuaDeadband(filter),
      })
    : undefined;

const toNodeOpcuaDataChangeTrigger = (filter: MonitorFilter) => {
  switch (filter._tag) {
    case "None":
      return DataChangeTrigger.StatusValue;
    case "Status":
      return DataChangeTrigger.Status;
    case "StatusValue":
      return DataChangeTrigger.StatusValue;
    case "StatusValueTimestamp":
      return DataChangeTrigger.StatusValueTimestamp;
  }
};

const toNodeOpcuaDeadband = (
  filter: MonitorFilter,
): {
  readonly deadbandType?: DeadbandType;
  readonly deadbandValue?: number;
} => {
  if (filter._tag === "None" || filter._tag === "Status") return {};
  switch (filter.deadband._tag) {
    case "None":
      return {
        deadbandType: DeadbandType.None,
        deadbandValue: 0,
      };
    case "Absolute":
      return {
        deadbandType: DeadbandType.Absolute,
        deadbandValue: filter.deadband.value,
      };
    case "Percent":
      return {
        deadbandType: DeadbandType.Percent,
        deadbandValue: filter.deadband.value,
      };
  }
};

const toNodeOpcuaTimestamps = (timestamps: MonitorTimestamps) => {
  switch (timestamps) {
    case "none":
      return TimestampsToReturn.Neither;
    case "source":
      return TimestampsToReturn.Source;
    case "server":
      return TimestampsToReturn.Server;
    case "both":
      return TimestampsToReturn.Both;
  }
};

const isReadableVariableDef = (
  value: unknown,
): value is ReadableVariableDef => {
  if (!isPlainRecord(value)) return false;
  return (
    value._tag === "VariableDef" &&
    typeof value.nodeId === "string" &&
    (value.access === "read" || value.access === "readWrite")
  );
};

const isMonitorTimestamps = (value: unknown): value is MonitorTimestamps =>
  value === "none" ||
  value === "source" ||
  value === "server" ||
  value === "both";

const isMonitorFilter = (value: unknown): value is MonitorFilter => {
  if (!isPlainRecord(value) || typeof value._tag !== "string") return false;
  switch (value._tag) {
    case "None":
    case "Status":
      return true;
    case "StatusValue":
    case "StatusValueTimestamp":
      return isMonitorDeadband(value.deadband);
    default:
      return false;
  }
};

const isMonitorDeadband = (value: unknown): value is MonitorDeadband => {
  if (!isPlainRecord(value) || typeof value._tag !== "string") return false;
  switch (value._tag) {
    case "None":
      return true;
    case "Absolute":
      return (
        typeof value.value === "number" &&
        Number.isFinite(value.value) &&
        value.value >= 0
      );
    case "Percent":
      return (
        typeof value.value === "number" &&
        Number.isFinite(value.value) &&
        value.value >= 0 &&
        value.value <= 100
      );
    default:
      return false;
  }
};

const makeMonitorConfigurationErrorForOperation = (
  operation: string,
  options?: {
    readonly key?: string;
    readonly nodeId?: NodeIdString;
    readonly cause?: unknown;
  },
) =>
  monitorConfigurationError({
    operation,
    key: options?.key,
    nodeId: options?.nodeId,
    cause: options?.cause,
  });
