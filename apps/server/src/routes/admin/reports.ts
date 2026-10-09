import type { FastifyPluginAsync } from "fastify";
import { and, asc, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import {
  adminMessageSchema,
  adminNoteSchema,
  reportListQuerySchema,
  updateStatusSchema,
  type AdminReportDetail,
  type AdminReportList,
  type RevealedContact,
} from "@whistle/shared";
import type { Tx } from "../../db/client.js";
import {
  admins,
  attachments,
  auditLog,
  intakeMessages,
  reportMessages,
  reportNotes,
  reports,
} from "../../db/schema.js";
import { decryptContact } from "../../crypto/contact.js";
import { requireAdmin } from "../../auth/session.js";
import { notFound } from "../../lib/errors.js";

const idParams = z.object({ id: z.uuid() });

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export const adminReportRoutes: FastifyPluginAsync = async (app) => {
  const { db, config, storage } = app.deps;

  app.addHook("preHandler", requireAdmin);
  app.addHook("onSend", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
  });

  async function audit(tx: Tx | typeof db, adminId: string, reportId: string, action: string, meta: Record<string, unknown> = {}) {
    await tx.insert(auditLog).values({ adminId, reportId, action, meta });
  }

  async function findReport(id: string) {
    const [report] = await db.select().from(reports).where(eq(reports.id, id)).limit(1);
    if (!report) throw notFound("Report not found");
    return report;
  }

  app.get("/reports", async (req): Promise<AdminReportList> => {
    const q = reportListQuerySchema.parse(req.query);
    const filters: SQL[] = [];
    if (q.status) filters.push(eq(reports.status, q.status));
    if (q.category) filters.push(eq(reports.category, q.category));
    if (q.from) filters.push(gte(reports.createdAt, new Date(`${q.from}T00:00:00Z`)));
    if (q.to) filters.push(lt(reports.createdAt, new Date(new Date(`${q.to}T00:00:00Z`).getTime() + 86_400_000)));
    if (q.q) {
      const term = `%${escapeLike(q.q)}%`;
      filters.push(or(ilike(reports.caseCode, term), ilike(reports.title, term), ilike(reports.summary, term))!);
    }
    const where = filters.length ? and(...filters) : undefined;

    // Correlated subqueries use explicit table names: drizzle drops qualifiers in single-table selects.
    const attachmentCount = sql<number>`(select count(*)::int from attachments a where a.report_id = reports.id)`;
    const unread = sql<number>`(select count(*)::int from report_messages m
      where m.report_id = reports.id and m.author = 'reporter'
      and m.created_at > coalesce(reports.admin_last_read_at, 'epoch'::timestamptz))`;

    const [rows, [totalRow]] = await Promise.all([
      db
        .select({
          id: reports.id,
          caseCode: reports.caseCode,
          title: reports.title,
          category: reports.category,
          status: reports.status,
          completeness: reports.completeness,
          attachmentCount,
          unreadReporterMessages: unread,
          createdAt: reports.createdAt,
          updatedAt: reports.updatedAt,
        })
        .from(reports)
        .where(where)
        .orderBy(desc(reports.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db.select({ value: count() }).from(reports).where(where),
    ]);

    return {
      items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() })),
      total: totalRow?.value ?? 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  });

  app.get("/reports/:id", async (req): Promise<AdminReportDetail> => {
    const { id } = idParams.parse(req.params);
    const report = await findReport(id);

    const [transcript, files, messages, notes, auditRows] = await Promise.all([
      report.intakeSessionId
        ? db
            .select({ role: intakeMessages.role, content: intakeMessages.content })
            .from(intakeMessages)
            .where(eq(intakeMessages.sessionId, report.intakeSessionId))
            .orderBy(asc(intakeMessages.createdAt))
        : Promise.resolve([]),
      db
        .select({ id: attachments.id, originalName: attachments.originalName, mime: attachments.mime, size: attachments.size })
        .from(attachments)
        .where(eq(attachments.reportId, id))
        .orderBy(asc(attachments.createdAt)),
      db
        .select({
          id: reportMessages.id,
          author: reportMessages.author,
          body: reportMessages.body,
          createdAt: reportMessages.createdAt,
          adminName: admins.name,
        })
        .from(reportMessages)
        .leftJoin(admins, eq(admins.id, reportMessages.adminId))
        .where(eq(reportMessages.reportId, id))
        .orderBy(asc(reportMessages.createdAt)),
      db
        .select({ id: reportNotes.id, body: reportNotes.body, createdAt: reportNotes.createdAt, adminName: admins.name })
        .from(reportNotes)
        .leftJoin(admins, eq(admins.id, reportNotes.adminId))
        .where(eq(reportNotes.reportId, id))
        .orderBy(asc(reportNotes.createdAt)),
      db
        .select({ id: auditLog.id, action: auditLog.action, meta: auditLog.meta, createdAt: auditLog.createdAt, adminName: admins.name })
        .from(auditLog)
        .leftJoin(admins, eq(admins.id, auditLog.adminId))
        .where(eq(auditLog.reportId, id))
        .orderBy(desc(auditLog.createdAt))
        .limit(100),
    ]);

    await db.update(reports).set({ adminLastReadAt: new Date() }).where(eq(reports.id, id));

    return {
      id: report.id,
      caseCode: report.caseCode,
      title: report.title,
      summary: report.summary,
      category: report.category,
      status: report.status,
      details: report.details,
      completeness: report.completeness,
      missing: report.missing,
      hasEmail: report.contactEmailEnc !== null,
      hasPhone: report.contactPhoneEnc !== null,
      contactPreference: report.contactPreference,
      transcript,
      attachments: files,
      messages: messages.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      notes: notes.map((n) => ({ ...n, adminName: n.adminName ?? "Former admin", createdAt: n.createdAt.toISOString() })),
      audit: auditRows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  });

  /** Decrypts the reporter's contact details. Every reveal is audited. */
  app.post("/reports/:id/reveal-contact", async (req): Promise<RevealedContact> => {
    const { id } = idParams.parse(req.params);
    const report = await findReport(id);
    await audit(db, req.admin!.id, id, "contact_revealed");
    return {
      email: report.contactEmailEnc ? decryptContact(report.contactEmailEnc, config.contactKey) : null,
      phone: report.contactPhoneEnc ? decryptContact(report.contactPhoneEnc, config.contactKey) : null,
      preference: report.contactPreference,
    };
  });

  app.patch("/reports/:id/status", async (req) => {
    const { id } = idParams.parse(req.params);
    const { status } = updateStatusSchema.parse(req.body);
    const report = await findReport(id);
    if (report.status === status) return { status };
    await db.transaction(async (tx) => {
      await tx.update(reports).set({ status, updatedAt: new Date() }).where(eq(reports.id, id));
      await audit(tx, req.admin!.id, id, "status_changed", { from: report.status, to: status });
    });
    return { status };
  });

  app.post("/reports/:id/messages", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { body } = adminMessageSchema.parse(req.body);
    await findReport(id);
    await db.transaction(async (tx) => {
      await tx.insert(reportMessages).values({ reportId: id, author: "admin", adminId: req.admin!.id, body });
      await tx.update(reports).set({ updatedAt: new Date() }).where(eq(reports.id, id));
      await audit(tx, req.admin!.id, id, "message_sent");
    });
    return reply.status(201).send({ ok: true });
  });

  app.post("/reports/:id/notes", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { body } = adminNoteSchema.parse(req.body);
    await findReport(id);
    await db.insert(reportNotes).values({ reportId: id, adminId: req.admin!.id, body });
    return reply.status(201).send({ ok: true });
  });

  app.get("/attachments/:id", async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const [file] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (!file?.reportId) throw notFound("Attachment not found");
    await audit(db, req.admin!.id, file.reportId, "attachment_downloaded", { attachmentId: id, name: file.originalName });
    return reply
      .header("Content-Type", file.mime)
      .header("Content-Length", String(file.size))
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`)
      .header("X-Content-Type-Options", "nosniff")
      .send(storage.read(file.storageKey));
  });
};
