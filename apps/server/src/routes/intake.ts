import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  MAX_ATTACHMENTS,
  MAX_INTAKE_TURNS,
  emptyDraft,
  sendMessageSchema,
  type AttachmentInfo,
  type ChatMessage,
  type CreateIntakeResponse,
  type DraftAssessment,
  type IntakeStateResponse,
  type IntakeStreamEvent,
} from "@whistle/shared";
import { attachments, intakeMessages, intakeSessions } from "../db/schema.js";
import type { Db } from "../db/client.js";
import { hashToken, newToken, tokenMatches } from "../crypto/tokens.js";
import { AiError, type LlmMessage } from "../ai/minimax.js";
import { GREETING, INTERVIEWER_PROMPT, READY_MARKER } from "../ai/prompts.js";
import { assessConversation } from "../ai/extract.js";
import { MarkerStripper } from "../lib/markers.js";
import { processUpload } from "../lib/attachments.js";
import { HttpError, badRequest, conflict, logSafeError, notFound, unavailable } from "../lib/errors.js";

export const INTAKE_TOKEN_HEADER = "x-intake-token";
const INTAKE_TTL_MS = 24 * 60 * 60 * 1000;

const idParams = z.object({ id: z.uuid() });

/** Resolves an intake session from :id plus the bearer token; rejects expired or submitted sessions. */
export async function loadIntakeSession(db: Db, id: string, token: string | undefined) {
  const [session] = await db.select().from(intakeSessions).where(eq(intakeSessions.id, id)).limit(1);
  if (!session || !token || !tokenMatches(token, session.tokenHash)) throw notFound("Session not found");
  if (session.submittedAt) throw conflict("This report has already been submitted", "already_submitted");
  if (session.expiresAt < new Date()) throw new HttpError(410, "This session has expired. Please start again.", "expired");
  return session;
}

function sessionFromRequest(req: FastifyRequest) {
  const { id } = idParams.parse(req.params);
  const token = req.headers[INTAKE_TOKEN_HEADER];
  return loadIntakeSession(req.server.deps.db, id, typeof token === "string" ? token : undefined);
}

async function loadMessages(db: Db, sessionId: string): Promise<ChatMessage[]> {
  return db
    .select({ role: intakeMessages.role, content: intakeMessages.content })
    .from(intakeMessages)
    .where(eq(intakeMessages.sessionId, sessionId))
    .orderBy(asc(intakeMessages.createdAt));
}

async function listAttachments(db: Db, sessionId: string): Promise<AttachmentInfo[]> {
  return db
    .select({ id: attachments.id, originalName: attachments.originalName, mime: attachments.mime, size: attachments.size })
    .from(attachments)
    .where(and(eq(attachments.intakeSessionId, sessionId), isNull(attachments.reportId)))
    .orderBy(asc(attachments.createdAt));
}

