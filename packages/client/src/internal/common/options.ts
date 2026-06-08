import { Duration } from "effect";

import { nonNegativeInteger, positiveInteger } from "./predicates.js";

export const unknownKeys = (
  value: Record<string, unknown>,
  allowedKeys: Iterable<string>,
): ReadonlyArray<string> => {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).filter((key) => !allowed.has(key));
};

export const positiveIntegerOption = (value: unknown): value is number =>
  positiveInteger(value);

export const nonNegativeIntegerOption = (value: unknown): value is number =>
  nonNegativeInteger(value);

export const positiveIntegerOrDefault = (
  value: number | undefined,
  fallback: number,
) => (positiveInteger(value) ? Math.floor(value) : fallback);

export const durationToMillis = (
  duration: Duration.Duration,
  options: {
    readonly notDuration: string;
    readonly invalidDuration: string;
  },
) => {
  if (!Duration.isDuration(duration)) return options.notDuration;
  const millis = Duration.toMillis(duration);
  if (!Number.isFinite(millis) || millis < 0) return options.invalidDuration;
  return millis;
};

export const stringUnionOption = <Value extends string>(
  value: unknown,
  allowed: ReadonlyArray<Value>,
): value is Value => allowed.includes(value as Value);
