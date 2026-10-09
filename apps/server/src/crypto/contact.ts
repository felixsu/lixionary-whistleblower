import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
const IV_BYTES = 12;

/**
 * AES-256-GCM encryption for reporter contact details.
 * Stored as `v1:<iv>:<tag>:<ciphertext>` (base64url parts) so the key can be rotated later.
 */
export function encryptContact(plain: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptContact(stored: string, key: Buffer): string {
  const [version, iv, tag, ct] = stored.split(":");
  if (version !== VERSION || !iv || !tag || ct === undefined) {
    throw new Error("Unsupported contact ciphertext format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export function encryptOptional(plain: string, key: Buffer): string | null {
  return plain === "" ? null : encryptContact(plain, key);
}
