import { describe, it, expect, beforeEach } from "vitest";

// Mock environment for testing
const TEST_KEY = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6";

describe("KV Vault (AES-GCM)", () => {
  let encryptValue: (
    plaintext: string,
    encryptionKey?: string,
  ) => Promise<{ ciphertext: string; iv: string; tag: string }>;
  let decryptValue: (
    encrypted: { ciphertext: string; iv: string; tag: string },
    encryptionKey?: string,
  ) => Promise<string>;

  beforeEach(async () => {
    const vault = await import("../../utils/kv-vault.util");
    encryptValue = vault.encryptValue;
    decryptValue = vault.decryptValue;
  });

  it("should encrypt and decrypt a value correctly", async () => {
    const secret = "my-tuya-local-key-12345";
    const encrypted = await encryptValue(secret, TEST_KEY);
    const decrypted = await decryptValue(encrypted, TEST_KEY);
    expect(decrypted).toBe(secret);
  });

  it("should produce different ciphertext each time (random IV)", async () => {
    const secret = "same-secret";
    const encrypted1 = await encryptValue(secret, TEST_KEY);
    const encrypted2 = await encryptValue(secret, TEST_KEY);
    expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
  });

  it("should fail decryption with wrong ciphertext", async () => {
    const secret = "secret-value";
    const encrypted = await encryptValue(secret, TEST_KEY);
    const tampered = { ...encrypted, ciphertext: "dGFtcGVyZWQ=" };
    await expect(decryptValue(tampered, TEST_KEY)).rejects.toThrow();
  });

  it("should fail decryption with wrong key", async () => {
    const secret = "secret-value";
    const encrypted = await encryptValue(secret, TEST_KEY);
    await expect(
      decryptValue(encrypted, "wrong-key-1234567890abcdef"),
    ).rejects.toThrow();
  });

  it("should throw when encrypting without an encryption key", async () => {
    await expect(encryptValue("secret", "")).rejects.toThrow("ENCRYPTION_KEY is required");
  });

  it("should throw when encrypting with undefined key", async () => {
    await expect(encryptValue("secret", undefined)).rejects.toThrow("ENCRYPTION_KEY is required");
  });

  it("should handle non-ASCII characters in encryption round-trip", async () => {
    const secret = "clave-secreta-ñ-ü-é";
    const encrypted = await encryptValue(secret, TEST_KEY);
    const decrypted = await decryptValue(encrypted, TEST_KEY);
    expect(decrypted).toBe(secret);
  });

  it("should handle empty string in encryption round-trip", async () => {
    const secret = "";
    const encrypted = await encryptValue(secret, TEST_KEY);
    const decrypted = await decryptValue(encrypted, TEST_KEY);
    expect(decrypted).toBe(secret);
  });
});