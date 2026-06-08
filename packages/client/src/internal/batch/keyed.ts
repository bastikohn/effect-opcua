import { Effect } from "effect";

import { configurationError, type OpcuaError } from "../../OpcuaError.js";
import { positiveIntegerOption, unknownKeys } from "../common/options.js";
import { isPlainRecord } from "../common/predicates.js";

export type KeyedEntry<Key extends string, Normalized> = {
  readonly key: Key;
  readonly index: number;
  readonly normalized: Normalized;
};

export type KeyedBatchSpec<
  Input,
  Options,
  Defaults,
  Normalized,
  Ready,
  EffectiveOptions,
  RawResult,
  PublicResult,
> = {
  readonly operation: string;
  readonly normalizeOptions: (
    options: Options,
    defaults: Defaults | undefined,
  ) => Effect.Effect<EffectiveOptions, OpcuaError>;
  readonly normalizeItem: (
    key: string,
    input: Input,
    options: EffectiveOptions,
  ) => Effect.Effect<Normalized, OpcuaError>;
  readonly validateItems?: (
    items: ReadonlyArray<KeyedEntry<string, Normalized>>,
    options: EffectiveOptions,
  ) => Effect.Effect<void, OpcuaError>;
  readonly preflight?: (
    items: ReadonlyArray<KeyedEntry<string, Normalized>>,
    options: EffectiveOptions,
  ) => Effect.Effect<ReadonlyArray<KeyedEntry<string, Ready>>, OpcuaError>;
  readonly execute: (
    items: ReadonlyArray<KeyedEntry<string, Ready>>,
    options: EffectiveOptions,
  ) => Effect.Effect<ReadonlyArray<RawResult>, OpcuaError>;
  readonly toPublicResult: (
    entry: KeyedEntry<string, Ready>,
    raw: RawResult,
  ) => Effect.Effect<PublicResult, OpcuaError>;
};

export const runKeyedBatchOperation = <
  Input,
  Options,
  Defaults,
  Normalized,
  Ready,
  EffectiveOptions,
  RawResult,
  PublicResult,
>(
  items: Readonly<Record<string, Input>>,
  options: Options,
  defaults: Defaults | undefined,
  spec: KeyedBatchSpec<
    Input,
    Options,
    Defaults,
    Normalized,
    Ready,
    EffectiveOptions,
    RawResult,
    PublicResult
  >,
): Effect.Effect<Record<string, PublicResult>, OpcuaError> =>
  Effect.gen(function* () {
    const effectiveOptions = yield* spec.normalizeOptions(options, defaults);
    const entries = yield* normalizeKeyedRecord<Input, Normalized>(
      spec.operation,
      items,
      (key, input) => spec.normalizeItem(key, input, effectiveOptions),
    );

    if (spec.validateItems) {
      yield* spec.validateItems(entries, effectiveOptions);
    }

    if (entries.length === 0) return {};

    const readyEntries = spec.preflight
      ? yield* spec.preflight(entries, effectiveOptions)
      : (entries as unknown as ReadonlyArray<KeyedEntry<string, Ready>>);
    const rawResults = yield* spec.execute(readyEntries, effectiveOptions);
    return yield* rekeyOrderedResults(
      spec.operation,
      readyEntries,
      rawResults,
      spec.toPublicResult,
    );
  });

export const normalizeKeyedRecord = <Input, Normalized>(
  operation: string,
  items: unknown,
  normalizeItem: (
    key: string,
    input: Input,
    index: number,
  ) => Effect.Effect<Normalized, OpcuaError>,
): Effect.Effect<ReadonlyArray<KeyedEntry<string, Normalized>>, OpcuaError> =>
  Effect.suspend(() => {
    const dictionaryError = keyedDictionaryError(operation, items);
    if (dictionaryError) return Effect.fail(dictionaryError);

    const keyedItems = Object.entries(items as Record<string, Input>).map(
      ([key, input], index) => ({ key, input, index }),
    );
    return Effect.forEach(keyedItems, ({ key, input, index }) =>
      Effect.map(normalizeItem(key, input, index), (normalized) => ({
        key,
        index,
        normalized,
      })),
    );
  });

export const rekeyOrderedResults = <Ready, RawResult, PublicResult>(
  operation: string,
  entries: ReadonlyArray<KeyedEntry<string, Ready>>,
  rawResults: ReadonlyArray<RawResult>,
  toPublicResult: (
    entry: KeyedEntry<string, Ready>,
    raw: RawResult,
  ) => Effect.Effect<PublicResult, OpcuaError>,
): Effect.Effect<Record<string, PublicResult>, OpcuaError> =>
  Effect.gen(function* () {
    if (rawResults.length !== entries.length) {
      return yield* Effect.fail(
        configurationError({
          operation,
          cause: `expected ${entries.length} ordered results, got ${rawResults.length}`,
        }),
      );
    }

    const out: Record<string, PublicResult> = {};
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      out[entry.key] = yield* toPublicResult(entry, rawResults[index]!);
    }
    return out;
  });

