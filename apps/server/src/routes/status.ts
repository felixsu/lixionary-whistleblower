import type { FastifyPluginAsync } from "fastify";
import { asc, eq } from "drizzle-orm";
import {
  isClosed,
  reporterReplySchema,
  statusLookupSchema,
  type StatusLookupInput,
  type StatusResponse,
} from "@whistle/shared";
import type { Db } from "../db/client.js";
import { notificationOutbox, reportMessages, reports } from "../db/schema.js";
import { dummySecretHash, verifySecret } from "../crypto/password.js";
import { normalizePin } from "../crypto/tokens.js";
import { HttpError, conflict } from "../lib/errors.js";

const INVALID = () => new HttpError(401, "The case code or PIN is incorrect.", "invalid_credentials");

/** Verifies case code + PIN with the same timing and error whether or not the case exists. */
async function authenticateCase(db: Db, input: StatusLookupInput) {
  const [report] = await db.select().from(reports).where(eq(reports.caseCode, input.caseCode)).limit(1);
  const ok = await verifySecret(report?.pinHash ?? (await dummySecretHash()), normalizePin(input.pin));
  if (!report || !ok) throw INVALID();
  return report;
}

async function buildStatus(db: Db, report: Awaited<ReturnType<typeof authenticateCase>>): Promise<StatusResponse> {
  const messages = await db
    .select({ id: reportMessages.id, author: reportMessages.author, body: reportMessages.body, createdAt: reportMessages.createdAt })
    .from(reportMessages)
    .where(eq(reportMessages.reportId, report.id))
    .orderBy(asc(reportMessages.createdAt));
  return {
    caseCode: report.caseCode,
    status: report.status,
    title: report.title,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    messages: messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
  };
}

export const statusRoutes: FastifyPluginAsync = async (app) => {
  const { db } = app.deps;
  const strict = { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } };

  app.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  app.post("/", strict, async (req) => {
    const report = await authenticateCase(db, statusLookupSchema.parse(req.body));
    return buildStatus(db, report);
  });

  app.post("/messages", strict, async (req) => {
    const input = reporterReplySchema.parse(req.body);
    const report = await authenticateCase(db, input);
    if (isClosed(report.status)) throw conflict("This case is closed and can no longer receive messages.", "case_closed");
    await db.transaction(async (tx) => {
      await tx.insert(reportMessages).values({ reportId: report.id, author: "reporter", body: input.body });
      await tx.update(reports).set({ updatedAt: new Date() }).where(eq(reports.id, report.id));
      await tx.insert(notificationOutbox).values({
        kind: "reporter_reply",
        payload: { reportId: report.id, caseCode: report.caseCode },
      });
    });
    const [fresh] = await db.select().from(reports).where(eq(reports.id, report.id));
    return buildStatus(db, fresh!);
  });
};
