"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { STATUS_LABELS, isClosed, type StatusResponse } from "@whistle/shared";
import { api, errorMessage } from "@/lib/api";
import { Alert, Button, Card, Field, Input, Textarea } from "@/components/ui";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/format";

const STATUS_HELP: Record<StatusResponse["status"], string> = {
  new: "Your report has been received and is waiting to be reviewed.",
  under_review: "The review team is looking at your report.",
  need_info: "The review team needs more information. Please read their message below and reply.",
  valid: "Your report has been assessed and is being acted on.",
  contacted: "The review team has contacted you or will do so using the details you gave.",
  closed_resolved: "This case is closed. Thank you for speaking up.",
  closed_invalid: "This case has been closed because the concern could not be substantiated.",
};

export default function StatusPage() {
  // Credentials live only in component state — never stored in the browser.
  const [caseCode, setCaseCode] = useState("");
  const [pin, setPin] = useState("");
  const [data, setData] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      setData(await api<StatusResponse>("/api/status", { method: "POST", body: { caseCode, pin } }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setReplyError(null);
    setSending(true);
    try {
      setData(await api<StatusResponse>("/api/status/messages", { method: "POST", body: { caseCode, pin, body: reply } }));
      setReply("");
    } catch (err) {
      setReplyError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function signOut() {
    setData(null);
    setPin("");
    setCaseCode("");
    setReply("");
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-md space-y-6">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Check your report</h1>
          <p className="text-sm text-muted">Enter the case code and PIN you received when you submitted.</p>
        </div>
        <Card>
          <form className="space-y-4" onSubmit={lookup}>
            <Field label="Case code" htmlFor="s-code">
              <Input
                id="s-code"
                value={caseCode}
                onChange={(e) => setCaseCode(e.target.value)}
                placeholder="WB-XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono"
                required
              />
            </Field>
            <Field label="PIN" htmlFor="s-pin">
              <Input
                id="s-pin"
                type="password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
                className="font-mono"
                required
              />
            </Field>
            {error && <Alert tone="danger">{error}</Alert>}
            <Button type="submit" className="w-full" loading={loading}>
              View report
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  const closed = isClosed(data.status);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-sm text-muted">{data.caseCode}</p>
          <h1 className="text-2xl font-semibold tracking-tight">{data.title}</h1>
          <p className="text-xs text-muted">Submitted {formatDateTime(data.createdAt)}</p>
        </div>
        <Button variant="ghost" onClick={signOut}>
          <LogOut className="size-4" aria-hidden /> Close
        </Button>
      </div>

      <Card className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Status</span>
          <StatusBadge status={data.status} />
        </div>
        <p className="text-sm text-muted">{STATUS_HELP[data.status]}</p>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Messages</h2>
        {data.messages.length === 0 ? (
          <p className="text-sm text-muted">No messages yet. Check back later — the review team may post questions here.</p>
        ) : (
          <ul className="space-y-3">
            {data.messages.map((m) => (
              <li
                key={m.id}
                className={`rounded-xl px-4 py-3 text-sm ${m.author === "admin" ? "bg-sunken" : "ml-8 bg-accent-soft"}`}
              >
                <p className="mb-1 text-xs text-muted">
                  {m.author === "admin" ? "Review team" : "You"} · {formatDateTime(m.createdAt)}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{m.body}</p>
              </li>
            ))}
          </ul>
        )}

        {closed ? (
          <p className="text-sm text-muted">This case is {STATUS_LABELS[data.status].toLowerCase()} and no longer accepts messages.</p>
        ) : (
          <form className="space-y-3 border-t border-line pt-4" onSubmit={sendReply}>
            <Field label="Send a message to the review team" htmlFor="s-reply">
              <Textarea id="s-reply" value={reply} maxLength={4000} onChange={(e) => setReply(e.target.value)} />
            </Field>
            {replyError && <Alert tone="danger">{replyError}</Alert>}
            <Button type="submit" loading={sending} disabled={!reply.trim()}>
              Send
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
