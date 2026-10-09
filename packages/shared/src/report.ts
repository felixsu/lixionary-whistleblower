import { z } from "zod";
import type { ReportStatus } from "./status.js";

export const REPORT_CATEGORIES = [
  "fraud",
  "corruption_bribery",
  "financial_misconduct",
  "theft",
  "conflict_of_interest",
  "harassment_discrimination",
  "safety_health",
  "data_privacy",
  "policy_violation",
  "other",
] as const;

export const reportCategorySchema = z.enum(REPORT_CATEGORIES);
export type ReportCategory = z.infer<typeof reportCategorySchema>;

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  fraud: "Fraud",
  corruption_bribery: "Corruption or bribery",
  financial_misconduct: "Financial misconduct",
  theft: "Theft or misuse of assets",
  conflict_of_interest: "Conflict of interest",
  harassment_discrimination: "Harassment or discrimination",
  safety_health: "Health and safety",
  data_privacy: "Data privacy or security",
  policy_violation: "Policy violation",
  other: "Other",
};

export const ONGOING_VALUES = ["yes", "no", "unknown"] as const;

const text = (max: number) => z.string().trim().max(max);

/** The investigative fields the AI interview tries to fill in. */
export const reportDetailsSchema = z.object({
  what: text(5000).default(""),
  who: text(2000).default(""),
  when: text(1000).default(""),
  where: text(1000).default(""),
  howKnown: text(2000).default(""),
  evidence: text(2000).default(""),
  impact: text(2000).default(""),
  ongoing: z.enum(ONGOING_VALUES).default("unknown"),
});
export type ReportDetails = z.infer<typeof reportDetailsSchema>;

export const DETAIL_LABELS: Record<keyof ReportDetails, string> = {
  what: "What happened",
  who: "Who was involved",
  when: "When it happened",
  where: "Where it happened",
  howKnown: "How you know",
  evidence: "Evidence available",
  impact: "Impact or harm",
  ongoing: "Still ongoing?",
};

/** A work-in-progress report; every field may still be empty. */
export const reportDraftSchema = z.object({
  category: reportCategorySchema.nullable().default(null),
  title: text(200).default(""),
  summary: text(5000).default(""),
  details: reportDetailsSchema.default(reportDetailsSchema.parse({})),
});
export type ReportDraft = z.infer<typeof reportDraftSchema>;

export const emptyDraft = (): ReportDraft => reportDraftSchema.parse({});

/** The draft as accepted on submission: category, title and summary are required. */
export const finalReportSchema = reportDraftSchema.extend({
  category: reportCategorySchema,
  title: text(200).min(5, "Please give the report a short title"),
  summary: text(5000).min(20, "Please describe what happened in a bit more detail"),
});

export const CONTACT_PREFERENCES = ["email", "phone", "either"] as const;

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()\-.]{6,25}$/, "Enter a valid phone number");

export const contactSchema = z
  .object({
    email: z.union([z.email("Enter a valid email address").max(254), z.literal("")]).default(""),
    phone: z.union([phoneSchema, z.literal("")]).default(""),
    preference: z.enum(CONTACT_PREFERENCES).default("either"),
  })
  .refine((c) => c.email !== "" || c.phone !== "", {
    message: "Provide an email address or a phone number so we can follow up",
    path: ["email"],
  });
export type Contact = z.infer<typeof contactSchema>;

export const submitReportSchema = z.object({
  intakeSessionId: z.uuid(),
  intakeToken: z.string().min(20).max(200),
  report: finalReportSchema,
  contact: contactSchema,
  attachmentIds: z.array(z.uuid()).max(5).default([]),
  consent: z.literal(true, { error: "You must confirm before submitting" }),
});
export type SubmitReportInput = z.infer<typeof submitReportSchema>;

export interface SubmitReportResponse {
  caseCode: string;
  pin: string;
}

/** Case codes look like WB-7K3M-9QXP (Crockford base32, no I/L/O/U). */
export const CASE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CASE_CODE_PATTERN = /^WB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Normalises user input like "wb 7k3m 9qxp" to "WB-7K3M-9QXP". */
export function normalizeCaseCode(input: string): string {
  const raw = input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  const body = raw.startsWith("WB") ? raw.slice(2) : raw;
  return `WB-${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

export const statusLookupSchema = z.object({
  caseCode: z.string().trim().min(8).max(20).transform(normalizeCaseCode),
  pin: z.string().trim().min(6).max(40),
});
export type StatusLookupInput = z.infer<typeof statusLookupSchema>;

export const messageBodySchema = z.string().trim().min(1).max(4000);

export const reporterReplySchema = statusLookupSchema.extend({ body: messageBodySchema });

export interface ThreadMessage {
  id: string;
  author: "admin" | "reporter";
  body: string;
  createdAt: string;
}

export interface StatusResponse {
  caseCode: string;
  status: ReportStatus;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ThreadMessage[];
}
