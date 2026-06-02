import { errorMessage } from "../shared/value.js";
import type { EncryptedPassword } from "./types.js";

const PASSWORD_KEY_DB = "effect-opcua-passwords";
const PASSWORD_KEY_STORE = "keys";
const PASSWORD_KEY_ID = "default";

export function isPasswordStorageAvailable() {
  return typeof window !== "undefined" && window.crypto?.subtle !== undefined && typeof indexedDB !== "undefined";
}

export async function encryptPassword(value: string, onError: (message: string) => void) {
  try {
    const key = await passwordKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(value));
    return {
      keyId: PASSWORD_KEY_ID,
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    } satisfies EncryptedPassword;
  } catch (error) {
    onError(`Could not save password: ${messageOf(error)}`);
    return undefined;
  }
}

export async function decryptPassword(value: EncryptedPassword, onError: (message: string) => void) {
  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(value.iv) },
      await passwordKey(),
      base64ToBytes(value.ciphertext),
    );
    return new TextDecoder().decode(decrypted);
  } catch (error) {
    onError(`Could not load saved password: ${messageOf(error)}`);
    return "";
  }
}

async function passwordKey() {
  const existing = await readPasswordKey();
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await writePasswordKey(key);
  return key;
}

async function readPasswordKey() {
  return withPasswordKeyStore("readonly", (store) => store.get(PASSWORD_KEY_ID));
}

async function writePasswordKey(key: CryptoKey) {
  await withPasswordKeyStore("readwrite", (store) => store.put(key, PASSWORD_KEY_ID));
}

async function withPasswordKeyStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openPasswordDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const transaction = database.transaction(PASSWORD_KEY_STORE, mode);
    const request = action(transaction.objectStore(PASSWORD_KEY_STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.onerror = () => reject(transaction.error);
  });
}

async function openPasswordDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PASSWORD_KEY_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PASSWORD_KEY_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(text: string) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function messageOf(error: unknown) {
  const message = errorMessage(error);
  return message.length > 0 && message !== "{}" ? message : "Unknown error";
}
