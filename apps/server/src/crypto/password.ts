import argon2 from "argon2";

const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashSecret(secret: string): Promise<string> {
  return argon2.hash(secret, OPTIONS);
}

export async function verifySecret(hash: string, secret: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, secret);
  } catch {
    return false;
  }
}

/** A real hash of a random value, used to keep timing uniform when the account/case doesn't exist. */
let dummyHash: Promise<string> | undefined;
export function dummySecretHash(): Promise<string> {
  dummyHash ??= hashSecret("not-a-real-secret-" + Math.random());
  return dummyHash;
}
