import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { PrivacyError, csrf } from "./service.js";
import { grant, accessToken } from "./admission.js";
/** Legacy clients must submit a form before using the case-linked assistant. */
export async function intakeRoutes(app: FastifyInstance) {
  app.addHook("preHandler", async (req) => csrf(req));
  for (const path of ["/", "/:id/messages", "/:id/draft"])
    app.post(path, async (req) => {
      if (path === "/")
        z.object({
          consent: z.literal(true),
          policyVersion: z.number().int().positive(),
          locale: z.enum(["en", "id"]),
        }).parse(req.body);
      await app.privacyDeps.db.transaction(async (tx) => {
        await grant(tx, accessToken(req));
      });
      throw new PrivacyError(410, "form_first_required");
    });
}
