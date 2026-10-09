import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { MAX_ATTACHMENT_BYTES } from "@whistle/shared";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";
import type { AiClient } from "./ai/minimax.js";
import type { Storage } from "./lib/storage.js";
import { HttpError, logSafeError } from "./lib/errors.js";
import { intakeRoutes } from "./routes/intake.js";
import { reportRoutes } from "./routes/reports.js";
import { statusRoutes } from "./routes/status.js";
import { adminAuthRoutes } from "./routes/admin/auth.js";
import { adminReportRoutes } from "./routes/admin/reports.js";

export interface AppDeps {
  config: Config;
  db: Db;
  ai: AiClient;
  storage: Storage;
}

declare module "fastify" {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: deps.config.trustProxy,
    bodyLimit: 64 * 1024,
    logger:
      deps.config.env === "test"
        ? false
        : {
            level: deps.config.env === "production" ? "info" : "debug",
            // Reporter anonymity: never log IP addresses, headers or bodies.
            serializers: {
              req: (req) => ({ method: req.method, url: req.url.replace(/\?.*$/, "") }),
              res: (res) => ({ statusCode: res.statusCode }),
            },
          },
  });

  app.decorate("deps", deps);

  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1, fields: 0 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({
        error: "validation_error",
        message: err.issues[0]?.message ?? "Invalid input",
        issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: "request_error", message: (err as Error).message });
    }
    req.log.error({ err: logSafeError(err) }, "unhandled error");
    return reply.status(500).send({ error: "internal_error", message: "Something went wrong" });
  });

  app.get("/api/health", async () => ({ ok: true, ai: deps.ai.enabled }));

  await app.register(intakeRoutes, { prefix: "/api/intake" });
  await app.register(reportRoutes, { prefix: "/api/reports" });
  await app.register(statusRoutes, { prefix: "/api/status" });
  await app.register(adminAuthRoutes, { prefix: "/api/admin" });
  await app.register(adminReportRoutes, { prefix: "/api/admin" });

  return app;
}
