import { and, eq, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client.js";
import { adminSessions, admins, attachments, intakeSessions, notificationOutbox } from "../db/schema.js";
import type { Storage } from "../lib/storage.js";
import type { Mail, Mailer } from "./mailer.js";
import { logSafeError } from "../lib/errors.js";

const MAX_ATTEMPTS = 8;

interface OutboxPayload {
  reportId: string;
  caseCode: string;
}

/** Emails deliberately carry no report content — only the case code and a link. */
export function renderNotification(kind: string, payload: OutboxPayload, webUrl: string): Omit<Mail, "to"> | null {
  const link = `${webUrl}/admin/reports/${payload.reportId}`;
  switch (kind) {
    case "new_report":
      return {
        subject: `New whistleblower report ${payload.caseCode}`,
        text: `A new report (${payload.caseCode}) has been submitted.\n\nReview it here: ${link}\n`,
      };
    case "reporter_reply":
      return {
        subject: `Reporter replied on ${payload.caseCode}`,
        text: `The reporter sent a new message on case ${payload.caseCode}.\n\nRead it here: ${link}\n`,
      };
    default:
      return null;
  }
}

export async function processOutbox(db: Db, mailer: Mailer, webUrl: string, log: FastifyBaseLogger): Promise<number> {
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(notificationOutbox)
      .where(and(isNull(notificationOutbox.sentAt), lte(notificationOutbox.nextAttemptAt, new Date()), lt(notificationOutbox.attempts, MAX_ATTEMPTS)))
      .orderBy(notificationOutbox.createdAt)
      .limit(10)
      .for("update", { skipLocked: true });
    if (due.length === 0) return 0;

    const recipients = (await tx.select({ email: admins.email }).from(admins)).map((a) => a.email);
    for (const row of due) {
      const mail = renderNotification(row.kind, row.payload as unknown as OutboxPayload, webUrl);
      try {
        if (mail && recipients.length > 0) await mailer.send({ ...mail, to: recipients });
        await tx.update(notificationOutbox).set({ sentAt: new Date(), attempts: row.attempts + 1 }).where(eq(notificationOutbox.id, row.id));
      } catch (err) {
        const attempts = row.attempts + 1;
        const backoffMs = Math.min(2 ** attempts, 240) * 60_000;
        log.warn({ err: (err as Error).message, attempts }, "notification failed");
        await tx
          .update(notificationOutbox)
          .set({ attempts, lastError: (err as Error).message.slice(0, 500), nextAttemptAt: new Date(Date.now() + backoffMs) })
          .where(eq(notificationOutbox.id, row.id));
      }
    }
    return due.length;
  });
}

/** Deletes abandoned (expired, never submitted) intake sessions with their files, and expired admin sessions. */
export async function cleanupExpired(db: Db, storage: Storage): Promise<void> {
  const now = new Date();
  const stale = await db
    .select({ id: intakeSessions.id })
    .from(intakeSessions)
    .where(and(isNull(intakeSessions.submittedAt), lt(intakeSessions.expiresAt, now)))
    .limit(500);
  if (stale.length > 0) {
    const ids = stale.map((s) => s.id);
    const files = await db
      .delete(attachments)
      .where(and(inArray(attachments.intakeSessionId, ids), isNull(attachments.reportId)))
      .returning({ storageKey: attachments.storageKey });
    await Promise.all(files.map((f) => storage.remove(f.storageKey)));
    await db.delete(intakeSessions).where(inArray(intakeSessions.id, ids));
  }
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, now));
  await db.delete(notificationOutbox).where(lt(notificationOutbox.sentAt, sql`now() - interval '30 days'`));
}

export function startBackgroundJobs(opts: {
  db: Db;
  mailer: Mailer;
  storage: Storage;
  webUrl: string;
  log: FastifyBaseLogger;
}): () => void {
  const { db, mailer, storage, webUrl, log } = opts;
  const outboxTimer = setInterval(() => {
    processOutbox(db, mailer, webUrl, log).catch((err) => log.error({ err: logSafeError(err) }, "outbox run failed"));
  }, 10_000);
  const cleanupTimer = setInterval(() => {
    cleanupExpired(db, storage).catch((err) => log.error({ err: logSafeError(err) }, "cleanup failed"));
  }, 60 * 60_000);
  cleanupExpired(db, storage).catch((err) => log.error({ err: logSafeError(err) }, "cleanup failed"));
  return () => {
    clearInterval(outboxTimer);
    clearInterval(cleanupTimer);
  };
}
