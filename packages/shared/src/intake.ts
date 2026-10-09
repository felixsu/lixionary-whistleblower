import { z } from "zod";
import { reportDraftSchema, type ReportDraft } from "./report.js";

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_INTAKE_TURNS = 30;
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_TYPES: Record<string, string> = {
  "application/pdf": "PDF",
  "image/png": "PNG image",
  "image/jpeg": "JPEG image",
  "image/webp": "WebP image",
  "text/plain": "Text file",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel spreadsheet",
};

export const chatRoleSchema = z.enum(["user", "assistant"]);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

/** What the AI returns when asked to structure the conversation so far. */
export const draftAssessmentSchema = z.object({
  draft: reportDraftSchema,
  completeness: z.number().int().min(0).max(100),
  missing: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
});
export type DraftAssessment = z.infer<typeof draftAssessmentSchema>;

export interface CreateIntakeResponse {
  id: string;
  token: string;
  aiEnabled: boolean;
  greeting: string;
}

export interface IntakeStateResponse {
  messages: ChatMessage[];
  draft: ReportDraft;
  completeness: number;
  missing: string[];
  turnCount: number;
  aiEnabled: boolean;
}

export interface AttachmentInfo {
  id: string;
  originalName: string;
  mime: string;
  size: number;
}

/** Server-sent events emitted while the assistant streams a reply. */
export type IntakeStreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; turnCount: number; suggestFinish: boolean }
  | { type: "error"; message: string };
