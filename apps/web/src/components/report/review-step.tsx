"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import {
  CATEGORY_LABELS,
  DETAIL_LABELS,
  REPORT_CATEGORIES,
  finalReportSchema,
  type ReportCategory,
  type ReportDetails,
  type ReportDraft,
} from "@whistle/shared";
import { Alert, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";

const DETAIL_HINTS: Record<Exclude<keyof ReportDetails, "ongoing">, string> = {
  what: "Describe the events in order, as specifically as you can.",
  who: "Names, roles or departments of the people involved (not yourself).",
  when: "Dates, times, or how often it happens.",
  where: "Office, site, business unit, or system involved.",
  howKnown: "Did you see it yourself, hear about it, or find documents?",
  evidence: "What evidence exists and where it is kept. You can attach files on the next step.",
  impact: "Money involved, people affected, or other harm.",
};

export function ReviewStep({
  draft,
  setDraft,
  missing,
  canChat,
  onBack,
  onContinue,
}: {
  draft: ReportDraft;
  setDraft: Dispatch<SetStateAction<ReportDraft>>;
  missing: string[];
  canChat: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setField = <K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const setDetail = <K extends keyof ReportDetails>(key: K, value: ReportDetails[K]) =>
    setDraft((d) => ({ ...d, details: { ...d.details, [key]: value } }));

  function next() {
    const result = finalReportSchema.safeParse(draft);
    if (!result.success) {
      setErrors(Object.fromEntries(result.error.issues.map((i) => [i.path.join("."), i.message])));
      document.getElementById(`f-${result.error.issues[0]?.path.join("-")}`)?.focus();
      return;
    }
    setErrors({});
    onContinue();
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        {canChat
          ? "Here's the report drafted from your conversation. Check it carefully and correct anything that isn't right."
          : "Fill in as much as you can. Fields you don't know can be left blank."}
      </p>

      {missing.length > 0 && (
        <Alert tone="warn">
          <p className="font-medium">Investigators may also ask:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="mt-1.5">Add anything you know to the fields below{canChat ? ", or go back to the chat" : ""}.</p>
        </Alert>
      )}

      <Card className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-[16rem_1fr]">
          <Field label="Type of concern" htmlFor="f-category" error={errors.category}>
            <Select
              id="f-category"
              value={draft.category ?? ""}
              invalid={!!errors.category}
              onChange={(e) => setField("category", (e.target.value || null) as ReportCategory | null)}
            >
              <option value="">Choose one…</option>
              {REPORT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Short title" htmlFor="f-title" error={errors.title}>
            <Input
              id="f-title"
              value={draft.title}
              maxLength={200}
              invalid={!!errors.title}
              placeholder="e.g. Vendor payments to procurement staff"
              onChange={(e) => setField("title", e.target.value)}
            />
          </Field>
        </div>
        <Field label="Summary" htmlFor="f-summary" error={errors.summary} hint="A few sentences on what the concern is.">
          <Textarea
            id="f-summary"
            value={draft.summary}
            maxLength={5000}
            invalid={!!errors.summary}
            onChange={(e) => setField("summary", e.target.value)}
          />
        </Field>
      </Card>

      <Card className="space-y-5">
        <h2 className="font-semibold">Details</h2>
        <div className="grid gap-5 sm:grid-cols-2">
          {(Object.keys(DETAIL_HINTS) as (keyof typeof DETAIL_HINTS)[]).map((key) => (
            <Field
              key={key}
              label={DETAIL_LABELS[key]}
              htmlFor={`f-details-${key}`}
              hint={DETAIL_HINTS[key]}
              error={errors[`details.${key}`]}
              className={key === "what" ? "sm:col-span-2" : undefined}
            >
              <Textarea
                id={`f-details-${key}`}
                value={draft.details[key]}
                rows={key === "what" ? 5 : 3}
                onChange={(e) => setDetail(key, e.target.value)}
              />
            </Field>
          ))}
          <Field label={DETAIL_LABELS.ongoing} htmlFor="f-details-ongoing">
            <Select
              id="f-details-ongoing"
              value={draft.details.ongoing}
              onChange={(e) => setDetail("ongoing", e.target.value as ReportDetails["ongoing"])}
            >
              <option value="unknown">I don&apos;t know</option>
              <option value="yes">Yes, it is still happening</option>
              <option value="no">No, it has stopped</option>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="flex flex-wrap justify-between gap-3">
        {canChat ? (
          <Button variant="secondary" onClick={onBack}>
            <ArrowLeft className="size-4" aria-hidden /> Back to chat
          </Button>
        ) : (
          <span />
        )}
        <Button onClick={next}>
          Continue <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
