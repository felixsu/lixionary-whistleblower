import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { states, outcomes, bodySchema } from "@whistle/shared";
import { requireStaff } from "../auth.js";
import { rows } from "../db/client.js";
import {
  access,
  allowedCase,
  audit,
  enqueue,
  manager,
  seal,
  unseal,
  settings,
  viewCase,
  privacyCall,
} from "../service.js";
import { HttpError } from "../lib/errors.js";
const id = (req: { params: unknown }) =>
  z.object({ id: z.uuid() }).parse(req.params).id;
const fail = (code: string) => {
  throw new HttpError(409, code, code);
};
export async function caseRoutes(app: FastifyInstance) {
  const { db, config } = app.deps;
  app.addHook("preHandler", requireStaff);
  app.get("/", async (req) => {
    const q = z
      .object({
        state: z.enum(states).optional(),
        category: z.string().max(80).optional(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
      })
      .parse(req.query);
    const s = await settings(db);
    const list = await rows(
      db,
      sql`select c.id,c.case_code,c.state,c.category,c.severity,c.sensitive,c.owner_id,c.team_id,c.created_at,c.updated_at,c.closed_at,c.acknowledged_at,c.last_response_at,
   exists(select 1 from case_messages m where m.case_id=c.id and m.author='reporter' and m.created_at>coalesce((select read_at from case_members cm where cm.case_id=c.id and cm.staff_id=${req.staff!.id}),'epoch')) unread,
   c.state<>'closed' and (c.acknowledged_at is null and c.created_at<now()-${s.body.acknowledgmentDays}*interval '1 day' or coalesce(c.last_response_at,c.created_at)<now()-${s.body.followupDays}*interval '1 day') overdue
   from cases c where ${access(req.staff!)} ${q.state ? sql`and c.state=${q.state}` : sql``} ${q.category ? sql`and c.category=${q.category}` : sql``} order by c.updated_at desc limit 50 offset ${(q.page - 1) * 50}`,
    );
    return { cases: list, page: q.page };
  });
  app.get("/:id", async (req) => {
    const c = await allowedCase(db, req.staff!, id(req));
    await rows(
      db,
      sql`insert into case_members(case_id,staff_id,read_at) values(${c.id},${req.staff!.id},now()) on conflict(case_id,staff_id) do update set read_at=now()`,
    );
    await audit(db, req.staff!.id, "case_viewed", c.id);
    return viewCase(db, c, config.keys, true);
  });
  app.get("/:id/people", async (req) => {
    const c = await allowedCase(db, req.staff!, id(req));
    return {
      staff: await rows(
        db,
        sql`select s.id,s.name,s.role from staff s join team_members m on m.staff_id=s.id where m.team_id=${c.team_id} and s.active and s.role<>'admin'`,
      ),
    };
  });
  app.post("/:id/assign", async (req) => {
    manager(req.staff!);
    const v = z
      .object({ staffId: z.uuid(), owner: z.boolean().default(false) })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      const [s] = await rows(
        tx,
        sql`select s.id from staff s join team_members t on t.staff_id=s.id where s.id=${v.staffId} and s.active and s.role<>'admin' and t.team_id=${c.team_id}`,
      );
      if (!s) fail("invalid_assignee");
      const [m] = await rows(
        tx,
        sql`select recused from case_members where case_id=${c.id} and staff_id=${v.staffId}`,
      );
      if (m?.recused) fail("assignee_recused");
      await rows(
        tx,
        sql`insert into case_members(case_id,staff_id) values(${c.id},${v.staffId}) on conflict do nothing`,
      );
      if (v.owner)
        await rows(
          tx,
          sql`update cases set owner_id=${v.staffId},updated_at=now() where id=${c.id}`,
        );
      await audit(tx, req.staff!.id, "case_assigned", c.id, {
        staffId: v.staffId,
        owner: v.owner,
      });
      await enqueue(tx, "staff_alert", c.id, { event: "assignment" });
    });
    return { ok: true };
  });
  app.post("/:id/recuse", async (req) => {
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      await rows(
        tx,
        sql`insert into case_members(case_id,staff_id,recused) values(${c.id},${req.staff!.id},true) on conflict(case_id,staff_id) do update set recused=true`,
      );
      await rows(
        tx,
        sql`update cases set owner_id=null where id=${c.id} and owner_id=${req.staff!.id}`,
      );
      await audit(tx, req.staff!.id, "case_recused", c.id);
      await enqueue(tx, "staff_alert", c.id, { event: "recusal" });
    });
    return { ok: true };
  });
  app.post("/:id/state", async (req) => {
    const v = z.object({ state: z.enum(states) }).parse(req.body);
    const transitions: Record<string, string[]> = {
      received: ["triage"],
      triage: ["investigating"],
      investigating: ["waiting_reporter"],
      waiting_reporter: ["investigating"],
      closure_review: [],
      closed: [],
    };
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (!transitions[c.state]?.includes(v.state)) fail("invalid_transition");
      await rows(
        tx,
        sql`update cases set state=${v.state},updated_at=now(),acknowledged_at=coalesce(acknowledged_at,now()) where id=${c.id}`,
      );
      await audit(tx, req.staff!.id, "case_state_changed", c.id, {
        from: c.state,
        to: v.state,
      });
      await enqueue(tx, "reporter_notify", c.id, { event: "state" });
    });
    return { ok: true };
  });
  app.post("/:id/messages", async (req) => {
    const v = bodySchema.parse(req.body);
    const mid = randomUUID();
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (c.state === "closed") fail("case_closed");
      await rows(
        tx,
        sql`insert into case_messages(id,case_id,author,staff_id,body_enc) values(${mid},${c.id},'staff',${req.staff!.id},${seal(v.body, config.keys, `message:${mid}`)})`,
      );
      await rows(
        tx,
        sql`update cases set updated_at=now(),last_response_at=now(),acknowledged_at=coalesce(acknowledged_at,now()) where id=${c.id}`,
      );
      await audit(tx, req.staff!.id, "message_sent", c.id);
      await enqueue(tx, "reporter_notify", c.id, { event: "message" });
    });
    return { ok: true };
  });
  app.post("/:id/records", async (req) => {
    const v = z
      .object({
        kind: z.enum(["note", "finding", "task"]),
        body: z.string().trim().min(1).max(10000),
        dueAt: z.iso.datetime().nullable().default(null),
        ownerId: z.uuid().nullable().default(null),
      })
      .parse(req.body);
    const rid = randomUUID();
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (c.state === "closed") fail("case_closed");
      if (v.ownerId) {
        const [s] = await rows(
          tx,
          sql`select s.id from staff s join team_members t on t.staff_id=s.id where s.id=${v.ownerId} and t.team_id=${c.team_id} and s.active and s.role<>'admin' and not exists(select 1 from case_members cm where cm.case_id=${c.id} and cm.staff_id=s.id and cm.recused)`,
        );
        if (!s) fail("invalid_assignee");
      }
      await rows(
        tx,
        sql`insert into case_records(id,case_id,staff_id,kind,body_enc,due_at,owner_id) values(${rid},${c.id},${req.staff!.id},${v.kind},${seal({ text: v.body }, config.keys, `record:${rid}`)},${v.dueAt ? new Date(v.dueAt) : null},${v.ownerId ?? (v.kind === "task" ? req.staff!.id : null)})`,
      );
      await audit(tx, req.staff!.id, "record_created", c.id, { kind: v.kind });
    });
    return { id: rid };
  });
  app.post("/:id/tasks/:taskId/complete", async (req) => {
    const p = z.object({ id: z.uuid(), taskId: z.uuid() }).parse(req.params),
      v = z
        .object({ completionEvidence: z.string().trim().min(10).max(4000) })
        .parse(req.body);
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, p.id, true);
      if (c.state === "closed") fail("case_closed");
      const [r] = await rows(
        tx,
        sql`select * from case_records where id=${p.taskId} and case_id=${c.id} and kind='task' for update`,
      );
      if (!r) throw new HttpError(404, "Not found", "not_found");
      const prior = unseal<Record<string, unknown>>(
        String(r.body_enc),
        config.keys,
        `record:${r.id}`,
      );
      await rows(
        tx,
        sql`update case_records set body_enc=${seal({ ...prior, completionEvidence: v.completionEvidence }, config.keys, `record:${r.id}`)},completed_at=now(),updated_at=now() where id=${r.id}`,
      );
      await audit(tx, req.staff!.id, "task_completed", c.id);
    });
    return { ok: true };
  });
  app.post("/:id/classification", async (req) => {
    const v = z
      .object({
        severity: z.enum(["normal", "high", "critical"]),
        category: z.string().max(80),
      })
      .parse(req.body);
    const s = await settings(db);
    if (!s.body.categories.some((c) => c.key === v.category))
      throw new HttpError(400, "Category", "validation_error");
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (c.state === "closed") fail("case_closed");
      await rows(
        tx,
        sql`update cases set severity=${v.severity},category=${v.category},updated_at=now() where id=${c.id}`,
      );
      await audit(tx, req.staff!.id, "case_classified", c.id, {
        severity: v.severity,
        category: v.category,
      });
    });
    return { ok: true };
  });
  app.post("/:id/escalate", async (req) => {
    manager(req.staff!);
    const v = z
        .object({ reason: z.string().trim().min(10).max(4000) })
        .parse(req.body),
      s = await settings(db),
      rid = randomUUID();
    if (!s.body.restrictedTeamId) fail("configuration_incomplete");
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (c.sensitive) fail("already_restricted");
      await rows(
        tx,
        sql`update cases set sensitive=true,team_id=${s.body.restrictedTeamId},owner_id=null,updated_at=now() where id=${c.id}`,
      );
      await rows(tx, sql`delete from case_members where case_id=${c.id}`);
      await rows(
        tx,
        sql`insert into case_records(id,case_id,staff_id,kind,body_enc) values(${rid},${c.id},${req.staff!.id},'note',${seal({ text: v.reason, previousClosure: c.closure, previousClosureDetails: c.closure_enc ? unseal(String(c.closure_enc), config.keys, "closure:" + c.id) : null }, config.keys, `record:${rid}`)})`,
      );
      await audit(tx, req.staff!.id, "case_restricted", c.id);
      await enqueue(tx, "staff_alert", c.id, { event: "escalation" });
    });
    return { ok: true };
  });
  app.post("/:id/subscription", async (req) => {
    const v = z.object({ subscribed: z.boolean() }).parse(req.body);
    const c = await allowedCase(db, req.staff!, id(req));
    await rows(
      db,
      sql`insert into case_members(case_id,staff_id,subscribed) values(${c.id},${req.staff!.id},${v.subscribed}) on conflict(case_id,staff_id) do update set subscribed=excluded.subscribed`,
    );
    await audit(db, req.staff!.id, "case_subscription_changed", c.id, {
      subscribed: v.subscribed,
    });
    return { ok: true };
  });
  app.post("/:id/verification", async (req) => {
    const v = z
      .object({ reason: z.string().trim().min(10).max(1000) })
      .parse(req.body);
    const rid = randomUUID();
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (c.state === "closed") fail("case_closed");
      await rows(
        tx,
        sql`update verification_requests set state='superseded' where case_id=${c.id} and state='pending'`,
      );
      await rows(
        tx,
        sql`insert into verification_requests(id,case_id,staff_id,reason_enc) values(${rid},${c.id},${req.staff!.id},${seal(v.reason, config.keys, `verification:${rid}`)})`,
      );
      await rows(
        tx,
        sql`update cases set verification_state='pending' where id=${c.id}`,
      );
      await audit(tx, req.staff!.id, "verification_requested", c.id);
      await enqueue(tx, "reporter_notify", c.id, { event: "verification" });
    });
    return { ok: true };
  });
  app.post("/:id/closure", async (req) => {
    const v = z
      .object({
        outcome: z.enum(outcomes),
        rationale: z.string().trim().min(20).max(10000),
        publicExplanation: z.string().trim().min(20).max(4000),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (!["triage", "investigating", "waiting_reporter"].includes(c.state))
        fail("invalid_transition");
      const [open] = await rows(
        tx,
        sql`select id from case_records where case_id=${c.id} and kind='task' and completed_at is null limit 1`,
      );
      if (open) fail("open_corrective_actions");
      await rows(
        tx,
        sql`update cases set state='closure_review',closure=${JSON.stringify({ outcome: v.outcome, requestedBy: req.staff!.id })}::jsonb,closure_enc=${seal({ ...v, requestedBy: req.staff!.id }, config.keys, `closure:${c.id}`)},updated_at=now() where id=${c.id}`,
      );
      await audit(tx, req.staff!.id, "closure_requested", c.id, {
        outcome: v.outcome,
      });
      await enqueue(tx, "staff_alert", c.id, { event: "closure_review" });
    });
    return { ok: true };
  });
  app.post("/:id/closure/review", async (req) => {
    manager(req.staff!);
    const v = z
      .object({
        approve: z.boolean(),
        reason: z.string().trim().min(10).max(4000),
      })
      .parse(req.body);
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (
        c.state !== "closure_review" ||
        c.closure?.requestedBy === req.staff!.id
      )
        fail("independent_review_required");
      await rows(
        tx,
        sql`update cases set state=${v.approve ? "closed" : "investigating"},closure=${JSON.stringify({ ...c.closure, reviewedBy: req.staff!.id, approved: v.approve })}::jsonb,closure_enc=${seal({ ...unseal<Record<string, unknown>>(String(c.closure_enc), config.keys, `closure:${c.id}`), reviewedBy: req.staff!.id, reviewReason: v.reason, approved: v.approve }, config.keys, `closure:${c.id}`)},closed_at=${v.approve ? new Date() : null},updated_at=now() where id=${c.id}`,
      );
      await audit(
        tx,
        req.staff!.id,
        v.approve ? "closure_approved" : "closure_rejected",
        c.id,
      );
      await enqueue(tx, "reporter_notify", c.id, { event: "closure" });
    });
    return { ok: true };
  });
  app.post("/:id/reopen", async (req) => {
    manager(req.staff!);
    const v = z
      .object({ reason: z.string().trim().min(10).max(4000) })
      .parse(req.body);
    const rid = randomUUID();
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (c.state !== "closed") fail("invalid_transition");
      await rows(
        tx,
        sql`insert into case_records(id,case_id,staff_id,kind,body_enc) values(${rid},${c.id},${req.staff!.id},'note',${seal({ text: v.reason, previousClosure: c.closure, previousClosureDetails: c.closure_enc ? unseal(String(c.closure_enc), config.keys, "closure:" + c.id) : null }, config.keys, `record:${rid}`)})`,
      );
      await rows(
        tx,
        sql`update cases set state='investigating',closed_at=null,closure=null,closure_enc=null,updated_at=now() where id=${c.id}`,
      );
      await audit(tx, req.staff!.id, "case_reopened", c.id);
      await enqueue(tx, "reporter_notify", c.id, { event: "reopen" });
    });
    return { ok: true };
  });
  app.post("/:id/hold", async (req) => {
    manager(req.staff!);
    const v = z
      .object({
        hold: z.boolean(),
        reason: z.string().trim().min(10).max(1000),
      })
      .parse(req.body);
    const rid = randomUUID();
    await db.transaction(async (tx) => {
      const c = await allowedCase(tx, req.staff!, id(req), true);
      if (
        v.hold &&
        c.privacy_lease_until &&
        new Date(String(c.privacy_lease_until)).getTime() > Date.now()
      )
        fail("retention_in_progress");
      await rows(tx, sql`update cases set hold=${v.hold} where id=${c.id}`);
      await rows(
        tx,
        sql`insert into case_records(id,case_id,staff_id,kind,body_enc) values(${rid},${c.id},${req.staff!.id},'note',${seal({ text: v.reason, previousClosure: c.closure, previousClosureDetails: c.closure_enc ? unseal(String(c.closure_enc), config.keys, "closure:" + c.id) : null }, config.keys, `record:${rid}`)})`,
      );
      await audit(tx, req.staff!.id, "legal_hold_changed", c.id, {
        hold: v.hold,
      });
    });
    return { ok: true };
  });
  app.get("/:id/evidence/:evidenceId", async (req, reply) => {
    const p = z
      .object({ id: z.uuid(), evidenceId: z.uuid() })
      .parse(req.params);
    const c = await allowedCase(db, req.staff!, p.id);
    const [e] = await rows(
      db,
      sql`select * from evidence where id=${p.evidenceId} and case_id=${c.id}`,
    );
    if (!e || e.purged_at) throw new HttpError(404, "Not found", "not_found");
    const response = await privacyCall(req, "evidence", {
      caseId: c.id,
      evidenceId: p.evidenceId,
    });
    await audit(db, req.staff!.id, "evidence_downloaded", c.id, {
      evidenceId: p.evidenceId,
    });
    reply
      .header("Content-Type", String(e.mime))
      .header(
        "Content-Disposition",
        `attachment; filename="evidence-${e.id}.${e.mime === "application/pdf" ? "pdf" : "png"}"`,
      );
    return reply.send(Buffer.from(await response.arrayBuffer()));
  });
}
