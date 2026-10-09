import type { FastifyReply, FastifyRequest } from "fastify";
import { and, eq, gt } from "drizzle-orm";
import type { AdminMe } from "@whistle/shared";
import type { Db } from "../db/client.js";
import { adminSessions, admins } from "../db/schema.js";
import { hashToken, newToken } from "../crypto/tokens.js";
import { HttpError, unauthorized } from "../lib/errors.js";

export const SESSION_COOKIE = "wb_admin";
export const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const CSRF_HEADER = "x-csrf";

declare module "fastify" {
  interface FastifyRequest {
    admin?: AdminMe;
  }
}

export async function createSession(db: Db, adminId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(adminSessions).values({ tokenHash: hashToken(token), adminId, expiresAt });
  return { token, expiresAt };
}

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date, secure: boolean) {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    expires: expiresAt,
  });
}

export async function findSessionAdmin(db: Db, token: string): Promise<AdminMe | undefined> {
  const [row] = await db
    .select({ id: admins.id, email: admins.email, name: admins.name })
    .from(adminSessions)
    .innerJoin(admins, eq(admins.id, adminSessions.adminId))
    .where(and(eq(adminSessions.tokenHash, hashToken(token)), gt(adminSessions.expiresAt, new Date())))
    .limit(1);
  return row;
}

/** Mutating admin requests must carry a custom header, which cross-site forms cannot set. */
export function requireCsrfHeader(req: FastifyRequest): void {
  if (req.method !== "GET" && req.method !== "HEAD" && req.headers[CSRF_HEADER] !== "1") {
    throw new HttpError(403, "Missing CSRF header", "csrf");
  }
}

export async function requireAdmin(req: FastifyRequest): Promise<void> {
  requireCsrfHeader(req);
  const token = req.cookies[SESSION_COOKIE];
  if (!token) throw unauthorized();
  const admin = await findSessionAdmin(req.server.deps.db, token);
  if (!admin) throw unauthorized("Your session has expired. Please sign in again.");
  req.admin = admin;
}
