import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { ZodError } from "zod";
import { mac, safeError } from "@whistle/runtime";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import { HttpError } from "./lib/errors.js";
import { authRoutes } from "./routes/auth.js";
import { googleRoutes } from "./routes/google.js";
import type { GoogleProvider } from "./google-oidc.js";
import { reporterRoutes } from "./routes/reporter.js";
import { caseRoutes } from "./routes/cases.js";
import { adminRoutes } from "./routes/admin.js";
import { internalRoutes } from "./routes/internal.js";
import { jiraRoutes } from "./routes/jira.js";
import type { JiraClient } from "./jira.js";
export interface Limiter {
  hit(key: string, max: number, seconds: number): Promise<boolean>;
}
export interface AppDeps {
  db: Db;
  config: Config;
  limiter: Limiter;
  google?: GoogleProvider;
  jira?: JiraClient;
}
declare module "fastify" {
  interface FastifyInstance {
    deps: AppDeps;
  }
}
export async function buildApp(deps: AppDeps) {
  const app = Fastify({
    bodyLimit: 128 * 1024,
    trustProxy: deps.config.trustProxy,
    logger:
      deps.config.env === "test"
        ? false
        : {
            level: "info",
            serializers: {
              req: () => ({}),
              res: (r) => ({ statusCode: r.statusCode }),
            },
          },
  });
  app.decorate("deps", deps);
  await app.register(cookie);
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    if (
      !req.url.startsWith("/internal/") &&
      !(await deps.limiter.hit(
        mac(deps.config.abuseKey, `http:${req.ip}`),
        300,
        60,
      ))
    )
      throw new HttpError(429, "Too many requests", "rate_limit");
  });
  app.setNotFoundHandler((_req, reply) =>
    reply.status(404).send({ error: "not_found" }),
  );
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError)
      return reply.status(400).send({
        error: "validation_error",
        issues: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    if (err instanceof HttpError)
      return reply.status(err.statusCode).send({ error: err.code });
    app.log.error(safeError(err), "request failed");
    return reply.status(500).send({ error: "internal_error" });
  });
  await app.register(authRoutes, { prefix: "/api/staff" });
  await app.register(googleRoutes, { prefix: "/api/staff/google" });
  await app.register(reporterRoutes, { prefix: "/api/reporter" });
  await app.register(caseRoutes, { prefix: "/api/cases" });
  await app.register(adminRoutes, { prefix: "/api/admin" });
  await app.register(jiraRoutes, { prefix: "/api/admin/jira" });
  await app.register(internalRoutes, { prefix: "/internal" });
  return app;
}
