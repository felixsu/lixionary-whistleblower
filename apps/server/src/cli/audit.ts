import { readFileSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { createDb, rows } from "../db/client.js";
import { secret } from "../config.js";
const { db, close } = createDb(secret("MIGRATION_DATABASE_URL"));
const path = process.argv[3];
try {
  const [invalid] = await rows(
    db,
    sql`select seq from (select seq,previous_hash,hash,lag(hash) over(order by seq) prior,encode(digest(previous_hash||id::text||actor_id||coalesce(case_id::text,'')||action||meta::text||created_at::text,'sha256'),'hex') calculated from audit_events) e where hash<>calculated or previous_hash<>coalesce(prior,(select hash from audit_anchors order by seq desc limit 1),'') limit 1`,
  );
  if (invalid) throw new Error("Audit integrity check failed");
  if (process.argv[2] === "checkpoint") {
    if (!path) throw new Error("Checkpoint path required");
    const [last] = await rows(
      db,
      sql`select seq,hash from audit_events order by seq desc limit 1`,
    );
    const [policy] = await rows(
      db,
      sql`select body,configured from settings where id=1`,
    );
    const held = await rows(db, sql`select id from cases where hold`);
    const deleted = await rows(
      db,
      sql`select case_id,deleted_at from deletion_manifest`,
    );
    const output = JSON.stringify({
      at: new Date().toISOString(),
      last: last ?? null,
      policy: policy ?? null,
      held,
      deleted,
    });
    if (path === "-") process.stdout.write(output);
    else {
      writeFileSync(path, output, { mode: 0o600 });
      console.log("Audit integrity verified; checkpoint written.");
    }
  } else if (process.argv[2] === "prune") {
    if (!path) throw new Error("Verified offsite checkpoint file required");
    const checkpoint = JSON.parse(
      process.env.AUDIT_CHECKPOINT ?? readFileSync(path, "utf8"),
    );
    const retention = checkpoint.policy?.body?.retention?.audit;
    if (!checkpoint.last || !Number.isInteger(retention))
      throw new Error("Checkpoint has no configured audit retention");
    await db.transaction(async (tx) => {
      await rows(tx, sql`select pg_advisory_xact_lock(734592)`);
      const [current] = await rows(
        tx,
        sql`select seq,hash from audit_events where seq=${checkpoint.last.seq}`,
      );
      if (current?.hash !== checkpoint.last.hash)
        throw new Error("Checkpoint mismatch");
      const [held] = await rows(
        tx,
        sql`select min(a.seq)::bigint seq from audit_events a join cases c on c.id=a.case_id where c.hold`,
      );
      const [prefix] = await rows(
        tx,
        sql`select seq,hash from audit_events where created_at<now()-${retention}*interval '1 day' and seq<=${checkpoint.last.seq} and seq<coalesce((select min(seq) from audit_events where created_at>=now()-${retention}*interval '1 day'),9223372036854775807) ${held?.seq ? sql`and seq<${held.seq}` : sql``} order by seq desc limit 1`,
      );
      if (!prefix) return;
      await rows(
        tx,
        sql`insert into audit_anchors(seq,hash,checkpoint_id) values(${prefix.seq},${prefix.hash},${checkpoint.last.hash}) on conflict do nothing`,
      );
      await rows(tx, sql`select set_config('suite.audit_prune','on',true)`);
      await rows(tx, sql`delete from audit_events where seq<=${prefix.seq}`);
    });
    console.log(
      "Eligible audit prefix pruned with a retained integrity anchor.",
    );
  } else if (process.argv[2] === "replay-deletions") {
    if (!path) throw new Error("Latest checkpoint required");
    const checkpoint = JSON.parse(
      process.env.AUDIT_CHECKPOINT ?? readFileSync(path, "utf8"),
    );
    await db.transaction(async (tx) => {
      for (const c of checkpoint.deleted) {
        await rows(
          tx,
          sql`insert into deletion_manifest(case_id) values(${c.case_id}) on conflict do nothing`,
        );
        await rows(tx, sql`delete from cases where id=${c.case_id}`);
        await rows(
          tx,
          sql`insert into jobs(kind,case_id,dedupe) values('privacy_delete',${c.case_id},${"restore-delete:" + c.case_id}) on conflict do nothing`,
        );
      }
      for (const c of checkpoint.held)
        await rows(tx, sql`update cases set hold=true where id=${c.id}`);
      await rows(tx, sql`delete from staff_tokens`);
      await rows(
        tx,
        sql`delete from jobs where kind in ('staff_token','staff_alert','reporter_notify')`,
      );
      await rows(tx, sql`delete from staff_sessions`);
      await rows(tx, sql`delete from reporter_sessions`);
    });
    console.log(
      "Deletion and legal-hold manifests replayed; sessions revoked.",
    );
  } else console.log("Audit integrity verified.");
} finally {
  await close();
}
