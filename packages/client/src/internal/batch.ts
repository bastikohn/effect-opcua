import { Effect } from "effect";

import { chunksOf } from "./common/collections.js";
import { positiveIntegerOrDefault } from "./common/options.js";

export type BatchOptions = {
  readonly maxItemsPerRequest?: number;
  readonly maxConcurrentRequests?: number;
};

const DEFAULT_MAX_ITEMS_PER_REQUEST = 250;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 1;

export const runChunked = <A, B, E, R>(
  items: ReadonlyArray<A>,
  options: BatchOptions | undefined,
  f: (
    chunk: ReadonlyArray<A>,
    chunkIndex: number,
  ) => Effect.Effect<ReadonlyArray<B>, E, R>,
): Effect.Effect<ReadonlyArray<B>, E, R> =>
  Effect.gen(function* () {
    const normalized = normalizeBatchOptions(options);
    const chunks = chunksOf(items, normalized.maxItemsPerRequest);
    const chunkResults = yield* Effect.forEach(chunks, f, {
      concurrency: normalized.maxConcurrentRequests,
    });
    const results: Array<B> = [];
    for (const chunkResult of chunkResults) {
      results.push(...chunkResult);
    }
    return results;
  });

const normalizeBatchOptions = (options: BatchOptions | undefined) => ({
  maxItemsPerRequest: positiveIntegerOrDefault(
    options?.maxItemsPerRequest,
    DEFAULT_MAX_ITEMS_PER_REQUEST,
  ),
  maxConcurrentRequests: positiveIntegerOrDefault(
    options?.maxConcurrentRequests,
    DEFAULT_MAX_CONCURRENT_REQUESTS,
  ),
});
