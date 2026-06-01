export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export const toJsonValue = (value: unknown): JsonValue => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") {
    return { _tag: "BigInt", text: value.toString() };
  }
  if (value instanceof Date) {
    return { _tag: "DateTime", iso: value.toISOString() };
  }
  if (Array.isArray(value)) {
    return value.map((item) => toJsonValue(item));
  }
  if (value instanceof Uint8Array) {
    return {
      _tag: "ByteString",
      base64: bytesToBase64(value),
    };
  }
  if (value instanceof Error) {
    return {
      _tag: "Error",
      name: value.name,
      message: value.message,
      stack: value.stack ?? null,
    };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(record)
        .filter(([key, item]) => !key.startsWith("_") && item !== undefined)
        .map(([key, item]) => [key, toJsonValue(item)]),
    );
  }
  return String(value);
};

const bytesToBase64 = (bytes: Uint8Array) => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

export const errorMessage = (cause: unknown): string => {
  if (cause instanceof Error) return cause.message;
  if (typeof cause === "string") return cause;
  try {
    return JSON.stringify(toJsonValue(cause));
  } catch {
    return String(cause);
  }
};

export const parseJsonValue = (text: string): JsonValue => {
  const parsed = JSON.parse(text) as unknown;
  return toJsonValue(parsed);
};
