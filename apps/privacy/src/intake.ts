import type { FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createMinimaxClient,
  digest,
  token,
  seal,
  unseal,
  INTERVIEWER_PROMPT,
  GREETING,
  READY_MARKER,
  assessConversation,
} from "@whistle/runtime";
import type { ChatMessage, CompanySettings } from "@whistle/shared";
import { rows } from "./db/client.js";
import { PrivacyError, csrf, caseCall } from "./service.js";
import { grant, accessToken } from "./admission.js";
export async function intakeRoutes(app: FastifyInstance) {
  const { db, config } = app.privacyDeps,
    ai = createMinimaxClient(config.ai);
  app.addHook("preHandler", async (req) => csrf(req));
  app.post("/", async (req) => {
    const v = z
      .object({
        consent: z.literal(true),
        policyVersion: z.number().int().positive(),
        locale: z.enum(["en", "id"]),
      })
      .parse(req.body);
    return db.transaction(async (tx) => {
      const g = await grant(tx, accessToken(req));
      const s = (await (
        await caseCall(config, "configuration", {})
      ).json()) as {
        settings: CompanySettings;
        policyVersion: number;
        configured: boolean;
      };
      if (config.production && !s.configured)
        throw new PrivacyError(503, "setup_required");
      if (!s.settings.aiEnabled || !ai.enabled)
        throw new PrivacyError(409, "ai_disabled");
      if (s.policyVersion !== v.policyVersion)
        throw new PrivacyError(409, "policy_changed");
      if (g.intake_started)
        throw new PrivacyError(409, "intake_already_started");
      const id = randomUUID(),
        raw = token();
      await rows(
        tx,
        sql`insert into intakes(id,token_hash,locale,consent_version,transcript_enc,admission_id) values(${id},${digest(raw)},${v.locale},${v.policyVersion},${seal([{ role: "assistant", content: v.locale === "id" ? "Ceritakan apa yang terjadi. Jangan sertakan identitas atau kontak Anda." : GREETING }], config.keys, "intake:" + id)},${g.id})`,
      );
      await rows(
        tx,
        sql`update admission_grants set intake_started=true where id=${g.id}`,
      );
      return { id, token: raw };
    });
  });
  for (const kind of ["messages", "draft"] as const)
    app.post(`/:id/${kind}`, async (req) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const input =
        kind === "messages"
          ? z
              .object({ body: z.string().trim().min(1).max(5000) })
              .parse(req.body)
          : null;
      const result = await db.transaction(async (tx) => {
        const g = await grant(tx, accessToken(req));
        const [s] = await rows(
          tx,
          sql`select * from intakes where id=${id} and admission_id=${g.id} and token_hash=${digest(String(req.headers.authorization ?? "").replace(/^Bearer /, ""))} and revoked_at is null and case_id is null for update`,
        );
        if (!s) throw new PrivacyError(401, "unauthorized");
        const current = (await (
          await caseCall(config, "configuration", {})
        ).json()) as { settings: CompanySettings; policyVersion: number };
        if (!current.settings.aiEnabled || !ai.enabled)
          throw new PrivacyError(409, "ai_disabled");
        if (current.policyVersion !== Number(s.consent_version))
          throw new PrivacyError(409, "policy_changed");
        if (
          Number(g[kind === "messages" ? "messages" : "drafts"]) >=
          (kind === "messages" ? 30 : 3)
        )
          throw new PrivacyError(429, "conversation_limit");
        await rows(
          tx,
          kind === "messages"
            ? sql`update admission_grants set messages=messages+1 where id=${g.id}`
            : sql`update admission_grants set drafts=drafts+1 where id=${g.id}`,
        );
        // Commit charged attempts even when an upstream AI request fails.
        try {
          const messages = unseal<ChatMessage[]>(
            String(s.transcript_enc),
            config.keys,
            "intake:" + id,
          );
          if (kind === "draft")
            return { value: await assessConversation(ai, messages) };
          messages.push({ role: "user", content: input!.body });
          const answer = (
            await ai.complete(
              [{ role: "system", content: INTERVIEWER_PROMPT }, ...messages],
              { maxTokens: 800 },
            )
          )
            .replaceAll(READY_MARKER, "")
            .trim();
          messages.push({ role: "assistant", content: answer });
          await rows(
            tx,
            sql`update intakes set transcript_enc=${seal(messages, config.keys, "intake:" + id)} where id=${id}`,
          );
          return { value: { answer } };
        } catch (error) {
          return { error };
        }
      });
      if ("error" in result) throw result.error;
      return result.value;
    });
  app.delete("/:id", async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    await db.transaction(async (tx) => {
      const g = await grant(tx, accessToken(req));
      const [s] = await rows(
        tx,
        sql`update intakes set revoked_at=now(),transcript_enc=${seal([], config.keys, "intake:" + id)} where id=${id} and admission_id=${g.id} and token_hash=${digest(String(req.headers.authorization ?? "").replace(/^Bearer /, ""))} and case_id is null returning id`,
      );
      if (!s) throw new PrivacyError(401, "unauthorized");
    });
    return { ok: true };
  });
}
