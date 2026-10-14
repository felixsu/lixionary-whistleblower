import { sql } from "drizzle-orm";
import { mac, safeError, unseal, createEmailSender } from "@whistle/runtime";
import type { Config } from "./config.js";
import { rows, type Db } from "./db/client.js";
import { settings, audit, enqueue } from "./service.js";
export async function signedCall(
  config: Config,
  path: string,
  body: Record<string, unknown>,
) {
  const raw = JSON.stringify(body),
    stamp = Date.now().toString();
  const response = await fetch(`${config.privacyUrl}/internal/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-service-time": stamp,
      "x-service-signature": mac(config.eventKey, `${stamp}:${path}:${raw}`),
    },
    body: raw,
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error("private_service_unavailable");
  return response;
}
export function startJobs(
  db: Db,
  config: Config,
  log: { error: (o: unknown, s: string) => void },
) {
  let stopped = false,
    running = false;
  const mail = createEmailSender(config.email);
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const [j] = await rows(
        db,
        sql`update jobs set lease_at=now(),attempts=attempts+1 where id=(select id from jobs where sent_at is null and next_at<=now() and (lease_at is null or lease_at<now()-interval '5 minutes') order by next_at for update skip locked limit 1) returning *`,
      );
      if (j) {
        const body = j.body as Record<string, unknown>;
        try {
          if (j.kind === "reporter_notify")
            await signedCall(config, "notify", {
              caseId: j.case_id,
              eventId: j.id,
            });
          else if (j.kind === "privacy_claim")
            await signedCall(config, "claim", {
              caseId: j.case_id,
              intakeId: body.intakeId,
              intakeToken: unseal(
                String(body.tokenEnc),
                config.keys,
                `claim:${j.case_id}`,
              ),
              eventId: j.id,
            });
          else if (j.kind === "privacy_delete") {
            await signedCall(config, "delete", {
              caseId: j.case_id,
              eventId: j.id,
            });
            await rows(
              db,
              sql`update deletion_manifest set privacy_complete=true where case_id=${j.case_id}`,
            );
          } else if (j.kind === "staff_token") {
            const [s] = await rows(
              db,
              sql`select email from staff where id=${j.staff_id}`,
            );
            if (s) {
              const raw = unseal<string>(
                String(body.tokenEnc),
                config.keys,
                "staff-token",
              );
              const url = `${config.webUrl}/staff/accept#token=${encodeURIComponent(raw)}`;
              await mail.send({
                to: String(s.email),
                subject: "Speak Up account access",
                text: `Open this link to set your password. Authenticator verification remains required.\n${url}`,
              });
            }
          } else if (j.kind === "staff_alert") {
            const people = await rows(
              db,
              sql`select distinct s.email from cases c join team_members t on t.team_id=c.team_id join staff s on s.id=t.staff_id where c.id=${j.case_id} and s.active and s.role<>'admin' and not exists(select 1 from case_members r where r.case_id=c.id and r.staff_id=s.id and r.recused) and (s.role='manager' or exists(select 1 from case_members m where m.case_id=c.id and m.staff_id=s.id and not m.recused and m.subscribed))`,
            );
            for (const p of people)
              await mail.send({
                to: String(p.email),
                subject: "Reporting portal update",
                text: `A case requires attention. Sign in to the review portal: ${config.webUrl}/staff`,
              });
          } else throw new Error("unknown_job");
          await rows(
            db,
            sql`update jobs set sent_at=now(),lease_at=null,body='{}' where id=${j.id} and lease_at=${j.lease_at}`,
          );
        } catch (e) {
          await rows(
            db,
            sql`update jobs set lease_at=null,next_at=now()+${Math.min(3600, 2 ** Math.min(Number(j.attempts), 11))}*interval '1 second',error_code='delivery_failed' where id=${j.id} and lease_at=${j.lease_at}`,
          );
          log.error(safeError(e), "background delivery failed");
        }
      }
    } catch (e) {
      log.error(safeError(e), "job claim failed");
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => void tick(), 2000);
  timer.unref();
  void tick();
  const retention = setInterval(
    () =>
      void expire(db).catch((e) => log.error(safeError(e), "retention failed")),
    60000,
  );
  retention.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(retention);
    mail.close();
  };
}
export async function expire(db: Db) {
  await rows(db, sql`delete from rate_limits where expires_at<=now()`);
  const s = await settings(db);
  if (!s.configured || !s.body.retention) return;
  const overdue = await rows(
    db,
    sql`select id from cases where state<>'closed' and (acknowledged_at is null and created_at<now()-${s.body.acknowledgmentDays}*interval '1 day' or coalesce(last_response_at,created_at)<now()-${s.body.followupDays}*interval '1 day' or exists(select 1 from case_records r where r.case_id=cases.id and r.kind='task' and r.completed_at is null and r.due_at<now()))`,
  );
  for (const c of overdue)
    await enqueue(
      db,
      "staff_alert",
      String(c.id),
      { event: "overdue" },
      null,
      `overdue:${c.id}:${new Date().toISOString().slice(0, 10)}`,
    );
  await db.transaction(async (tx) => {
    const expired = await rows(
      tx,
      sql`select id from cases where state='closed' and not hold and closed_at<now()-${s.body.retention!.cases}*interval '1 day' for update skip locked limit 100`,
    );
    for (const c of expired) {
      await rows(
        tx,
        sql`insert into deletion_manifest(case_id) values(${c.id}) on conflict do nothing`,
      );
      await audit(tx, "retention_service", "case_deleted", String(c.id));
      await enqueue(
        tx,
        "privacy_delete",
        String(c.id),
        {},
        null,
        `delete:${c.id}`,
      );
      await rows(
        tx,
        sql`delete from jobs where case_id=${c.id} and kind<>'privacy_delete'`,
      );
      await rows(tx, sql`delete from cases where id=${c.id}`);
    }
  });
  await rows(db, sql`delete from staff_sessions where expires_at<now()`);
  await rows(db, sql`delete from reporter_sessions where expires_at<now()`);
  await rows(
    db,
    sql`delete from staff_tokens where expires_at<now()-interval '1 day'`,
  );
  await rows(db, sql`delete from jobs where sent_at<now()-interval '7 days'`);
}
