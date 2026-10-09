/**
 * Creates an admin, or resets the password of an existing one.
 *   pnpm admin:create --email admin@example.com --name "Jane Doe"
 * The password is read from ADMIN_PASSWORD or prompted for.
 */
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { loadEnvFiles } from "../lib/env.js";
import { createDb } from "../db/client.js";
import { admins } from "../db/schema.js";
import { hashSecret } from "../crypto/password.js";

async function promptHidden(question: string): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, cb) {
      if (!muted) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const answer = rl.question(question);
  muted = true;
  const value = await answer;
  rl.close();
  process.stdout.write("\n");
  return value;
}

loadEnvFiles();
const { values } = parseArgs({ options: { email: { type: "string" }, name: { type: "string" } } });
const email = z.email().parse(values.email).toLowerCase();
const name = values.name?.trim() || email.split("@")[0]!;
const password = process.env.ADMIN_PASSWORD ?? (await promptHidden("Password (min 12 chars): "));
if (password.length < 12) {
  console.error("Password must be at least 12 characters.");
  process.exit(1);
}

const { db, close } = createDb(process.env.DATABASE_URL ?? "");
const passwordHash = await hashSecret(password);
const [existing] = await db.select({ id: admins.id }).from(admins).where(eq(admins.email, email));
if (existing) {
  await db.update(admins).set({ passwordHash, name }).where(eq(admins.id, existing.id));
  console.log(`Updated admin ${email}.`);
} else {
  await db.insert(admins).values({ email, name, passwordHash });
  console.log(`Created admin ${email}.`);
}
await close();
