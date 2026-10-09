import { z } from "zod";
import { reportCategorySchema, messageBodySchema, type ReportCategory, type ReportDetails, type ThreadMessage } from "./report.js";
import { reportStatusSchema, type ReportStatus } from "./status.js";
import type { AttachmentInfo, ChatMessage } from "./intake.js";

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export interface AdminMe {
  id: string;
  email: string;
  name: string;
}

export const reportListQuerySchema = z.object({
  status: reportStatusSchema.optional(),
  category: reportCategorySchema.optional(),
  q: z.string().trim().max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ReportListQuery = z.infer<typeof reportListQuerySchema>;

export interface AdminReportListItem {
  id: string;
  caseCode: string;
  title: string;
  category: ReportCategory;
  status: ReportStatus;
  completeness: number;
  attachmentCount: number;
  unreadReporterMessages: number;
  createdAt: string;
  updatedAt: string;
}

export interface AdminReportList {
  items: AdminReportListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminNote {
  id: string;
  adminName: string;
  body: string;
  createdAt: string;
}

export interface AdminThreadMessage extends ThreadMessage {
  adminName: string | null;
}

export interface AuditEntry {
  id: string;
  adminName: string | null;
  action: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface AdminReportDetail {
  id: string;
  caseCode: string;
  title: string;
  summary: string;
  category: ReportCategory;
  status: ReportStatus;
  details: ReportDetails;
  completeness: number;
  missing: string[];
  hasEmail: boolean;
  hasPhone: boolean;
  contactPreference: "email" | "phone" | "either";
  transcript: ChatMessage[];
  attachments: AttachmentInfo[];
  messages: AdminThreadMessage[];
  notes: AdminNote[];
  audit: AuditEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface RevealedContact {
  email: string | null;
  phone: string | null;
  preference: "email" | "phone" | "either";
}

export const updateStatusSchema = z.object({ status: reportStatusSchema });
export const adminMessageSchema = z.object({ body: messageBodySchema });
export const adminNoteSchema = z.object({ body: messageBodySchema });
