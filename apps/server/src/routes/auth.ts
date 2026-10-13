import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { generateSecret, generateURI, verify } from "otplib";
import {
  checkSecret,
  hashSecret,
  token,
  digest,
  seal,
  unseal,
} from "@whistle/runtime";
import { rows } from "../db/client.js";
import { audit } from "../service.js";
import {
  csrf,
  STAFF_COOKIE,
  sessionCookie,
  staffSession,
  requireStaff,
} from "../auth.js";
import { HttpError } from "../lib/errors.js";
import {
  limitPasswordReset,
  queuePasswordReset,
} from "../staff-password-reset.js";
const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});
const password = z.string().min(15).max(200);
export const authRoutes: FastifyPluginAsync = async (app) => {
  const { db, config, limiter } = app.deps;
  async function limit(key: string) {
    if (!(await limiter.hit("auth:" + digest(key), 10, 900)))
      throw new HttpError(429, "Too many attempts", "rate_limit");
  }
  app.post("/login", async (req, reply) => {
    csrf(req);
    const v = credentials.parse(req.body);
    await limit(v.email.toLowerCase());
    const [s] = await rows(
      db,
      sql`select * from staff where email=${v.email.toLowerCase()} and active`,
    );
    if (
      !(await checkSecret(s?.password_hash as string | undefined, v.password))
    ) {
      await audit(db, "anonymous", "staff_login_failed");
      throw new HttpError(401, "Invalid credentials", "invalid_credentials");
    }
    const raw = token();
    const expires = new Date(Date.now() + 5 * 60000);
    await rows(
      db,
      sql`insert into staff_sessions(token_hash,staff_id,expires_at) values(${digest(raw)},${s!.id as string},${expires})`,
    );
    sessionCookie(req, reply, STAFF_COOKIE, raw, expires);
    await audit(db, String(s!.id), "staff_password_authenticated");
    return { mfaEnrolled: !!s!.mfa_enc };
  });
  app.get("/me", async (req) => {
    await staffSession(req, false);
    const [s] = await rows(
      db,
      sql`select mfa from staff_sessions where id=${req.staffSessionId!}`,
    );
    return { ...req.staff, mfaVerified: !!s?.mfa };
  });
  app.post("/mfa/enroll", async (req) => {
    await staffSession(req, false);
    const [s] = await rows(
      db,
      sql`select mfa_enc from staff where id=${req.staff!.id}`,
    );
    if (s!.mfa_enc)
      throw new HttpError(409, "Already enrolled", "already_enrolled");
    const secret = generateSecret();
    await rows(
      db,
      sql`update staff set mfa_pending_enc=${seal(secret, config.keys, "mfa:" + req.staff!.id)} where id=${req.staff!.id}`,
    );
    return {
      secret,
      uri: generateURI({ issuer: "Speak Up", label: req.staff!.email, secret }),
    };
  });
  app.post("/mfa/confirm", async (req, reply) => {
    await staffSession(req, false);
    const { code } = z
      .object({ code: z.string().min(6).max(200) })
      .parse(req.body);
    await limit("mfa:" + req.staff!.id);
    return db.transaction(async (tx) => {
      const [s] = await rows(
        tx,
        sql`select * from staff where id=${req.staff!.id} for update`,
      );
      let recovery = false;
      let secret: string | undefined;
      if (s!.mfa_enc || s!.mfa_pending_enc)
        secret = unseal<string>(
          String(s!.mfa_enc ?? s!.mfa_pending_enc),
          config.keys,
          "mfa:" + req.staff!.id,
        );
      const step = Math.floor(Date.now() / 30000);
      const ok =
        secret &&
        /^\d{6}$/.test(code) &&
        (await verify({ secret, token: code, epochTolerance: 0 })).valid &&
        Number(s!.mfa_last_step ?? -1) < step;
      if (!ok && s!.mfa_enc) {
        const candidates = await rows(
          tx,
          sql`select * from staff_recovery where staff_id=${req.staff!.id} and used_at is null for update`,
        );
        for (const r of candidates) {
          if (await checkSecret(String(r.secret_hash), code)) {
            await rows(
              tx,
              sql`update staff_recovery set used_at=now() where id=${r.id as string}`,
            );
            recovery = true;
            break;
          }
        }
      }
      if (!ok && !recovery)
        throw new HttpError(401, "Invalid code", "invalid_code");
      let recoveryCodes: string[] = [];
      if (!s!.mfa_enc) {
        recoveryCodes = Array.from({ length: 8 }, token);
        await rows(
          tx,
          sql`update staff set mfa_enc=mfa_pending_enc,mfa_pending_enc=null where id=${req.staff!.id}`,
        );
        for (const c of recoveryCodes)
          await rows(
            tx,
            sql`insert into staff_recovery(staff_id,secret_hash) values(${req.staff!.id},${await hashSecret(c)})`,
          );
      }
      if (ok)
        await rows(
          tx,
          sql`update staff set mfa_last_step=${step} where id=${req.staff!.id}`,
        );
      const raw = token();
      const expires = new Date(Date.now() + 8 * 3600000);
      await rows(
        tx,
        sql`delete from staff_sessions where staff_id=${req.staff!.id}`,
      );
      await rows(
        tx,
        sql`insert into staff_sessions(token_hash,staff_id,mfa,expires_at) values(${digest(raw)},${req.staff!.id},true,${expires})`,
      );
      await audit(
        tx,
        req.staff!.id,
        recovery ? "staff_mfa_recovery" : "staff_mfa_authenticated",
      );
      sessionCookie(req, reply, STAFF_COOKIE, raw, expires);
      return { recoveryCodes };
    });
  });
  app.post("/logout", async (req, reply) => {
    csrf(req);
    if (req.cookies[STAFF_COOKIE])
      await rows(
        db,
        sql`delete from staff_sessions where token_hash=${digest(req.cookies[STAFF_COOKIE]!)}`,
      );
    reply.clearCookie(STAFF_COOKIE, { path: "/" });
    return { ok: true };
  });
  app.post("/password/request", async (req) => {
    csrf(req);
    const { email } = z.object({ email: z.email() }).parse(req.body);
    await limitPasswordReset(limiter, email);
    const [s] = await rows(
      db,
      sql`select id from staff where email=${email.toLowerCase()} and active`,
    );
    if (s)
      await db.transaction((tx) =>
        queuePasswordReset(tx, config, String(s.id)),
      );
    return { ok: true };
  });
  app.post("/password/accept", async (req) => {
    csrf(req);
    const v = z
      .object({ token: z.string().min(20).max(200), password })
      .parse(req.body);
    await limit("token:" + digest(v.token));
    await db.transaction(async (tx) => {
      const [r] = await rows(
        tx,
        sql`select * from staff_tokens where token_hash=${digest(v.token)} and used_at is null and expires_at>now() for update`,
      );
      if (!r)
        throw new HttpError(401, "Invalid credentials", "invalid_credentials");
      const [staff] = await rows(
        tx,
        sql`select active from staff where id=${r.staff_id as string} for update`,
      );
      if (!staff || (r.purpose === "password_reset" && !staff.active))
        throw new HttpError(401, "Invalid credentials", "invalid_credentials");
      await rows(
        tx,
        sql`update staff set password_hash=${await hashSecret(v.password)},active=true where id=${r.staff_id as string}`,
      );
      await rows(
        tx,
        sql`update staff_tokens set used_at=now() where staff_id=${r.staff_id as string} and used_at is null`,
      );
      await rows(
        tx,
        sql`delete from staff_sessions where staff_id=${r.staff_id as string}`,
      );
      await audit(
        tx,
        String(r.staff_id),
        r.purpose === "invitation" ? "invitation_accepted" : "password_reset",
      );
    });
    return { ok: true };
  });
  app.get("/sessions", { preHandler: requireStaff }, (req) =>
    rows(
      db,
      sql`select id,created_at,last_seen_at,expires_at from staff_sessions where staff_id=${req.staff!.id}`,
    ),
  );
  app.delete("/sessions/:id", { preHandler: requireStaff }, async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await rows(
      db,
      sql`delete from staff_sessions where id=${id} and staff_id=${req.staff!.id}`,
    );
    await audit(db, req.staff!.id, "staff_session_revoked");
    return { ok: true };
  });
};
