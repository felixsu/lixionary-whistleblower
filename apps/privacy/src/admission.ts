import type { FastifyInstance, FastifyRequest } from "fastify";
import { sql } from "drizzle-orm";
import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  admissionChallengeSchema,
  admissionVerifySchema,
  employeeSchema,
  employeeUpdateSchema,
  employeeQuerySchema,
  type EmployeeInput,
} from "@whistle/shared";
import {
  digest,
  mac,
  equal,
  seal,
  unseal,
  token,
  emailConfigured,
} from "@whistle/runtime";
import { rows, type Tx } from "./db/client.js";
import { csrf, internalAuth, PrivacyError, queue } from "./service.js";
import type { Config } from "./config.js";
const rawToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const accessToken = (req: FastifyRequest) =>
  rawToken.safeParse(req.headers["x-report-access"]).data ?? "";
export const emailHash = (config: Config, email: string) =>
  mac(config.abuseKey, `employee:${email}`);

// All operations on a grant share a nonblocking transaction lock, including AI.
// The employee lock serializes deactivation/email edits with access checks.
export async function grant(tx: Tx, raw: string, allowExpired = false) {
  const hash = digest(raw);
  const [lock] = await rows(
    tx,
    sql`select pg_try_advisory_xact_lock(hashtextextended(${"admission:" + hash},0)) locked`,
  );
  if (!lock?.locked) throw new PrivacyError(409, "report_busy");
  const [owner] = await rows(
    tx,
    sql`select employee_id from admission_grants where token_hash=${hash}`,
  );
  if (owner?.employee_id)
    await rows(
      tx,
      sql`select id from employees where id=${owner.employee_id} for share`,
    );
  const [g] = await rows(
    tx,
    sql`select g.* from admission_grants g join employees e on e.id=g.employee_id where g.token_hash=${hash} and g.revoked_at is null and g.reserved_at is null and e.active ${allowExpired ? sql`` : sql`and g.expires_at>now()`} for update of g for share of e`,
  );
  if (!g) throw new PrivacyError(401, "report_access_required");
  return g;
}
export async function admissionRoutes(app: FastifyInstance) {
  const { db, config, limiter } = app.privacyDeps;
  app.register(
    async (publicApi) => {
      publicApi.addHook("preHandler", async (req) => {
        csrf(req);
        if (
          !(await limiter.hit(
            mac(
              config.abuseKey,
              `admission-ip:${req.ip}:${req.routeOptions.url}`,
            ),
            req.routeOptions.url?.endsWith("/requests")
              ? 20
              : req.routeOptions.url?.endsWith("/challenge")
                ? 60
                : 100,
            3600,
          ))
        )
          throw new PrivacyError(429, "rate_limit");
      });
      publicApi.post("/challenge", async (req) => {
        const v = admissionChallengeSchema.parse(req.body),
          hash = emailHash(config, v.email);
        const [employee] = await rows(
          db,
          sql`select active from employees where email_hash=${hash}`,
        );
        if (employee && !employee.active) return { status: "disabled" };
        if (v.purpose === "report" && !employee)
          return { status: "unregistered" };
        if (v.purpose === "request" && employee)
          throw new PrivacyError(409, "employee_exists");
        if (!emailConfigured(config.email))
          throw new PrivacyError(503, "email_unavailable");
        for (const [suffix, max, seconds] of [
          ["resend", 1, 60],
          ["hour", 5, 3600],
          ["day", 20, 86400],
        ] as const)
          if (
            !(await limiter.hit(
              `admission-otp:${hash}:${suffix}`,
              max,
              seconds,
            ))
          )
            throw new PrivacyError(429, "otp_rate_limit");
        const id = randomUUID(),
          code = String(randomInt(0, 1000000)).padStart(6, "0");
        await db.transaction(async (tx) => {
          await rows(
            tx,
            sql`select pg_advisory_xact_lock(hashtextextended(${"challenge:" + hash},0))`,
          );
          await rows(
            tx,
            sql`update admission_challenges set used_at=now(),proof_hash=null where email_hash=${hash} and submitted_at is null`,
          );
          await rows(
            tx,
            sql`insert into admission_challenges(id,email_hash,email_enc,purpose,code_hash,locale,expires_at) values(${id},${hash},${seal(v.email, config.keys, "admission-challenge:" + id)},${v.purpose},${mac(config.abuseKey, id + ":" + code)},${v.locale},now()+interval '5 minutes')`,
          );
          await queue(tx, config, "admission_otp", null, {
            destination: v.email,
            kind: "email",
            code,
            locale: v.locale,
            challengeId: id,
            expiresAt: Date.now() + 300000,
          });
        });
        return {
          status: "otp",
          challengeId: id,
          expiresIn: 300,
          resendAfter: 60,
        };
      });
      publicApi.post("/verify", async (req) => {
        const v = admissionVerifySchema.parse(req.body);
        // Return failures from the transaction so failed attempts are committed.
        const result = await db.transaction(async (tx) => {
          const [hint] = await rows(
            tx,
            sql`select email_hash from admission_challenges where id=${v.challengeId}`,
          );
          if (hint)
            await rows(
              tx,
              sql`select id from employees where email_hash=${hint.email_hash} for share`,
            );
          const [c] = await rows(
            tx,
            sql`select * from admission_challenges where id=${v.challengeId} and used_at is null and expires_at>now() for update`,
          );
          if (!c || Number(c.attempts) >= 5) return null;
          await rows(
            tx,
            sql`update admission_challenges set attempts=attempts+1 where id=${c.id}`,
          );
          if (
            !equal(
              String(c.code_hash),
              mac(config.abuseKey, c.id + ":" + v.code),
            )
          )
            return null;
          await rows(
            tx,
            sql`update admission_challenges set used_at=now() where id=${c.id}`,
          );
          const [e] = await rows(
            tx,
            sql`select id,active from employees where email_hash=${c.email_hash} for share`,
          );
          if (c.purpose === "request") {
            if (e) return null;
            const raw = token();
            await rows(
              tx,
              sql`update admission_challenges set proof_hash=${digest(raw)},proof_expires_at=now()+interval '15 minutes' where id=${c.id}`,
            );
            return { requestToken: raw, expiresIn: 900 };
          }
          if (!e?.active) return null;
          if (v.resumeToken) {
            const g = await grant(tx, v.resumeToken, true);
            if (g.employee_id !== e.id) return null;
            await rows(
              tx,
              sql`update admission_grants set expires_at=now()+interval '2 hours' where id=${g.id}`,
            );
            return { reportToken: v.resumeToken, expiresIn: 7200 };
          }
          const id = randomUUID(),
            raw = token();
          await rows(
            tx,
            sql`insert into admission_grants(id,token_hash,employee_id,expires_at) values(${id},${digest(raw)},${e.id},now()+interval '2 hours')`,
          );
          return { reportToken: raw, expiresIn: 7200 };
        });
        if (!result) throw new PrivacyError(400, "invalid_or_expired_code");
        return result;
      });
      publicApi.post("/requests", async (req) => {
        const v = employeeSchema
          .extend({ requestToken: rawToken })
          .parse(req.body);
        await db.transaction(async (tx) => {
          const [c] = await rows(
            tx,
            sql`select * from admission_challenges where proof_hash=${digest(v.requestToken)} and purpose='request' and submitted_at is null and proof_expires_at>now() for update`,
          );
          if (!c || c.email_hash !== emailHash(config, v.email))
            throw new PrivacyError(401, "request_verification_required");
          await rows(
            tx,
            sql`select pg_advisory_xact_lock(hashtextextended(${"directory:" + c.email_hash},0))`,
          );
          const [e] = await rows(
            tx,
            sql`select id from employees where email_hash=${c.email_hash}`,
          );
          if (e) throw new PrivacyError(409, "employee_exists");
          const id = randomUUID();
          await rows(
            tx,
            sql`insert into employee_requests(id,email_hash,body_enc,locale) values(${id},${c.email_hash},${seal({ name: v.name, email: v.email, phone: v.phone }, config.keys, "employee-request:" + id)},${c.locale}) on conflict(email_hash) where state='pending' do nothing`,
          );
          await rows(
            tx,
            sql`update admission_challenges set submitted_at=now(),proof_hash=null where id=${c.id}`,
          );
        });
        return { state: "pending" };
      });
      publicApi.post("/cancel", async (req) => {
        const v = z
          .object({
            reportToken: rawToken.optional(),
            challengeId: z.uuid().optional(),
          })
          .parse(req.body);
        if (v.challengeId)
          await rows(
            db,
            sql`update admission_challenges set used_at=now(),proof_hash=null where id=${v.challengeId}`,
          );
        if (v.reportToken)
          await db.transaction(async (tx) => {
            const [g] = await rows(
              tx,
              sql`select id from admission_grants where token_hash=${digest(v.reportToken!)} and reserved_at is null for update`,
            );
            if (g) {
              await rows(
                tx,
                sql`delete from intakes where admission_id=${g.id} and case_id is null`,
              );
              await rows(
                tx,
                sql`delete from admission_grants where id=${g.id}`,
              );
            }
          });
        return { ok: true };
      });
    },
    { prefix: "/privacy/admission" },
  );

  const decode = (r: Record<string, unknown>, prefix: string) => ({
    ...unseal<EmployeeInput>(
      String(r.body_enc),
      config.keys,
      `${prefix}:${r.id}`,
    ),
    id: String(r.id),
    active: r.active,
    state: r.state,
    locale: r.locale,
    createdAt: r.created_at,
  });
  const directoryAudit = async (
    tx: Tx,
    actor: string,
    action: string,
    id: string,
  ) =>
    queue(tx, config, "directory_audit", null, {
      id: randomUUID(),
      actor,
      action,
      recordId: id,
    });
  app.register(
    async (internal) => {
      internal.addHook("preHandler", internalAuth);
      internal.post("/employees/list", async (req) => {
        const v = employeeQuerySchema.parse(req.body);
        // Search encrypted fields in service memory; never copy a plaintext index to the case database.
        const list = (
          await rows(
            db,
            sql`select * from employees order by created_at desc,id`,
          )
        )
          .map((r) => decode(r, "employee"))
          .filter((r) =>
            [r.name, r.email, r.phone].some((x) =>
              x.toLowerCase().includes(v.q.toLowerCase()),
            ),
          );
        return {
          items: list.slice((v.page - 1) * 25, v.page * 25),
          total: list.length,
          page: v.page,
        };
      });
      internal.post("/employees/save", async (req) => {
        const v = employeeUpdateSchema
            .extend({ id: z.uuid().optional(), actor: z.uuid() })
            .parse(req.body),
          id = v.id ?? randomUUID(),
          hash = emailHash(config, v.email);
        await db.transaction(async (tx) => {
          await rows(
            tx,
            sql`select pg_advisory_xact_lock(hashtextextended(${"directory:" + hash},0))`,
          );
          const [duplicate] = await rows(
            tx,
            sql`select id from employees where email_hash=${hash} and id<>${id}`,
          );
          if (duplicate) throw new PrivacyError(409, "duplicate_email");
          const body = seal(
            { name: v.name, email: v.email, phone: v.phone },
            config.keys,
            "employee:" + id,
          );
          if (v.id) {
            const [old] = await rows(
              tx,
              sql`select * from employees where id=${id} for update`,
            );
            if (!old) throw new PrivacyError(404, "not_found");
            if (!v.active || old.email_hash !== hash) {
              await rows(
                tx,
                sql`update admission_grants set revoked_at=now(),employee_id=null where employee_id=${id} and reserved_at is null`,
              );
              await rows(
                tx,
                sql`update admission_challenges set used_at=now(),proof_hash=null where email_hash=${old.email_hash}`,
              );
            }
            await rows(
              tx,
              sql`update employees set body_enc=${body},email_hash=${hash},active=${v.active} where id=${id}`,
            );
          } else
            await rows(
              tx,
              sql`insert into employees(id,email_hash,body_enc,active) values(${id},${hash},${body},${v.active})`,
            );
          await directoryAudit(
            tx,
            v.actor,
            v.id ? "employee_updated" : "employee_added",
            id,
          );
        });
        return { id };
      });
      internal.post("/employee-requests/list", async (req) => {
        const v = employeeQuerySchema.parse(req.body);
        const [count] = await rows(
          db,
          sql`select count(*)::int total from employee_requests where state=${v.state}`,
        );
        return {
          items: (
            await rows(
              db,
              sql`select * from employee_requests where state=${v.state} order by created_at,id limit 25 offset ${(v.page - 1) * 25}`,
            )
          ).map((r) => decode(r, "employee-request")),
          total: Number(count?.total),
          page: v.page,
        };
      });
      internal.post("/employee-requests/resolve", async (req) => {
        const v = z
          .object({
            id: z.uuid(),
            actor: z.uuid(),
            decision: z.enum(["approved", "rejected"]),
            employee: employeeSchema.optional(),
          })
          .parse(req.body);
        await db.transaction(async (tx) => {
          const [r] = await rows(
            tx,
            sql`select * from employee_requests where id=${v.id} for update`,
          );
          if (!r) throw new PrivacyError(404, "not_found");
          if (r.state !== "pending")
            throw new PrivacyError(409, "request_resolved");
          const original = unseal<EmployeeInput>(
              String(r.body_enc),
              config.keys,
              "employee-request:" + r.id,
            ),
            body = v.employee ?? original;
          if (v.decision === "approved") {
            const hash = emailHash(config, body.email);
            await rows(
              tx,
              sql`select pg_advisory_xact_lock(hashtextextended(${"directory:" + hash},0))`,
            );
            const [e] = await rows(
              tx,
              sql`select id from employees where email_hash=${hash}`,
            );
            if (e) throw new PrivacyError(409, "duplicate_email");
            const id = randomUUID();
            await rows(
              tx,
              sql`insert into employees(id,email_hash,body_enc) values(${id},${hash},${seal(body, config.keys, "employee:" + id)})`,
            );
            await directoryAudit(tx, v.actor, "employee_added", id);
          }
          await rows(
            tx,
            sql`update employee_requests set state=${v.decision},resolved_at=now() where id=${r.id}`,
          );
          await directoryAudit(
            tx,
            v.actor,
            "employee_request_" + v.decision,
            String(r.id),
          );
          // Always notify the verified request destination, even if the admin corrected the employee email.
          await queue(tx, config, "admission_decision", null, {
            destination: original.email,
            decision: v.decision,
            locale: r.locale,
          });
        });
        return { ok: true };
      });
      internal.post("/admission/reserve", async (req) => {
        const v = z
          .object({
            reportToken: rawToken,
            submissionHash: z.string().regex(/^[a-f0-9]{64}$/),
            caseId: z.uuid(),
            aiConsent: z.boolean().default(false),
            policyVersion: z.number().int().positive().optional(),
            locale: z.enum(["en", "id"]).default("en"),
            intakeId: z.uuid().optional(),
            intakeToken: z.string().optional(),
          })
          .parse(req.body);
        await db.transaction(async (tx) => {
          const [old] = await rows(
            tx,
            sql`select * from admission_grants where token_hash=${digest(v.reportToken)}`,
          );
          if (old?.reserved_at) {
            if (
              old.submission_hash !== v.submissionHash ||
              old.case_id !== v.caseId ||
              new Date(String(old.reserved_at)).getTime() <
                Date.now() - 86400000
            )
              throw new PrivacyError(401, "report_access_required");
            return;
          }
          const g = await grant(tx, v.reportToken);
          if (v.intakeId) {
            const [i] = await rows(
              tx,
              sql`update intakes set case_id=${v.caseId} where id=${v.intakeId} and admission_id=${g.id} and token_hash=${digest(v.intakeToken ?? "")} and revoked_at is null and case_id is null returning id`,
            );
            if (!i) throw new PrivacyError(409, "invalid_intake");
          } else
            await rows(
              tx,
              sql`delete from intakes where admission_id=${g.id} and case_id is null`,
            );
          if (v.aiConsent && !v.intakeId) {
            if (!v.policyVersion)
              throw new PrivacyError(400, "validation_error");
            const id = randomUUID();
            await rows(
              tx,
              sql`insert into intakes(id,token_hash,case_id,locale,consent_version,transcript_enc) values(${id},${digest(token())},${v.caseId},${v.locale},${v.policyVersion},${seal([], config.keys, "intake:" + id)})`,
            );
          }
          await rows(
            tx,
            sql`update admission_grants set employee_id=null,submission_hash=${v.submissionHash},case_id=${v.caseId},reserved_at=now() where id=${g.id}`,
          );
        });
        return { ok: true };
      });
    },
    { prefix: "/internal" },
  );
}
