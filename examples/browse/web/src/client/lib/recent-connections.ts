import { errorMessage } from "../../shared/value.js";
import type { RecentConnectionAttempt } from "../types.js";

const RECENT_CONNECTIONS_STORAGE_KEY = "effect-opcua.recentConnections";
const RECENT_CONNECTION_OPTIONS = 20;
const PASSWORD_KEY_ID = "default";

export function recentConnectionOptions(attempts: RecentConnectionAttempt[]) {
  const seen = new Set<string>();
  const options: RecentConnectionAttempt[] = [];
  for (const attempt of attempts) {
    const key = connectionKey(attempt);
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(attempt);
    if (options.length >= RECENT_CONNECTION_OPTIONS) break;
  }
  return options;
}

export function connectionKey(attempt: RecentConnectionAttempt) {
  return [
    attempt.endpointUrl,
    attempt.startNodeId,
    attempt.authMode,
    attempt.authMode === "UserPassword" ? attempt.username : "",
  ].join("\u0000");
}

export function connectionLabel(attempt: RecentConnectionAttempt) {
  const auth =
    attempt.authMode === "UserPassword" && attempt.username
      ? ` as ${attempt.username}`
      : "";
  return `${attempt.endpointUrl} (${attempt.startNodeId})${auth}`;
}

export function connectionDetails(attempt: RecentConnectionAttempt) {
  const auth =
    attempt.authMode === "UserPassword"
      ? `User: ${attempt.username || "UserPassword"}`
      : "Anonymous";
  return [attempt.startNodeId, auth, attempt.password ? "password saved" : ""]
    .filter(Boolean)
    .join(" · ");
}

export function loadConnectionAttempts() {
  const storage = connectionStorage();
  if (!storage) return [];
  try {
    const text = storage.getItem(RECENT_CONNECTIONS_STORAGE_KEY);
    const parsed = text ? (JSON.parse(text) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isConnectionAttempt);
  } catch {
    return [];
  }
}

export function persistConnectionAttempts(
  attempts: RecentConnectionAttempt[],
  onError: (message: string) => void,
) {
  const storage = connectionStorage();
  if (!storage) return;
  try {
    storage.setItem(RECENT_CONNECTIONS_STORAGE_KEY, JSON.stringify(attempts));
  } catch (error) {
    onError(`Could not save recent connection: ${messageOf(error)}`);
  }
}

function isConnectionAttempt(value: unknown): value is RecentConnectionAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as RecentConnectionAttempt;
  return (
    typeof attempt.endpointUrl === "string" &&
    typeof attempt.startNodeId === "string" &&
    (attempt.authMode === "Anonymous" || attempt.authMode === "UserPassword") &&
    typeof attempt.username === "string" &&
    (attempt.password === undefined || isEncryptedPassword(attempt.password)) &&
    typeof attempt.attemptedAt === "string"
  );
}

function isEncryptedPassword(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const password = value as {
    keyId?: unknown;
    iv?: unknown;
    ciphertext?: unknown;
  };
  return (
    password.keyId === PASSWORD_KEY_ID &&
    typeof password.iv === "string" &&
    typeof password.ciphertext === "string"
  );
}

function connectionStorage() {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function messageOf(error: unknown) {
  const message = errorMessage(error);
  return message.length > 0 && message !== "{}" ? message : "Unknown error";
}
