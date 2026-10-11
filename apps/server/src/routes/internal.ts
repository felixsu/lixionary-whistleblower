import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { equal, mac } from "@whistle/runtime";
import { rows } from "../db/client.js";
import { audit, settings } from "../service.js";
import { HttpError } from "../lib/errors.js";
export async function internalRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  app.addHook("preHandler", async (req) => {
    const stamp = String(req.headers["x-service-time"] ?? "");
    const signature = String(req.headers["x-service-signature"] ?? "");
    const path = req.url.slice("/internal/".length);
    if (
      !/^\d{13}$/.test(stamp) ||
      Math.abs(Date.now() - Number(stamp)) > 30000 ||
      !equal(
        signature,
        mac(config.eventKey, `${stamp}:${path}:${JSON.stringify(req.body)}`),
      )
    )
      throw new HttpError(401, "Unauthorized", "unauthorized");
  });
  app.post("/introspect", async (req) => {
    const v = z
      .object({ caseId: z.uuid(), sid: z.uuid(), version: z.number().int() })
      .parse(req.body);
    const [c] = await rows(
      db,
      sql`select c.id,c.hold,c.state,c.secret_version,c.content_enc from reporter_sessions s join cases c on c.id=s.case_id where s.id=${v.sid} and c.id=${v.caseId} and c.secret_version=${v.version} and s.secret_version=c.secret_version and s.expires_at>now() and s.last_seen_at>now()-interval '30 minutes'`,
    );
    const s = await settings(db);
    return {
      active: !!c,
      hold: c?.hold ?? false,
      state: c?.state ?? null,
      settings: s.body,
      policyVersion: s.version,
    };
  });
  app.post("/case-exists", async (req) => {
    const { caseId } = z.object({ caseId: z.uuid() }).parse(req.body);
    const [c] = await rows(db, sql`select id from cases where id=${caseId}`);
    return { exists: !!c };
  });
  app.post("/configuration", async () => {
    const s = await settings(db);
    return {
      settings: s.body,
      configured: s.configured,
      policyVersion: s.version,
    };
  });
  app.post("/events", async (req) => {
    const v = z
      .discriminatedUnion("kind", [
        z.object({
          id: z.uuid(),
          kind: z.literal("verification"),
          caseId: z.uuid(),
          verified: z.boolean(),
          version: z.number().int().positive(),
          requestId: z.uuid().nullable(),
        }),
        z.object({
          id: z.uuid(),
          kind: z.literal("audit"),
          caseId: z.uuid(),
          action: z.enum([
            "evidence_uploaded",
            "evidence_scanned",
            "evidence_rejected",
            "evidence_redacted",
            "evidence_approved",
            "evidence_withdrawn",
          ]),
          evidenceId: z.uuid(),
          sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        }),
        z.object({
          id: z.uuid(),
          kind: z.literal("evidence"),
          caseId: z.uuid(),
          evidenceId: z.uuid(),
          label: z.string().min(1).max(100),
          mime: z.enum(["image/png", "application/pdf"]),
          size: z.number().int().positive().max(50000000),
          sha256: z.string().regex(/^[a-f0-9]{64}$/),
          originalSha256: z.string().regex(/^[a-f0-9]{64}$/),
          transformation: z.string().max(100),
        }),
      ])
      .parse(req.body);
    await db.transaction(async (tx) => {
      const [event] = await rows(
        tx,
        sql`insert into event_receipts(id) values(${v.id}) on conflict do nothing returning id`,
      );
      if (!event) return;
      const [c] = await rows(
        tx,
        sql`select id,state from cases where id=${v.caseId} for update`,
      );
      if (!c) return;
      if (v.kind === "audit") {
        await audit(tx, "privacy_service", v.action, v.caseId, {
          evidenceId: v.evidenceId,
          ...(v.sha256 ? { sha256: v.sha256 } : {}),
        });
      } else if (v.kind === "verification") {
        const [version] = await rows(
          tx,
          sql`select verification_version from cases where id=${v.caseId}`,
        );
        if (Number(version?.verification_version) >= v.version) return;
        await rows(
          tx,
          sql`update cases set verification_version=${v.version},verified_at=${v.verified ? new Date() : null},verification_state=${v.verified ? "verified" : "none"} where id=${v.caseId}`,
        );
        if (v.requestId && v.verified)
          await rows(
            tx,
            sql`update verification_requests set state='verified' where id=${v.requestId} and case_id=${v.caseId} and state='pending'`,
          );
        await audit(
          tx,
          "privacy_service",
          v.verified ? "contact_verified" : "contact_removed",
          v.caseId,
        );
      } else {
        if (c.state === "closed")
          throw new HttpError(409, "Case closed", "case_closed");
        await rows(
          tx,
          sql`insert into evidence(id,case_id,label,mime,size,sha256,original_sha256,transformation) values(${v.evidenceId},${v.caseId},${v.label},${v.mime},${v.size},${v.sha256},${v.originalSha256},${v.transformation}) on conflict do nothing`,
        );
        await audit(tx, "privacy_service", "evidence_published", v.caseId, {
          evidenceId: v.evidenceId,
        });
      }
    });
    return { ok: true };
  });

  app.post("/privacy/lease", async (req) => {
    const v = z
      .object({
        caseId: z.uuid(),
        sid: z.uuid(),
        version: z.number().int().positive(),
      })
      .parse(req.body);
    return db.transaction(async (tx) => {
      const [c] = await rows(
        tx,
        sql`select c.id,c.hold,c.privacy_lease_until from cases c join reporter_sessions rs on rs.case_id=c.id where c.id=${v.caseId} and rs.id=${v.sid} and c.secret_version=${v.version} and rs.secret_version=c.secret_version and rs.expires_at>now() and rs.last_seen_at>now()-interval '30 minutes' for update of c`,
      );
      if (!c) throw new HttpError(401, "Unauthorized", "unauthorized");
      if (c.hold) throw new HttpError(409, "Legal hold", "legal_hold");
      if (
        c.privacy_lease_until &&
        new Date(String(c.privacy_lease_until)).getTime() > Date.now()
      )
        throw new HttpError(
          409,
          "Maintenance in progress",
          "retention_in_progress",
        );
      const lease = randomUUID();
      await rows(
        tx,
        sql`update cases set privacy_lease=${lease},privacy_lease_until=now()+interval '90 seconds' where id=${c.id}`,
      );
      return { lease };
    });
  });
  app.post("/retention/lease", async (req) => {
    const v = z
      .object({
        caseId: z.uuid(),
        kind: z.enum(["contacts", "evidence", "transcripts"]),
        createdAt: z.iso.datetime(),
        evidenceId: z.uuid().optional(),
      })
      .parse(req.body);
    return db.transaction(async (tx) => {
      const s = await settings(tx);
      const [c] = await rows(
        tx,
        sql`select id,hold,privacy_lease_until from cases where id=${v.caseId} for update`,
      );
      if (
        !c ||
        !s.configured ||
        !s.body.retention ||
        c.hold ||
        (c.privacy_lease_until &&
          new Date(String(c.privacy_lease_until)).getTime() > Date.now())
      )
        return { allowed: false };
      if (
        new Date(v.createdAt).getTime() >
        Date.now() - s.body.retention[v.kind] * 89550000
      )
        return { allowed: false };
      const lease = randomUUID();
      await rows(
        tx,
        sql`update cases set privacy_lease=${lease},privacy_lease_until=now()+interval '90 seconds' where id=${v.caseId}`,
      );
      return { allowed: true, lease };
    });
  });
  app.post("/retention/release", async (req) => {
    const v = z
      .object({
        caseId: z.uuid(),
        lease: z.uuid(),
        evidenceId: z.uuid().optional(),
        contactRemoved: z.boolean().default(false),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const [c] = await rows(
        tx,
        sql`update cases set privacy_lease=null,privacy_lease_until=null where id=${v.caseId} and privacy_lease=${v.lease} returning id`,
      );
      if (!c) return;
      if (v.evidenceId) {
        await rows(
          tx,
          sql`update evidence set purged_at=now() where id=${v.evidenceId} and case_id=${v.caseId}`,
        );
        await audit(tx, "retention_service", "evidence_deleted", v.caseId, {
          evidenceId: v.evidenceId,
        });
      }
      if (v.contactRemoved) {
        await audit(
          tx,
          "retention_service",
          "contact_retention_applied",
          v.caseId,
        );
      }
    });
    return { ok: true };
  });
  app.post("/retention", async () => {
    const s = await settings(db);
    return {
      settings: s.body,
      configured: s.configured,
      held: await rows(db, sql`select id from cases where hold`),
      deleted: await rows(db, sql`select case_id from deletion_manifest`),
    };
  });
}
