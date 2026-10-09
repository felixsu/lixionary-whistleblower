import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { CASE_CODE_ALPHABET } from "@whistle/shared";

/** A random opaque bearer token; only its SHA-256 hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function tokenMatches(token: string, storedHash: string): boolean {
  const a = Buffer.from(hashToken(token), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

function randomFrom(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** e.g. WB-7K3M-9QXP — 40 bits of entropy, unambiguous characters only. */
export function newCaseCode(): string {
  return `WB-${randomFrom(CASE_CODE_ALPHABET, 4)}-${randomFrom(CASE_CODE_ALPHABET, 4)}`;
}

const PIN_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** A 10-character secret shown to the reporter once, grouped for readability: ABCDE-FGHJK. */
export function newPin(): string {
  return `${randomFrom(PIN_ALPHABET, 5)}-${randomFrom(PIN_ALPHABET, 5)}`;
}

export function normalizePin(pin: string): string {
  return pin.toUpperCase().replace(/[^0-9A-Z]/g, "");
}
