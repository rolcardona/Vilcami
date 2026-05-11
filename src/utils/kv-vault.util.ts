/**
 * KV Vault Utility — AES-256-GCM encryption for sensitive values
 * stored in Cloudflare KV (Tuya local keys, API secrets, etc.)
 *
 * Uses Web Crypto API (crypto.subtle) available in Cloudflare Workers.
 * No Node.js Buffer dependency — pure btoa/atob for base64 encoding.
 */

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface EncryptedValue {
  ciphertext: string;
  iv: string;
  tag: string;
}

async function getEncryptionKey(keyMaterial?: string): Promise<CryptoKey> {
  const key = keyMaterial;
  if (!key) {
    throw new Error("ENCRYPTION_KEY is required");
  }
  const encoded = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return await crypto.subtle.importKey(
    "raw",
    hash,
    { name: ALGORITHM },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptValue(
  plaintext: string,
  encryptionKey?: string,
): Promise<EncryptedValue> {
  const key = await getEncryptionKey(encryptionKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const encrypted = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv },
    key,
    encoded,
  );

  const encryptedBytes = new Uint8Array(encrypted);
  const ciphertext = encryptedBytes.slice(0, -16);
  const tag = encryptedBytes.slice(-16);

  return {
    ciphertext: uint8ArrayToBase64(ciphertext),
    iv: uint8ArrayToBase64(iv),
    tag: uint8ArrayToBase64(tag),
  };
}

export async function decryptValue(
  encrypted: EncryptedValue,
  encryptionKey?: string,
): Promise<string> {
  const key = await getEncryptionKey(encryptionKey);
  const iv = base64ToUint8Array(encrypted.iv);
  const ciphertext = base64ToUint8Array(encrypted.ciphertext);
  const tag = base64ToUint8Array(encrypted.tag);

  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext);
  combined.set(tag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv },
    key,
    combined,
  );

  return new TextDecoder().decode(decrypted);
}