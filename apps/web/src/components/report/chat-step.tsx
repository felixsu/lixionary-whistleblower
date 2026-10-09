"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import clsx from "clsx";
import { ArrowRight, Send } from "lucide-react";
import { DETAIL_LABELS, MAX_MESSAGE_CHARS, type ChatMessage, type DraftAssessment, type ReportDraft } from "@whistle/shared";
import { api, errorMessage } from "@/lib/api";
import { intakeHeaders, streamChat, type IntakeHandle } from "@/lib/intake";
import { Alert, Button, Card, CompletenessMeter } from "@/components/ui";

export interface Assessment {
  completeness: number;
  missing: string[];
}

const CHECKLIST = (["what", "who", "when", "where", "howKnown", "evidence"] as const).map((k) => DETAIL_LABELS[k]);

export function ChatStep({
  handle,
  messages,
  setMessages,
  assessment,
  onAssessment,
  onReview,
  onSessionLost,
}: {
  handle: IntakeHandle;
  messages: ChatMessage[];
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  assessment: Assessment | null;
  onAssessment: (a: Assessment, draft: ReportDraft) => void;
  onReview: () => void;
  onSessionLost: (err: unknown) => boolean;
}) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestFinish, setSuggestFinish] = useState(false);
  const [assessing, setAssessing] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userTurns = messages.filter((m) => m.role === "user").length;

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  async function assess(): Promise<boolean> {
    setAssessing(true);
    try {
      const a = await api<DraftAssessment>(`/api/intake/sessions/${handle.id}/draft`, {
        method: "POST",
        headers: intakeHeaders(handle),
      });
      onAssessment({ completeness: a.completeness, missing: a.missing }, a.draft);
      return true;
    } catch (err) {
      onSessionLost(err);
      return false;
    } finally {
      setAssessing(false);
    }
  }

  async function send() {
    const content = input.trim();
    if (!content || streaming !== null) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content }]);
    setStreaming("");
    const controller = new AbortController();
    abortRef.current = controller;
    let reply = "";
    let failed: string | null = null;
    let finished = false;
    try {
      await streamChat(
        handle,
        content,
        (event) => {
          if (event.type === "delta") {
            reply += event.text;
            setStreaming(reply);
          } else if (event.type === "done") {
            finished = true;
            setSuggestFinish(event.suggestFinish);
            // Refresh the live draft every other turn, or when the assistant thinks we're done.
            if (event.suggestFinish || event.turnCount % 2 === 0) void assess();
          } else {
            failed = event.message;
          }
        },
        controller.signal,
      );
    } catch (err) {
      if (!controller.signal.aborted) failed = errorMessage(err);
    }
    setStreaming(null);
    if (finished && !failed) {
      setMessages((m) => [...m, { role: "assistant", content: reply.trim() }]);
    } else if (!controller.signal.aborted) {
      // The server discarded this turn; restore the text so the reporter can retry.
      setMessages((m) => m.slice(0, -1));
      setInput(content);
      setError(failed ?? "The assistant didn't respond. Please try again.");
    }
  }

  async function review() {
    setPreparing(true);
    // If the AI draft fails, the review form still opens with whatever we have so far.
    await assess();
    setPreparing(false);
    onReview();
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_18rem]">
      <Card className="flex h-[min(70dvh,40rem)] flex-col p-0 sm:p-0">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5" aria-live="polite">
          {messages.map((m, i) => (
            <Bubble key={i} role={m.role} text={m.content} />
          ))}
          {streaming !== null &&
            (streaming ? (
              <Bubble role="assistant" text={streaming} />
            ) : (
              <div className="flex gap-1 px-1 text-muted" aria-label="Assistant is typing">
                <span className="typing-dot">●</span>
                <span className="typing-dot">●</span>
                <span className="typing-dot">●</span>
              </div>
            ))}
        </div>

        <div className="space-y-2 border-t border-line p-3 sm:p-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="chat-input" className="sr-only">
              Your message
            </label>
            <textarea
              id="chat-input"
              value={input}
              maxLength={MAX_MESSAGE_CHARS}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              placeholder={userTurns === 0 ? "Describe what happened…" : "Type your answer…"}
              className="min-h-11 flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2.5 text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <Button type="submit" aria-label="Send" disabled={!input.trim() || streaming !== null} className="h-11 px-3">
              <Send className="size-4" aria-hidden />
            </Button>
          </form>
          <p className="text-xs text-muted">Enter to send · Shift+Enter for a new line</p>
        </div>
      </Card>

      <aside className="space-y-4">
        <Card className="space-y-4 p-5 sm:p-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm font-medium">
              Report completeness
              {assessing && <span className="text-xs font-normal text-muted">updating…</span>}
            </div>
            <CompletenessMeter value={assessment?.completeness ?? 0} />
          </div>
          {assessment && assessment.missing.length > 0 ? (
            <div className="space-y-1.5 text-sm">
              <p className="font-medium">Still useful to know</p>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {assessment.missing.slice(0, 5).map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="space-y-1.5 text-sm">
              <p className="font-medium">Investigators look for</p>
              <ul className="list-disc space-y-1 pl-5 text-muted">
                {CHECKLIST.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          )}
          <Button
            className="w-full"
            variant={suggestFinish ? "primary" : "secondary"}
            onClick={review}
            loading={preparing}
            disabled={userTurns === 0 || streaming !== null}
          >
            Review draft <ArrowRight className="size-4" aria-hidden />
          </Button>
          <p className="text-xs text-muted">You can edit everything before submitting.</p>
        </Card>
      </aside>
    </div>
  );
}

function Bubble({ role, text }: { role: "user" | "assistant"; text: string }) {
  return (
    <div className={clsx("flex", role === "user" ? "justify-end" : "justify-start")}>
      <div
        className={clsx(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap",
          role === "user" ? "rounded-br-md bg-accent text-accent-ink" : "rounded-bl-md bg-sunken",
        )}
      >
        {text}
      </div>
    </div>
  );
}
