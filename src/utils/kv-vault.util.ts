/**
 * KV Vault Utility — AES-256-GCM encryption for sensitive values
 * stored in Cloudflare KV (Tuya local keys, API secrets, etc.)
 *
 * Uses Web Crypto API (crypto.subtle) available in Cloudflare Workers.
 * Buffer is available via the nodejs_compat compatibility flag.
 */

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

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
  // Hash the key to get exactly 256 bits for AES-256
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
    ciphertext: Buffer.from(ciphertext).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
    tag: Buffer.from(tag).toString("base64"),
  };
}

export async function decryptValue(
  encrypted: EncryptedValue,
  encryptionKey?: string,
): Promise<string> {
  const key = await getEncryptionKey(encryptionKey);
  const iv = new Uint8Array(Buffer.from(encrypted.iv, "base64"));
  const ciphertext = new Uint8Array(
    Buffer.from(encrypted.ciphertext, "base64"),
  );
  const tag = new Uint8Array(Buffer.from(encrypted.tag, "base64"));

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