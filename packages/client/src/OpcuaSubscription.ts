import type { ClientSubscription } from "node-opcua";
import type { Duration, Effect, PubSub, Scope, Stream } from "effect";

import type * as OpcuaError from "./OpcuaError.js";
import type * as OpcuaVariable from "./OpcuaVariable.js";

import type { OpcuaSubscriptionEvent } from "./internal/events/model.js";
import {
  makeSubscriptionService,
  type ValidateVariable,
} from "./internal/monitoring/runtime.js";
import type { OpcuaStructureRuntime } from "./internal/structures/runtime.js";
import type { OpcuaStatusInfo } from "./OpcuaVariable.js";

export type BufferPolicy =
  | { readonly _tag: "Sliding"; readonly capacity: number }
  | { readonly _tag: "Dropping"; readonly capacity: number };

export const BufferPolicy = {
  sliding: (capacity: number): BufferPolicy => ({
    _tag: "Sliding",
    capacity,
  }),
  dropping: (capacity: number): BufferPolicy => ({
    _tag: "Dropping",
    capacity,
  }),
  latest: (): BufferPolicy => ({ _tag: "Sliding", capacity: 1 }),
};

export type MonitorDeadband =
  | { readonly _tag: "None" }
  | { readonly _tag: "Absolute"; readonly value: number }
  | { readonly _tag: "Percent"; readonly value: number };

export const MonitorDeadband = {
  none: (): MonitorDeadband => ({ _tag: "None" }),
  absolute: (value: number): MonitorDeadband => ({
    _tag: "Absolute",
    value,
  }),
  percent: (value: number): MonitorDeadband => ({
    _tag: "Percent",
    value,
  }),
};

export type MonitorFilter =
  | { readonly _tag: "None" }
  | { readonly _tag: "Status" }
  | {
      readonly _tag: "StatusValue";
      readonly deadband: MonitorDeadband;
    }
  | {
      readonly _tag: "StatusValueTimestamp";
      readonly deadband: MonitorDeadband;
    };

export const MonitorFilter = {
  none: (): MonitorFilter => ({ _tag: "None" }),
  status: (): MonitorFilter => ({ _tag: "Status" }),
  statusValue: (
    deadband: MonitorDeadband = MonitorDeadband.none(),
  ): MonitorFilter => ({
    _tag: "StatusValue",
    deadband,
  }),
  statusValueTimestamp: (
    deadband: MonitorDeadband = MonitorDeadband.none(),
  ): MonitorFilter => ({
    _tag: "StatusValueTimestamp",
    deadband,
  }),
};

export type MonitorStartup = "strict" | "bestEffort";
export type MonitorValidation = "none" | "access" | "strict";
export type MonitorTimestamps = "none" | "source" | "server" | "both";

export type MonitorCreateOptions = {
  readonly maxItemsPerRequest?: number;
  readonly maxConcurrentRequests?: number;
};

export type MonitorItemOverride = Partial<{
  readonly samplingInterval: Duration.Duration;
  readonly queueSize: number;
  readonly discardOldest: boolean;
  readonly filter: MonitorFilter;
  readonly timestamps: MonitorTimestamps;
}>;

export type AnyVariableDefinition = OpcuaVariable.ReadableVariableDef;
export type MonitorItemDictionary = Record<string, AnyVariableDefinition>;

export type MonitorOptions<Items = MonitorItemDictionary> = {
  readonly startup: MonitorStartup;
  readonly validation: MonitorValidation;

  readonly samplingInterval: Duration.Duration;
  readonly queueSize: number;
  readonly discardOldest: boolean;
  readonly filter: MonitorFilter;
  readonly timestamps: MonitorTimestamps;

  readonly clientBuffer: BufferPolicy;

  readonly overrides?: {
    readonly [K in keyof Items]?: MonitorItemOverride;
  };

  readonly create?: MonitorCreateOptions;
};

export type EffectiveMonitorItemOptions = {
  readonly samplingInterval: number;
  readonly queueSize: number;
  readonly discardOldest: boolean;
  readonly filter: MonitorFilter;
  readonly timestamps: MonitorTimestamps;
};

export type RevisedMonitorItemOptions = {
  readonly samplingInterval?: number;
  readonly queueSize?: number;
};

export type MonitorStarted = {
  readonly key: string;
  readonly nodeId: string;
  readonly requested: EffectiveMonitorItemOptions;
  readonly revised?: RevisedMonitorItemOptions;
};

export type MonitorStartupFailure = {
  readonly key: string;
  readonly nodeId: string;
  readonly requested: EffectiveMonitorItemOptions;
  readonly error: OpcuaError.OpcuaMonitorStartupError;
};

export type MonitorStartupReport<Items = MonitorItemDictionary> = {
  readonly ok: boolean;
  readonly requested: number;
  readonly activeCount: number;
  readonly failedCount: number;
  readonly active: ReadonlyMap<keyof Items & string, MonitorStarted>;
  readonly failed: ReadonlyMap<keyof Items & string, MonitorStartupFailure>;
};

export type MonitorValueForKey<
  Items,
  Key extends keyof Items & string,
> = Items[Key] extends OpcuaVariable.ReadableVariableDef
  ? OpcuaVariable.ValueOfVariableDef<Items[Key]>
  : never;

type MonitorNodeIdForKey<
  Items,
  Key extends keyof Items & string,
> = Items[Key] extends { readonly nodeId: infer Id extends string }
  ? Id
  : string;

type MonitorSampleBase<Items, Key extends keyof Items & string> = {
  readonly key: Key;
  readonly nodeId: MonitorNodeIdForKey<Items, Key>;
  readonly status: OpcuaStatusInfo;
  readonly sourceTimestamp?: Date;
  readonly serverTimestamp?: Date;
};

export type MonitorSample<Items = MonitorItemDictionary> = {
  readonly [Key in keyof Items & string]:
    | ({
        readonly _tag: "Value";
        readonly value: MonitorValueForKey<Items, Key>;
      } & MonitorSampleBase<Items, Key>)
    | ({
        readonly _tag: "Status";
      } & MonitorSampleBase<Items, Key>)
    | ({
        readonly _tag: "DecodeError";
        readonly error: OpcuaError.OpcuaDecodeError;
        readonly rawValue: unknown;
      } & MonitorSampleBase<Items, Key>);
}[keyof Items & string];

export type ActiveMonitor<Items = MonitorItemDictionary> = {
  readonly startup: MonitorStartupReport<Items>;
  readonly samples: Stream.Stream<
    MonitorSample<Items>,
    OpcuaError.OpcuaMonitorRuntimeError
  >;
};

export type OpcuaSubscription = {
  readonly monitor: <const Items extends MonitorItemDictionary>(
    items: Items,
    options: MonitorOptions<Items>,
  ) => Effect.Effect<
    ActiveMonitor<Items>,
    | OpcuaError.OpcuaMonitorCreateError<Items>
    | OpcuaError.OpcuaMonitorConfigurationError,
    Scope.Scope
  >;
  readonly events: Stream.Stream<OpcuaSubscriptionEvent>;
  readonly unsafeRaw: ClientSubscription;
};

export const makeSubscription = (
  unsafeRaw: ClientSubscription,
  events: PubSub.PubSub<OpcuaSubscriptionEvent>,
  structureRuntime: OpcuaStructureRuntime,
  validateVariable: ValidateVariable,
): OpcuaSubscription =>
  makeSubscriptionService(
    unsafeRaw,
    events,
    structureRuntime,
    validateVariable,
  );
