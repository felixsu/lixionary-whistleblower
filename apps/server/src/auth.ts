import { sql } from "drizzle-orm";
import type { FastifyReply, FastifyRequest } from "fastify";
import { digest, token } from "@whistle/runtime";
import type { StaffIdentity } from "@whistle/shared";
import { rows } from "./db/client.js";
import { HttpError } from "./lib/errors.js";
import type { CaseRow } from "./service.js";
export const STAFF_COOKIE = "wb_staff",
  REPORTER_COOKIE = "wb_reporter";
declare module "fastify" {
  interface FastifyRequest {
    staff?: StaffIdentity;
    staffSessionId?: string;
    reporter?: CaseRow;
    reporterSessionId?: string;
  }
}
export function csrf(req: FastifyRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  if (
    req.headers["x-csrf"] !== "1" ||
    !req.headers.origin ||
    req.headers.origin !== new URL(req.server.deps.config.webUrl).origin
  )
    throw new HttpError(403, "Invalid request origin", "csrf");
}
export function sessionCookie(
  req: FastifyRequest,
  reply: FastifyReply,
  name: string,
  value: string,
  expires: Date,
) {
  reply.setCookie(name, value, {
    httpOnly: true,
    sameSite: "strict",
    secure: req.server.deps.config.production,
    path: "/",
    expires,
  });
}
export async function staffSession(req: FastifyRequest, mfa = true) {
  csrf(req);
  const cookie = req.cookies[STAFF_COOKIE];
  if (!cookie) throw new HttpError(401, "Sign in required", "unauthorized");
  const [s] = await rows(
    req.server.deps.db,
    sql`select ss.id session_id,ss.mfa,s.id,s.email,s.name,s.role,s.mfa_enc from staff_sessions ss join staff s on s.id=ss.staff_id where ss.token_hash=${digest(cookie)} and s.active and ss.expires_at>now() and ss.last_seen_at>now()-interval '15 minutes'`,
  );
  if (!s) throw new HttpError(401, "Session expired", "unauthorized");
  req.staff = {
    id: String(s.id),
    email: String(s.email),
    name: String(s.name),
    role: s.role as StaffIdentity["role"],
    mfaEnrolled: !!s.mfa_enc,
  };
  req.staffSessionId = String(s.session_id);
  if (mfa && !s.mfa) throw new HttpError(403, "MFA required", "mfa_required");
  await rows(
    req.server.deps.db,
    sql`update staff_sessions set last_seen_at=now() where id=${req.staffSessionId}`,
  );
}
export async function requireStaff(req: FastifyRequest) {
  await staffSession(req);
}
export async function requireReporter(req: FastifyRequest) {
  csrf(req);
  const cookie = req.cookies[REPORTER_COOKIE];
  if (!cookie)
    throw new HttpError(401, "Case authentication required", "unauthorized");
  const [s] = await rows<CaseRow & { session_id: string }>(
    req.server.deps.db,
    sql`select c.*,rs.id session_id from reporter_sessions rs join cases c on c.id=rs.case_id where rs.token_hash=${digest(cookie)} and rs.secret_version=c.secret_version and rs.expires_at>now() and rs.last_seen_at>now()-interval '30 minutes'`,
  );
  if (!s) throw new HttpError(401, "Case session expired", "unauthorized");
  req.reporter = s;
  req.reporterSessionId = s.session_id;
  await rows(
    req.server.deps.db,
    sql`update reporter_sessions set last_seen_at=now() where id=${s.session_id}`,
  );
}
export async function createReporterSession(
  req: FastifyRequest,
  reply: FastifyReply,
  row: CaseRow,
) {
  const raw = token();
  const expires = new Date(Date.now() + 8 * 3600000);
  const [s] = await rows(
    req.server.deps.db,
    sql`insert into reporter_sessions(case_id,token_hash,secret_version,expires_at) values(${row.id},${digest(raw)},${row.secret_version},${expires}) returning id`,
  );
  sessionCookie(req, reply, REPORTER_COOKIE, raw, expires);
  return String(s!.id);
}
