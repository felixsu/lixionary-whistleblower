import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { loginSchema, type AdminMe } from "@whistle/shared";
import { adminSessions, admins } from "../../db/schema.js";
import { dummySecretHash, verifySecret } from "../../crypto/password.js";
import { hashToken } from "../../crypto/tokens.js";
import { HttpError } from "../../lib/errors.js";
import {
  SESSION_COOKIE,
  createSession,
  requireAdmin,
  requireCsrfHeader,
  setSessionCookie,
} from "../../auth/session.js";

export const adminAuthRoutes: FastifyPluginAsync = async (app) => {
  const { db, config } = app.deps;

  app.post(
    "/login",
    { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } },
    async (req, reply): Promise<AdminMe> => {
      requireCsrfHeader(req);
      const { email, password } = loginSchema.parse(req.body);
      const [admin] = await db.select().from(admins).where(eq(admins.email, email.toLowerCase())).limit(1);
      const ok = await verifySecret(admin?.passwordHash ?? (await dummySecretHash()), password);
      if (!admin || !ok) throw new HttpError(401, "Incorrect email or password.", "invalid_credentials");

      const { token, expiresAt } = await createSession(db, admin.id);
      await db.update(admins).set({ lastLoginAt: new Date() }).where(eq(admins.id, admin.id));
      setSessionCookie(reply, token, expiresAt, config.cookieSecure);
      return { id: admin.id, email: admin.email, name: admin.name };
    },
  );

  app.post("/logout", async (req, reply) => {
    requireCsrfHeader(req);
    const token = req.cookies[SESSION_COOKIE];
    if (token) await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashToken(token)));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: requireAdmin }, async (req): Promise<AdminMe> => req.admin!);
};