export const validateUniqueTargets = <Normalized>(
  entries: ReadonlyArray<KeyedEntry<string, Normalized>>,
  options: {
    readonly operation: string;
    readonly target: (entry: KeyedEntry<string, Normalized>) => string;
    readonly duplicateCause?: (target: string, previousKey: string) => string;
    readonly errorContext?: (
      entry: KeyedEntry<string, Normalized>,
      target: string,
    ) => {
      readonly nodeId?: string;
      readonly objectId?: string;
      readonly methodId?: string;
    };
  },
): Effect.Effect<void, OpcuaError> =>
  Effect.suspend(() => {
    const seen = new Map<string, string>();
    for (const entry of entries) {
      const target = options.target(entry);
      const duplicate = seen.get(target);
      if (duplicate !== undefined) {
        return Effect.fail(
          configurationError({
            operation: options.operation,
            key: entry.key,
            ...options.errorContext?.(entry, target),
            cause:
              options.duplicateCause?.(target, duplicate) ??
              `duplicate target also used by ${duplicate}`,
          }),
        );
      }
      seen.set(target, entry.key);
    }
    return Effect.void;
  });

export const validateOptionsShape = (
  operation: string,
  value: unknown,
  allowedKeys: ReadonlyArray<string>,
): Effect.Effect<void, OpcuaError> =>
  Effect.suspend(() => {
    const error = optionsShapeError(operation, value, allowedKeys);
    return error ? Effect.fail(error) : Effect.void;
  });

export const normalizeServiceOptions = <Key extends string>({
  serviceLimits,
  defaults,
  serviceOperation,
  defaultsOperation,
  allowedKeys,
  fallback,
}: {
  readonly serviceLimits: unknown;
  readonly defaults: unknown;
  readonly serviceOperation: string;
  readonly defaultsOperation: string;
  readonly allowedKeys: ReadonlyArray<Key>;
  readonly fallback: Record<Key, number>;
}): Effect.Effect<Record<Key, number>, OpcuaError> =>
  Effect.suspend(() => {
    const defaultsError = serviceOptionsError(
      defaultsOperation,
      defaults,
      allowedKeys,
    );
    if (defaultsError) return Effect.fail(defaultsError);

    const serviceError = serviceOptionsError(
      serviceOperation,
      serviceLimits,
      allowedKeys,
    );
    if (serviceError) return Effect.fail(serviceError);

    const serviceLimitsRecord = serviceLimits as
      | Partial<Record<Key, number>>
      | undefined;
    const defaultsRecord = defaults as Partial<Record<Key, number>> | undefined;
    const normalized = { ...fallback };
    for (const key of allowedKeys) {
      normalized[key] =
        serviceLimitsRecord?.[key] ?? defaultsRecord?.[key] ?? fallback[key];
    }
    return Effect.succeed(normalized);
  });

const keyedDictionaryError = (operation: string, value: unknown) => {
  if (isPlainRecord(value)) return undefined;
  return configurationError({
    operation,
    cause: "items must be a plain keyed record",
  });
};

const optionsShapeError = (
  operation: string,
  value: unknown,
  allowedKeys: ReadonlyArray<string>,
) => {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    return configurationError({
      operation,
      cause: "options must be an object",
    });
  }
  const unknown = unknownKeys(value, allowedKeys);
  return unknown.length > 0
    ? configurationError({
        operation,
        cause: `unsupported option: ${unknown.join(", ")}`,
      })
    : undefined;
};

const serviceOptionsError = (
  operation: string,
  value: unknown,
  allowedKeys: ReadonlyArray<string>,
) => {
  if (value === undefined) return undefined;
  if (!isPlainRecord(value)) {
    return configurationError({
      operation,
      cause: "service options must be an object",
    });
  }
  for (const key of unknownKeys(value, allowedKeys)) {
    return configurationError({
      operation,
      cause: `unsupported service option: ${key}`,
    });
  }
  for (const key of allowedKeys) {
    const optionValue = value[key];
    if (optionValue !== undefined && !positiveIntegerOption(optionValue)) {
      return configurationError({
        operation,
        cause: `${key} must be a positive integer`,
      });
    }
  }
  return undefined;
};
