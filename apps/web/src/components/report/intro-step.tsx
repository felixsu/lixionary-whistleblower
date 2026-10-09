"use client";

import { useState } from "react";
import { Bot, FileText } from "lucide-react";
import { Alert, Button, Card } from "@/components/ui";

export function IntroStep({
  aiEnabled,
  starting,
  onStart,
}: {
  aiEnabled: boolean;
  starting: boolean;
  onStart: (mode: "chat" | "form") => void;
}) {
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_20rem]">
      <Card className="space-y-5">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Before you start</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
            <li>You don&apos;t need an account. At the end you&apos;ll get a case code and PIN to follow up.</li>
            <li>Leave an email address or phone number so the review team can contact you if your report needs follow-up.</li>
            <li>Please don&apos;t include your own name or job title in the description.</li>
            <li>Your progress is kept only in this browser tab for up to 24 hours.</li>
          </ul>
        </div>

        {aiEnabled ? (
          <>
            <Alert tone="info">
              Our assistant asks follow-up questions to make sure your report has the details investigators need. Your
              messages are processed by an external AI provider (MiniMax) only to help write this report.
            </Alert>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-[var(--accent)]"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              I understand and want to use the assistant.
            </label>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => onStart("chat")} disabled={!agreed} loading={starting}>
                <Bot className="size-4" aria-hidden /> Start with the assistant
              </Button>
              <Button variant="secondary" onClick={() => onStart("form")} disabled={starting}>
                <FileText className="size-4" aria-hidden /> Use the form instead
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-4">
            <Alert tone="warn">The guided assistant isn&apos;t available right now, but you can still report using the form.</Alert>
            <Button onClick={() => onStart("form")} loading={starting}>
              <FileText className="size-4" aria-hidden /> Start the form
            </Button>
          </div>
        )}
      </Card>

      <aside className="space-y-2 rounded-2xl bg-sunken p-5 text-sm leading-relaxed text-muted">
        <p className="font-medium text-ink">What makes a report useful?</p>
        <p>What happened, who was involved, when and where, how you know, and what evidence exists. It&apos;s fine if you don&apos;t know everything.</p>
        <p className="pt-2 font-medium text-ink">In immediate danger?</p>
        <p>Contact your local emergency services first.</p>
      </aside>
    </div>
  );
}
