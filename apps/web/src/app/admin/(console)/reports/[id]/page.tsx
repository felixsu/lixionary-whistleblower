"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Download, Eye, Mail, Phone } from "lucide-react";
import {
  CATEGORY_LABELS,
  DETAIL_LABELS,
  REPORT_STATUSES,
  STATUS_LABELS,
  type AdminReportDetail,
  type ReportDetails,
  type ReportStatus,
  type RevealedContact,
} from "@whistle/shared";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Alert, Button, Card, CompletenessMeter, Select, Spinner, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { formatBytes } from "@/components/report/contact-step";

const ONGOING: Record<ReportDetails["ongoing"], string> = { yes: "Yes", no: "No", unknown: "Unknown" };

const AUDIT_LABELS: Record<string, string> = {
  contact_revealed: "Revealed contact details",
  status_changed: "Changed status",
  message_sent: "Messaged the reporter",
  attachment_downloaded: "Downloaded an attachment",
};

export default function ReportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const key = ["report", id];
  const report = useQuery({ queryKey: key, queryFn: () => api<AdminReportDetail>(`/api/admin/reports/${id}`) });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
  };

  const setStatus = useMutation({
    mutationFn: (status: ReportStatus) => api(`/api/admin/reports/${id}/status`, { method: "PATCH", body: { status } }),
    onSuccess: refresh,
  });

  if (report.isPending) return <Spinner />;
  if (report.isError) return <Alert tone="danger">{errorMessage(report.error)}</Alert>;
  const r = report.data;

  return (
    <div className="space-y-6">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> All reports
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="font-mono">{r.caseCode}</span>·<span>{CATEGORY_LABELS[r.category]}</span>·
            <span>{formatDateTime(r.createdAt)}</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-pretty">{r.title}</h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={r.status} />
          <Select
            aria-label="Change status"
            className="w-auto"
            value={r.status}
            disabled={setStatus.isPending}
            onChange={(e) => setStatus.mutate(e.target.value as ReportStatus)}
          >
            {REPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
      </div>
      {setStatus.isError && <Alert tone="danger">{errorMessage(setStatus.error)}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Card className="space-y-5">
            <section className="space-y-1.5">
              <h2 className="text-sm font-semibold">Summary</h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{r.summary}</p>
            </section>
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {(Object.keys(DETAIL_LABELS) as (keyof ReportDetails)[]).map((k) => {
                const value = k === "ongoing" ? ONGOING[r.details.ongoing] : r.details[k];
                return (
                  <div key={k} className={clsx("space-y-1", k === "what" && "sm:col-span-2")}>
                    <dt className="text-xs font-medium tracking-wide text-muted uppercase">{DETAIL_LABELS[k]}</dt>
                    <dd className={clsx("text-sm leading-relaxed whitespace-pre-wrap", !value && "text-muted italic")}>
                      {value || "Not provided"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </Card>

          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-sm font-semibold">Completeness</h2>
              <div className="w-48">
                <CompletenessMeter value={r.completeness} />
              </div>
            </div>
            {r.missing.length > 0 ? (
              <div className="text-sm">
                <p className="mb-1 text-muted">Open questions identified by the AI assistant:</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {r.missing.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-muted">
                {r.transcript.some((m) => m.role === "user")
                  ? "No open questions were flagged."
                  : "Submitted via the form; completeness is estimated from the fields filled in."}
              </p>
            )}
          </Card>

          {r.attachments.length > 0 && (
            <Card className="space-y-3">
              <h2 className="text-sm font-semibold">Evidence</h2>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {r.attachments.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{a.originalName}</span>
                    <span className="text-xs text-muted tabular-nums">{formatBytes(a.size)}</span>
                    <a
                      href={`/api/admin/attachments/${a.id}`}
                      onClick={() => setTimeout(refresh, 1000)}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-accent hover:bg-sunken"
                    >
                      <Download className="size-4" aria-hidden /> Download
                    </a>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted">Files are untrusted. Open them on a protected machine.</p>
            </Card>
          )}

          {r.transcript.some((m) => m.role === "user") && (
            <Card>
              <details>
                <summary className="cursor-pointer text-sm font-semibold">Intake conversation ({r.transcript.length} messages)</summary>
                <ol className="mt-4 space-y-3">
                  {r.transcript.map((m, i) => (
                    <li key={i} className={clsx("rounded-xl px-4 py-2.5 text-sm", m.role === "user" ? "bg-accent-soft" : "bg-sunken")}>
                      <p className="mb-0.5 text-xs text-muted">{m.role === "user" ? "Reporter" : "Assistant"}</p>
                      <p className="leading-relaxed whitespace-pre-wrap">{m.content}</p>
                    </li>
                  ))}
                </ol>
              </details>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <ContactCard report={r} onChange={refresh} />
          <ThreadCard report={r} onChange={refresh} />
          <NotesCard report={r} onChange={refresh} />
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold">Activity</h2>
            {r.audit.length === 0 ? (
              <p className="text-sm text-muted">No activity yet.</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {r.audit.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{a.adminName ?? "Former admin"}</span>{" "}
                    <span className="text-muted">
                      {AUDIT_LABELS[a.action] ?? a.action}
                      {a.action === "status_changed" && ` → ${STATUS_LABELS[a.meta.to as ReportStatus] ?? a.meta.to}`}
                    </span>
                    <div className="text-muted">{formatDateTime(a.createdAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ContactCard({ report, onChange }: { report: AdminReportDetail; onChange: () => void }) {
  const [contact, setContact] = useState<RevealedContact | null>(null);
  const reveal = useMutation({
    mutationFn: () => api<RevealedContact>(`/api/admin/reports/${report.id}/reveal-contact`, { method: "POST" }),
    onSuccess: (c) => {
      setContact(c);
      onChange();
    },
  });
  const pref = { email: "Email", phone: "Phone", either: "Either" }[report.contactPreference];

  return (
    <Card className="space-y-3">
      <h2 className="text-sm font-semibold">Reporter contact</h2>
      {contact ? (
        <div className="space-y-2 text-sm">
          {contact.email && (
            <a href={`mailto:${contact.email}?subject=${encodeURIComponent(`Your report ${report.caseCode}`)}`} className="flex items-center gap-2 text-accent hover:underline">
              <Mail className="size-4 shrink-0" aria-hidden /> <span className="break-all">{contact.email}</span>
            </a>
          )}
          {contact.phone && (
            <a href={`tel:${contact.phone.replace(/[^+\d]/g, "")}`} className="flex items-center gap-2 text-accent hover:underline">
              <Phone className="size-4 shrink-0" aria-hidden /> {contact.phone}
            </a>
          )}
          <p className="text-xs text-muted">Prefers: {pref}. Refer to the case code, never the reporter&apos;s identity, in any record.</p>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">
            {[report.hasEmail && "Email", report.hasPhone && "Phone"].filter(Boolean).join(" and ")} on file · prefers {pref.toLowerCase()}.
            Details are encrypted; revealing them is logged.
          </p>
          {reveal.isError && <Alert tone="danger">{errorMessage(reveal.error)}</Alert>}
          <Button variant="secondary" className="w-full" loading={reveal.isPending} onClick={() => reveal.mutate()}>
            <Eye className="size-4" aria-hidden /> Reveal contact details
          </Button>
        </>
      )}
    </Card>
  );
}

function ThreadCard({ report, onChange }: { report: AdminReportDetail; onChange: () => void }) {
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: () => api(`/api/admin/reports/${report.id}/messages`, { method: "POST", body: { body } }),
    onSuccess: () => {
      setBody("");
      onChange();
    },
  });
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Messages with reporter</h2>
        <p className="text-xs text-muted">The reporter reads these with their case code and PIN.</p>
      </div>
      {report.messages.length > 0 && (
        <ul className="max-h-80 space-y-2 overflow-y-auto">
          {report.messages.map((m) => (
            <li key={m.id} className={clsx("rounded-xl px-3 py-2 text-sm", m.author === "admin" ? "ml-4 bg-accent-soft" : "mr-4 bg-sunken")}>
              <p className="mb-0.5 text-xs text-muted">
                {m.author === "admin" ? (m.adminName ?? "Admin") : "Reporter"} · {formatDateTime(m.createdAt)}
              </p>
              <p className="leading-relaxed whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) send.mutate();
        }}
      >
        <label htmlFor="thread-msg" className="sr-only">
          Message to reporter
        </label>
        <Textarea id="thread-msg" rows={3} value={body} maxLength={4000} placeholder="Ask a follow-up question…" onChange={(e) => setBody(e.target.value)} />
        {send.isError && <Alert tone="danger">{errorMessage(send.error)}</Alert>}
        <Button type="submit" className="w-full" loading={send.isPending} disabled={!body.trim()}>
          Send to reporter
        </Button>
      </form>
    </Card>
  );
}

function NotesCard({ report, onChange }: { report: AdminReportDetail; onChange: () => void }) {
  const [body, setBody] = useState("");
  const add = useMutation({
    mutationFn: () => api(`/api/admin/reports/${report.id}/notes`, { method: "POST", body: { body } }),
    onSuccess: () => {
      setBody("");
      onChange();
    },
  });
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Internal notes</h2>
        <p className="text-xs text-muted">Visible to admins only.</p>
      </div>
      {report.notes.length > 0 && (
        <ul className="space-y-2">
          {report.notes.map((n) => (
            <li key={n.id} className="rounded-xl bg-warn-soft/60 px-3 py-2 text-sm">
              <p className="mb-0.5 text-xs text-muted">
                {n.adminName} · {formatDateTime(n.createdAt)}
              </p>
              <p className="leading-relaxed whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate();
        }}
      >
        <label htmlFor="note" className="sr-only">
          Internal note
        </label>
        <Textarea id="note" rows={2} value={body} maxLength={4000} placeholder="Add a note…" onChange={(e) => setBody(e.target.value)} />
        {add.isError && <Alert tone="danger">{errorMessage(add.error)}</Alert>}
        <Button type="submit" variant="secondary" className="w-full" loading={add.isPending} disabled={!body.trim()}>
          Add note
        </Button>
      </form>
    </Card>
  );
}