export const intakeRoutes: FastifyPluginAsync = async (app) => {
  const { db, ai, storage } = app.deps;

  app.post(
    "/sessions",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (): Promise<CreateIntakeResponse> => {
      const token = newToken();
      const [session] = await db
        .insert(intakeSessions)
        .values({ tokenHash: hashToken(token), draft: emptyDraft(), expiresAt: new Date(Date.now() + INTAKE_TTL_MS) })
        .returning({ id: intakeSessions.id });
      await db.insert(intakeMessages).values({ sessionId: session!.id, role: "assistant", content: GREETING });
      return { id: session!.id, token, aiEnabled: ai.enabled, greeting: GREETING };
    },
  );

  app.get("/sessions/:id", async (req): Promise<IntakeStateResponse & { attachments: AttachmentInfo[] }> => {
    const session = await sessionFromRequest(req);
    return {
      messages: await loadMessages(db, session.id),
      draft: session.draft,
      completeness: session.completeness,
      missing: session.missing,
      turnCount: session.turnCount,
      aiEnabled: ai.enabled,
      attachments: await listAttachments(db, session.id),
    };
  });

  /** Streams the assistant's next reply as server-sent events. */
  app.post(
    "/sessions/:id/messages",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const session = await sessionFromRequest(req);
      const { content } = sendMessageSchema.parse(req.body);
      if (!ai.enabled) throw unavailable("The AI assistant is not available. Please use the form instead.", "ai_disabled");
      if (session.turnCount >= MAX_INTAKE_TURNS) {
        throw conflict("You've reached the message limit. Please continue to the review step.", "turn_limit");
      }

      const [userMsg] = await db
        .insert(intakeMessages)
        .values({ sessionId: session.id, role: "user", content })
        .returning({ id: intakeMessages.id });
      const history = await loadMessages(db, session.id);
      const prompt: LlmMessage[] = [{ role: "system", content: INTERVIEWER_PROMPT }, ...history];

      const abort = new AbortController();
      // The response's "close" fires if the reporter navigates away mid-stream.
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) abort.abort();
      });

      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      reply.raw.flushHeaders();
      const send = (event: IntakeStreamEvent) => {
        if (!reply.raw.writableEnded) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const marker = new MarkerStripper(READY_MARKER);
      let full = "";
      try {
        for await (const delta of ai.stream(prompt, { signal: abort.signal, temperature: 0.7 })) {
          const visible = marker.push(delta);
          if (visible) {
            full += visible;
            send({ type: "delta", text: visible });
          }
        }
        const tail = marker.flush();
        if (tail) {
          full += tail;
          send({ type: "delta", text: tail });
        }
        full = full.trim();
        if (!full) throw new AiError("The assistant returned an empty reply", true);

        const turnCount = session.turnCount + 1;
        await db.insert(intakeMessages).values({ sessionId: session.id, role: "assistant", content: full });
        await db.update(intakeSessions).set({ turnCount }).where(eq(intakeSessions.id, session.id));
        send({ type: "done", turnCount, suggestFinish: marker.found || turnCount >= MAX_INTAKE_TURNS });
      } catch (err) {
        // Drop the unanswered user message so a retry doesn't duplicate it.
        await db.delete(intakeMessages).where(eq(intakeMessages.id, userMsg!.id));
        if (!abort.signal.aborted) {
          req.log.warn({ err: logSafeError(err) }, "intake stream failed");
          send({ type: "error", message: "The assistant is having trouble right now. Please try again, or continue with the form." });
        }
      } finally {
        reply.raw.end();
      }
    },
  );

  /** Asks the AI to turn the conversation into a structured draft and completeness assessment. */
  app.post(
    "/sessions/:id/draft",
    { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
    async (req): Promise<DraftAssessment> => {
      const session = await sessionFromRequest(req);
      if (!ai.enabled) throw unavailable("The AI assistant is not available.", "ai_disabled");
      const messages = await loadMessages(db, session.id);
      if (!messages.some((m) => m.role === "user")) throw badRequest("Tell the assistant what happened first.");
      try {
        const assessment = await assessConversation(ai, messages);
        await db
          .update(intakeSessions)
          .set({ draft: assessment.draft, completeness: assessment.completeness, missing: assessment.missing })
          .where(eq(intakeSessions.id, session.id));
        return assessment;
      } catch (err) {
        if (err instanceof AiError) {
          req.log.warn({ err: logSafeError(err) }, "draft extraction failed");
          throw unavailable("We couldn't prepare the draft automatically. You can fill in the form yourself.", "ai_failed");
        }
        throw err;
      }
    },
  );

  app.post(
    "/sessions/:id/attachments",
    { config: { rateLimit: { max: 20, timeWindow: "10 minutes" } } },
    async (req): Promise<AttachmentInfo> => {
      const session = await sessionFromRequest(req);
      const [{ value: existing } = { value: 0 }] = await db
        .select({ value: count() })
        .from(attachments)
        .where(eq(attachments.intakeSessionId, session.id));
      if (existing >= MAX_ATTACHMENTS) throw badRequest(`You can attach up to ${MAX_ATTACHMENTS} files.`, "too_many_files");

      const file = await req.file();
      if (!file) throw badRequest("No file uploaded");
      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        throw new HttpError(413, "That file is too large (10 MB maximum).", "file_too_large");
      }
      const processed = await processUpload(buffer, file.filename);
      const storageKey = await storage.save(processed.data);
      const [row] = await db
        .insert(attachments)
        .values({
          intakeSessionId: session.id,
          originalName: processed.originalName,
          mime: processed.mime,
          size: processed.data.length,
          sha256: processed.sha256,
          storageKey,
        })
        .returning({ id: attachments.id, originalName: attachments.originalName, mime: attachments.mime, size: attachments.size });
      return row!;
    },
  );

  app.delete("/sessions/:id/attachments/:attachmentId", async (req, reply) => {
    const session = await sessionFromRequest(req);
    const { attachmentId } = z.object({ attachmentId: z.uuid() }).parse(req.params);
    const [row] = await db
      .delete(attachments)
      .where(and(eq(attachments.id, attachmentId), eq(attachments.intakeSessionId, session.id), isNull(attachments.reportId)))
      .returning({ storageKey: attachments.storageKey });
    if (!row) throw notFound("Attachment not found");
    await storage.remove(row.storageKey);
    return reply.status(204).send();
  });
};
