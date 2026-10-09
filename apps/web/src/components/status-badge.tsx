import { STATUS_LABELS, type ReportStatus } from "@whistle/shared";
import { Badge } from "./ui";

const TONES: Record<ReportStatus, "neutral" | "info" | "warn" | "ok" | "danger"> = {
  new: "info",
  under_review: "neutral",
  need_info: "warn",
  valid: "ok",
  contacted: "ok",
  closed_resolved: "neutral",
  closed_invalid: "neutral",
};

export function StatusBadge({ status }: { status: ReportStatus }) {
  return <Badge tone={TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}
