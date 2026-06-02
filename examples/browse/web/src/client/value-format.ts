import type { MonitorSample, ReadValue } from "../shared/rpc.js";

export function stringifyValue(value: ReadValue | undefined) {
  return value?._tag === "Value" ? JSON.stringify(value.value, null, 2) : "";
}

export function displayValue(value: ReadValue | undefined) {
  if (!value) return "";
  if (value._tag === "Value") return readableJson(value.value);
  if (value._tag === "DecodeError") return readableJson(value.error);
  return value.status.text;
}

export function compactValue(value: ReadValue | undefined) {
  if (!value) return "";
  if (value._tag === "Value") return compactJson(value.value);
  if (value._tag === "DecodeError") return compactJson(value.error);
  return value.status.text;
}

export function sparkline(samples: MonitorSample[]) {
  const values = samples
    .map((sample) =>
      sample.sample._tag === "Value" && typeof sample.sample.value === "number"
        ? sample.sample.value
        : undefined,
    )
    .filter((value): value is number => value !== undefined);
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 28 - ((value - min) / span) * 24;
      return `${x},${y}`;
    })
    .join(" ");
}

function readableJson(value: unknown) {
  return JSON.stringify(valueForDisplay(value), null, 2);
}

function compactJson(value: unknown) {
  const text = JSON.stringify(valueForDisplay(value));
  return text.length > 90 ? `${text.slice(0, 87)}...` : text;
}

function valueForDisplay(value: unknown) {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}
