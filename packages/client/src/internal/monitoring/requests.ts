import {
  AttributeIds,
  StatusCodes,
  type ClientMonitoredItemBase,
  type ClientMonitoredItemGroup,
  type ClientSubscription,
} from "node-opcua";
import { Effect } from "effect";

import type { RevisedMonitorItemOptions } from "../../OpcuaSubscription.js";
import type { EffectiveMonitorItem } from "./options.js";

export const monitorItems = <Items>(
  subscription: ClientSubscription,
  chunk: ReadonlyArray<EffectiveMonitorItem<Items>>,
) => {
  const first = chunk[0]!;
  return Effect.tryPromise({
    try: (signal) =>
      subscription
        .monitorItems(
          chunk.map((item) => ({
            nodeId: item.rawNodeId,
            attributeId: AttributeIds.Value,
          })),
          {
            samplingInterval: first.requested.samplingInterval,
            queueSize: first.requested.queueSize,
            discardOldest: first.requested.discardOldest,
            filter: first.nodeOpcuaFilter,
          },
          first.timestampsToReturn,
        )
        .then((group) => monitorItemsSuccess(group, signal)),
    catch: (cause) => cause,
  });
};

export const monitoredItemStatusCode = (
  monitoredItem: ClientMonitoredItemBase | undefined,
) => monitoredItem?.statusCode ?? StatusCodes.Bad;

export const revisedMonitorItemOptions = (
  monitoredItem: ClientMonitoredItemBase | undefined,
): RevisedMonitorItemOptions | undefined => {
  const result = monitoredItem?.result as
    | {
        readonly revisedSamplingInterval?: number;
        readonly revisedQueueSize?: number;
      }
    | undefined;
  if (!result) return undefined;
  const revised: RevisedMonitorItemOptions = {
    samplingInterval:
      typeof result.revisedSamplingInterval === "number"
        ? result.revisedSamplingInterval
        : undefined,
    queueSize:
      typeof result.revisedQueueSize === "number"
        ? result.revisedQueueSize
        : undefined,
  };
  return revised.samplingInterval === undefined &&
    revised.queueSize === undefined
    ? undefined
    : revised;
};

const monitorItemsSuccess = (
  group: ClientMonitoredItemGroup,
  signal: AbortSignal,
) => {
  if (signal.aborted) {
    terminateMonitorGroupUnsafe(group);
    return { group, disposeAbort: () => undefined };
  }
  const abort = () => terminateMonitorGroupUnsafe(group);
  signal.addEventListener("abort", abort, { once: true });
  return {
    group,
    disposeAbort: () => {
      signal.removeEventListener("abort", abort);
    },
  };
};

const terminateMonitorGroupUnsafe = (group: ClientMonitoredItemGroup) => {
  void group.terminate().catch(() => undefined);
};
