"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ArrowLeft, FileUp, Paperclip, X } from "lucide-react";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  contactSchema,
  type AttachmentInfo,
  type ReportDraft,
  type SubmitReportResponse,
} from "@whistle/shared";
import { api, ApiError, errorMessage } from "@/lib/api";
import { intakeHeaders, type IntakeHandle } from "@/lib/intake";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

const ACCEPT = [...Object.keys(ALLOWED_ATTACHMENT_TYPES), ".txt", ".docx", ".xlsx"].join(",");

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function ContactStep({
  handle,
  draft,
  files,
  setFiles,
  onBack,
  onSubmitted,
  onSessionLost,
}: {
  handle: IntakeHandle;
  draft: ReportDraft;
  files: AttachmentInfo[];
  setFiles: Dispatch<SetStateAction<AttachmentInfo[]>>;
  onBack: () => void;
  onSubmitted: (r: SubmitReportResponse) => void;
  onSessionLost: (err: unknown) => boolean;
}) {
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [preference, setPreference] = useState<"email" | "phone" | "either">("either");
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(list)) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setUploadError(`"${file.name}" is larger than 10 MB.`);
          continue;
        }
        const form = new FormData();
        form.append("file", file);
        try {
          const info = await api<AttachmentInfo>(`/api/intake/sessions/${handle.id}/attachments`, {
            method: "POST",
            headers: intakeHeaders(handle),
            body: form,
          });
          setFiles((f) => [...f, info]);
        } catch (err) {
          if (onSessionLost(err)) return;
          setUploadError(`"${file.name}": ${errorMessage(err)}`);
          if (err instanceof ApiError && err.code === "too_many_files") break;
        }
      }
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function removeFile(id: string) {
    try {
      await api(`/api/intake/sessions/${handle.id}/attachments/${id}`, { method: "DELETE", headers: intakeHeaders(handle) });
    } catch (err) {
      if (onSessionLost(err)) return;
    }
    setFiles((f) => f.filter((x) => x.id !== id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const contact = contactSchema.safeParse({ email: email.trim(), phone: phone.trim(), preference });
    if (!contact.success) {
      setErrors(Object.fromEntries(contact.error.issues.map((i) => [i.path.join("."), i.message])));
      return;
    }
    setErrors({});
    if (!confirmed) {
      setSubmitError("Please confirm the statement below before submitting.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api<SubmitReportResponse>("/api/reports", {
        method: "POST",
        body: {
          intakeSessionId: handle.id,
          intakeToken: handle.token,
          report: draft,
          contact: contact.data,
          attachmentIds: files.map((f) => f.id),
          consent: true,
        },
      });
      onSubmitted(result);
    } catch (err) {
      setSubmitting(false);
      if (onSessionLost(err)) return;
      if (err instanceof ApiError && err.issues.length) {
        const fe = err.fieldErrors();
        setErrors({ email: fe["contact.email"] ?? "", phone: fe["contact.phone"] ?? "" });
      }
      setSubmitError(errorMessage(err));
    }
  }

  return (
    <form className="space-y-5" onSubmit={submit} noValidate>
      <Card className="space-y-5">
        <div className="space-y-1">
          <h2 className="font-semibold">How can we reach you?</h2>
          <p className="text-sm text-muted">
            Give at least one. Your details are encrypted and only shown to the review team if they need to follow up.
            A personal email or number is safer than a work one.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Email" htmlFor="c-email" error={errors.email || undefined}>
            <Input
              id="c-email"
              type="email"
              autoComplete="email"
              value={email}
              invalid={!!errors.email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Phone or WhatsApp" htmlFor="c-phone" error={errors.phone || undefined}>
            <Input
              id="c-phone"
              type="tel"
              autoComplete="tel"
              value={phone}
              invalid={!!errors.phone}
              placeholder="+62 812 3456 7890"
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Preferred contact method</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {(["either", "email", "phone"] as const).map((p) => (
              <label key={p} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="preference"
                  className="size-4 accent-[var(--accent)]"
                  checked={preference === p}
                  onChange={() => setPreference(p)}
                />
                {p === "either" ? "Either is fine" : p === "email" ? "Email" : "Phone"}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="space-y-4">
        <div className="space-y-1">
          <h2 className="font-semibold">Evidence (optional)</h2>
          <p className="text-sm text-muted">
            Up to {MAX_ATTACHMENTS} files, 10 MB each: PDF, images, text, Word or Excel. Photo location data is removed
            automatically; document properties (like author name) are not — check them before uploading.
          </p>
        </div>
        {files.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Paperclip className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{f.originalName}</span>
                <span className="text-xs text-muted tabular-nums">{formatBytes(f.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  className="rounded p-1 text-muted hover:bg-sunken hover:text-ink"
                  aria-label={`Remove ${f.originalName}`}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        {uploadError && <Alert tone="danger">{uploadError}</Alert>}
        <input
          ref={fileInput}
          id="evidence"
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => addFiles(e.target.files)}
          disabled={uploading || files.length >= MAX_ATTACHMENTS}
        />
        <Button
          type="button"
          variant="secondary"
          loading={uploading}
          disabled={files.length >= MAX_ATTACHMENTS}
          onClick={() => fileInput.current?.click()}
        >
          <FileUp className="size-4" aria-hidden /> {uploading ? "Uploading" : "Add files"}
        </Button>
      </Card>

      <Card className="space-y-4">
        <label className="flex items-start gap-2.5 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--accent)]"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I confirm this report is made in good faith and is accurate to the best of my knowledge.
        </label>
        {submitError && <Alert tone="danger">{submitError}</Alert>}
        <div className="flex flex-wrap justify-between gap-3">
          <Button type="button" variant="secondary" onClick={onBack} disabled={submitting}>
            <ArrowLeft className="size-4" aria-hidden /> Back
          </Button>
          <Button type="submit" loading={submitting} disabled={uploading}>
            Submit report
          </Button>
        </div>
      </Card>
    </form>
  );
}
