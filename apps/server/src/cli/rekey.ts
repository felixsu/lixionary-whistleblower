import { sql } from "drizzle-orm";
import { parseKeyring, seal, unseal, safeError } from "@whistle/runtime";
import { createDb, rows } from "../db/client.js";
import { secret } from "../config.js";
const keys = parseKeyring(secret("CASE_KEYRING")),
  { db, close } = createDb(secret("MIGRATION_DATABASE_URL"));
try {
  await db.transaction(async (tx) => {
    for (const [table, column, prefix] of [
      ["cases", "content_enc", "case"],
      ["cases", "closure_enc", "closure"],
      ["cases", "protection_plan_enc", "protection"],
      ["case_messages", "body_enc", "message"],
      ["case_records", "body_enc", "record"],
      ["verification_requests", "reason_enc", "verification"],
      ["staff", "mfa_enc", "mfa"],
      ["staff", "mfa_pending_enc", "mfa"],
    ] as const) {
      for (const row of await rows(
        tx,
        sql`select id,${sql.identifier(column)} value from ${sql.identifier(table)} where ${sql.identifier(column)} is not null for update`,
      )) {
        const value = unseal(String(row.value), keys, `${prefix}:${row.id}`);
        await rows(
          tx,
          sql`update ${sql.identifier(table)} set ${sql.identifier(column)}=${seal(value, keys, `${prefix}:${row.id}`)} where id=${row.id}`,
        );
      }
    }
    for (const j of await rows(
      tx,
      sql`select * from jobs where sent_at is null for update`,
    )) {
      const b = j.body as Record<string, unknown>;
      if (b.tokenEnc) {
        const purpose =
          j.kind === "privacy_claim" ? `claim:${j.case_id}` : "staff-token";
        b.tokenEnc = seal(
          unseal(String(b.tokenEnc), keys, purpose),
          keys,
          purpose,
        );
        await rows(
          tx,
          sql`update jobs set body=${JSON.stringify(b)}::jsonb where id=${j.id}`,
        );
      }
    }
  });
  console.log("Case fields re-encrypted under the active key.");
} catch (e) {
  console.error(safeError(e));
  process.exitCode = 1;
} finally {
  await close();
}
