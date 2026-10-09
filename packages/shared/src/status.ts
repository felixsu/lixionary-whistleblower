import { z } from "zod";

export const REPORT_STATUSES = [
  "new",
  "under_review",
  "need_info",
  "valid",
  "contacted",
  "closed_resolved",
  "closed_invalid",
] as const;

export const reportStatusSchema = z.enum(REPORT_STATUSES);
export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const STATUS_LABELS: Record<ReportStatus, string> = {
  new: "Received",
  under_review: "Under review",
  need_info: "More information needed",
  valid: "Validated",
  contacted: "Reporter contacted",
  closed_resolved: "Closed — resolved",
  closed_invalid: "Closed — not substantiated",
};

export function isClosed(status: ReportStatus): boolean {
  return status === "closed_resolved" || status === "closed_invalid";
}
