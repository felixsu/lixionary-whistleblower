import type { FastifyInstance } from "fastify";
import { jiraIntakeInput, jiraBoardQuery } from "@whistle/shared";
import { mac } from "@whistle/runtime";
import { requireStaff } from "../auth.js";
import { admin } from "../service.js";
import { HttpError } from "../lib/errors.js";
import { createJiraClient } from "../jira.js";

export async function jiraRoutes(app: FastifyInstance) {
  const { config, limiter } = app.deps;
  const client = config.jira
    ? (app.deps.jira ?? createJiraClient(config.jira))
    : undefined;
  app.addHook("preHandler", requireStaff);
  app.addHook("preHandler", async (req) => admin(req.staff!));
  app.get("/", async () =>
    config.jira
      ? {
          enabled: true,
          origin: config.jira.baseUrl,
          projectKey: config.jira.projectKey,
        }
      : { enabled: false },
  );
  async function available<T>(action: () => Promise<T>) {
    if (!client) throw new HttpError(503, "Jira disabled", "jira_disabled");
    try {
      return await action();
    } catch {
      app.log.warn("Jira request unavailable");
      throw new HttpError(503, "Jira unavailable", "jira_unavailable");
    }
  }
  app.post("/intake", async (req, reply) => {
    const { type } = jiraIntakeInput.parse(req.body);
    if (!client) throw new HttpError(503, "Jira disabled", "jira_disabled");
    if (
      !(await limiter.hit(
        mac(config.abuseKey, `jira-launch:${req.staff!.id}`),
        10,
        600,
      ))
    ) {
      reply.header("Retry-After", "600");
      throw new HttpError(429, "Too many launches", "rate_limit");
    }
    return available(() => client.launch(type, req.staff!));
  });
  app.get("/board", async (req) => {
    const query = jiraBoardQuery.parse(req.query);
    return available(() => client!.board(query));
  });
}
