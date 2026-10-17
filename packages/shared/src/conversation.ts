import { z } from "zod";
import type { ChatMessage } from "./intake.js";
export const followupKeys = [
  "what",
  "who",
  "when",
  "where",
  "why",
  "how",
  "howKnown",
  "evidence",
  "impact",
  "ongoing",
] as const;
export const followupUpdateSchema = z.object({
  summary: z.string().trim().min(1).max(10000),
  details: z.object(
    Object.fromEntries(
      followupKeys.map((k) => [k, z.string().trim().max(5000).default("")]),
    ) as Record<(typeof followupKeys)[number], z.ZodDefault<z.ZodString>>,
  ),
});
export type FollowupUpdate = z.infer<typeof followupUpdateSchema>;
export interface ConversationView {
  consented: boolean;
  policyVersion: number;
  needsConsent: boolean;
  aiEnabled: boolean;
  initialized: boolean;
  messages: ChatMessage[];
  draft: (FollowupUpdate & { clientMessageId: string }) | null;
  pending: {
    id: string;
    kind: "start" | "messages" | "draft";
    status: "running" | "failed";
    retryable: boolean;
  } | null;
  usage: { messages: number; drafts: number; resetsAt: string };
}
