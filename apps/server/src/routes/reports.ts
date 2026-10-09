import type { FastifyPluginAsync } from "fastify";
import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { submitReportSchema, type ReportDetails, type SubmitReportResponse } from "@whistle/shared";
import { attachments, intakeSessions, notificationOutbox, reports } from "../db/schema.js";
import { encryptOptional } from "../crypto/contact.js";
import { hashSecret } from "../crypto/password.js";
import { newCaseCode, newPin, normalizePin } from "../crypto/tokens.js";
import { conflict } from "../lib/errors.js";
import { loadIntakeSession } from "./intake.js";

const WEIGHTS: [keyof ReportDetails, number][] = [
  ["what", 25],
  ["who", 15],
  ["when", 15],
  ["where", 10],
  ["howKnown", 15],
  ["evidence", 15],
  ["impact", 5],
];

/** Rough completeness used when the AI never assessed the report (e.g. AI disabled). */
export function estimateCompleteness(details: ReportDetails): number {
  return WEIGHTS.reduce((sum, [key, weight]) => sum + ((details[key] as string).trim().length >= 3 ? weight : 0), 0);
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export const reportRoutes: FastifyPluginAsync = async (app) => {
  const { db, config, storage } = app.deps;

  app.post(
    "/",
    { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } },
    async (req, reply): Promise<SubmitReportResponse> => {
      const input = submitReportSchema.parse(req.body);
      const session = await loadIntakeSession(db, input.intakeSessionId, input.intakeToken);

      const pin = newPin();
      const pinHash = await hashSecret(normalizePin(pin));
      const aiAssessed = session.completeness > 0 || session.missing.length > 0;
      const completeness = aiAssessed ? session.completeness : estimateCompleteness(input.report.details);

      let caseCode = "";
      let reportId = "";
      for (let attempt = 0; ; attempt++) {
        caseCode = newCaseCode();
        try {
          reportId = await db.transaction(async (tx) => {
            // Claim the session first so a double-submit can't create two reports.
            const claimed = await tx
              .update(intakeSessions)
              .set({ submittedAt: new Date(), draft: input.report })
              .where(and(eq(intakeSessions.id, session.id), isNull(intakeSessions.submittedAt)))
              .returning({ id: intakeSessions.id });
            if (claimed.length === 0) throw conflict("This report has already been submitted", "already_submitted");

            const [report] = await tx
              .insert(reports)
              .values({
                caseCode,
                pinHash,
                category: input.report.category,
                title: input.report.title,
                summary: input.report.summary,
                details: input.report.details,
                completeness,
                missing: aiAssessed ? session.missing : [],
                contactEmailEnc: encryptOptional(input.contact.email, config.contactKey),
                contactPhoneEnc: encryptOptional(input.contact.phone, config.contactKey),
                contactPreference: input.contact.preference,
                intakeSessionId: session.id,
              })
              .returning({ id: reports.id });

            if (input.attachmentIds.length > 0) {
              await tx
                .update(attachments)
                .set({ reportId: report!.id })
                .where(
                  and(
                    eq(attachments.intakeSessionId, session.id),
                    inArray(attachments.id, input.attachmentIds),
                    isNull(attachments.reportId),
                  ),
                );
            }
            await tx.insert(notificationOutbox).values({
              kind: "new_report",
              payload: { reportId: report!.id, caseCode },
            });
            return report!.id;
          });
          break;
        } catch (err) {
          if (isUniqueViolation(err) && attempt < 5) continue;
          throw err;
        }
      }

      // Uploaded files the reporter removed from the final selection are discarded.
      const orphaned = await db
        .delete(attachments)
        .where(
          and(
            eq(attachments.intakeSessionId, session.id),
            isNull(attachments.reportId),
            input.attachmentIds.length > 0 ? notInArray(attachments.id, input.attachmentIds) : undefined,
          ),
        )
        .returning({ storageKey: attachments.storageKey });
      await Promise.all(orphaned.map((o) => storage.remove(o.storageKey)));

      req.log.info({ reportId }, "report submitted");
      reply.header("Cache-Control", "no-store");
      return { caseCode, pin };
    },
  );
};
