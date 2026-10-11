import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { sql } from "drizzle-orm";
import { hashSecret } from "@whistle/runtime";
import { loadEnvFiles } from "../lib/env.js";
import { createDb, rows } from "../db/client.js";
import { secret } from "../config.js";
import { audit } from "../service.js";
loadEnvFiles();
const email = process.argv[2]?.toLowerCase();
if (!email || !email.includes("@"))
  throw new Error("Usage: admin:create EMAIL (password read from stdin)");
const rl = createInterface({ input: stdin, output: stdout, terminal: false });
const password = await rl.question(
  "Initial password (minimum 15 characters, stdin): ",
);
rl.close();
if (password.length < 15) throw new Error("Password too short");
const { db, close } = createDb(secret("MIGRATION_DATABASE_URL"));
try {
  await db.transaction(async (tx) => {
    await rows(tx, sql`select pg_advisory_xact_lock(739200)`);
    const [n] = await rows(tx, sql`select count(*)::int n from staff`);
    if (Number(n?.n) > 0)
      throw new Error("Bootstrap allowed only on empty staff table");
    const [s] = await rows(
      tx,
      sql`insert into staff(email,name,role,password_hash) values(${email},'Administrator','admin',${await hashSecret(password)}) returning id`,
    );
    await audit(tx, "bootstrap", "staff_bootstrapped", null, {
      staffId: s!.id,
    });
  });
  console.log(
    "Administrator created. MFA enrollment is required at first login.",
  );
} finally {
  await close();
}
