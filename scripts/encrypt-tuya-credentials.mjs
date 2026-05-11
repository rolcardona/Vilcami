/**
 * Encrypt Tuya IoT credentials using the EXACT same AES-256-GCM
 * encryption algorithm as src/utils/kv-vault.util.ts
 *
 * Flow (matching kv-vault.util.ts precisely):
 *   1. SHA-256 hash the ENCRYPTION_KEY string → 256-bit AES key
 *   2. Random 12-byte IV via crypto.getRandomValues()
 *   3. AES-256-GCM encrypt via crypto.subtle
 *   4. Split: ciphertext = encrypted[0..-16], tag = encrypted[-16..]
 *   5. Output: { ciphertext, iv, tag } all in base64
 */

import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12;

// === Credentials to encrypt ===
const CREDENTIALS = {
  accessId: "gd9jsn3yhkqj7wfvmenq",
  accessSecret: "13c42349612844b996abbc108477f5e8",
  projectCode: "p1777384854684fqemu8",
};

// === Load ENCRYPTION_KEY from key file ===
const keyFilePath = resolve(__dirname, "tuya-credentials.key");
const ENCRYPTION_KEY = readFileSync(keyFilePath, "utf-8").trim();

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  throw new Error(
    "ENCRYPTION_KEY must be at least 32 characters. " +
      "Check scripts/tuya-credentials.key"
  );
}

async function getEncryptionKey(keyMaterial) {
  const encoded = new TextEncoder().encode(keyMaterial);
  // SHA-256 hash to get exactly 256 bits for AES-256
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return await crypto.subtle.importKey(
    "raw",
    hash,
    { name: ALGORITHM },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptValue(plaintext) {
  const key = await getEncryptionKey(ENCRYPTION_KEY);
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

async function main() {
  console.log("=== Encrypting Tuya IoT Credentials ===\n");
  console.log(`Algorithm:    ${ALGORITHM} (AES-256)`);
  console.log(`Key Derivation: SHA-256(ENCRYPTION_KEY)`);
  console.log(`IV Length:    ${IV_LENGTH} bytes\n`);

  const result = {};

  for (const [name, value] of Object.entries(CREDENTIALS)) {
    const encrypted = await encryptValue(value);
    result[name] = encrypted;
    console.log(`[${name}]`);
    console.log(`  Plaintext:    ${value}`);
    console.log(`  Ciphertext:   ${encrypted.ciphertext}`);
    console.log(`  IV:           ${encrypted.iv}`);
    console.log(`  Tag:          ${encrypted.tag}`);
    console.log("");
  }

  const outputPath = resolve(__dirname, "tuya-credentials.encrypted.json");
  writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf-8");
  console.log(`Encrypted credentials saved to: ${outputPath}`);

  // Verify round-trip: decrypt and compare
  const decrypted = {};
  for (const [name, enc] of Object.entries(result)) {
    const key = await getEncryptionKey(ENCRYPTION_KEY);
    const iv = new Uint8Array(Buffer.from(enc.iv, "base64"));
    const ct = new Uint8Array(Buffer.from(enc.ciphertext, "base64"));
    const tg = new Uint8Array(Buffer.from(enc.tag, "base64"));
    const combined = new Uint8Array(ct.length + tg.length);
    combined.set(ct);
    combined.set(tg, ct.length);
    const dec = await crypto.subtle.decrypt(
      { name: ALGORITHM, iv },
      key,
      combined,
    );
    decrypted[name] = new TextDecoder().decode(dec);
  }

  let allMatch = true;
  for (const [name, original] of Object.entries(CREDENTIALS)) {
    const match = decrypted[name] === original;
    console.log(`  Verify ${name}: ${match ? "PASS" : "FAIL"}`);
    if (!match) allMatch = false;
  }

  if (!allMatch) {
    throw new Error("Round-trip verification FAILED!");
  }

  console.log("\nAll credentials encrypted and verified successfully.");
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
