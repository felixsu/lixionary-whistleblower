"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  emptyDraft,
  type AttachmentInfo,
  type ChatMessage,
  type CreateIntakeResponse,
  type IntakeStateResponse,
  type ReportDraft,
} from "@whistle/shared";
import { api, ApiError, errorMessage } from "@/lib/api";
import { intakeHeaders, saveIntake, saveResult, savedIntake, type IntakeHandle } from "@/lib/intake";
import { Alert, Spinner } from "@/components/ui";
import { StepIndicator, type Step } from "@/components/report/step-indicator";
import { IntroStep } from "@/components/report/intro-step";
import { ChatStep, type Assessment } from "@/components/report/chat-step";
import { ReviewStep } from "@/components/report/review-step";
import { ContactStep } from "@/components/report/contact-step";

export default function ReportPage() {
  const router = useRouter();
  const [booting, setBooting] = useState(true);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [handle, setHandle] = useState<IntakeHandle | null>(null);
  const [step, setStep] = useState<Step>("intro");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState<ReportDraft>(emptyDraft);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [files, setFiles] = useState<AttachmentInfo[]>([]);
  const [startError, setStartError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // Resume an in-progress report in this tab (e.g. after a refresh).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const health = await api<{ ai: boolean }>("/api/health").catch(() => ({ ai: false }));
      if (cancelled) return;
      setAiEnabled(health.ai);
      const saved = savedIntake();
      if (saved) {
        try {
          const state = await api<IntakeStateResponse & { attachments: AttachmentInfo[] }>(
            `/api/intake/sessions/${saved.id}`,
            { headers: intakeHeaders(saved) },
          );
          if (cancelled) return;
          setHandle(saved);
          setMessages(state.messages);
          setDraft(state.draft);
          setFiles(state.attachments);
          if (state.completeness > 0) setAssessment({ completeness: state.completeness, missing: state.missing });
          const chatted = state.messages.some((m) => m.role === "user");
          setStep(state.aiEnabled && chatted ? "chat" : chatted || state.attachments.length ? "review" : "intro");
        } catch {
          saveIntake(null);
        }
      }
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function start(mode: "chat" | "form") {
    setStarting(true);
    setStartError(null);
    try {
      let h = handle;
      if (!h) {
        const created = await api<CreateIntakeResponse>("/api/intake/sessions", { method: "POST" });
        h = { id: created.id, token: created.token };
        saveIntake(h);
        setHandle(h);
        setAiEnabled(created.aiEnabled);
        setMessages([{ role: "assistant", content: created.greeting }]);
        if (mode === "chat" && !created.aiEnabled) mode = "form";
      }
      setStep(mode === "chat" ? "chat" : "review");
    } catch (err) {
      setStartError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  function sessionLost(err: unknown) {
    if (err instanceof ApiError && [404, 409, 410].includes(err.status)) {
      saveIntake(null);
      setHandle(null);
      setStep("intro");
      setStartError("Your session expired or was already submitted. Please start a new report.");
      return true;
    }
    return false;
  }

  function onSubmitted(result: { caseCode: string; pin: string }) {
    saveResult(result);
    saveIntake(null);
    router.push("/report/submitted");
  }

  if (booting) return <Spinner />;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Make a report</h1>
        {step !== "intro" && <StepIndicator step={step} withChat={aiEnabled} />}
      </div>

      {startError && <Alert tone="danger">{startError}</Alert>}

      {step === "intro" && <IntroStep aiEnabled={aiEnabled} starting={starting} onStart={start} />}

      {step === "chat" && handle && (
        <ChatStep
          handle={handle}
          messages={messages}
          setMessages={setMessages}
          assessment={assessment}
          onAssessment={(a, d) => {
            setAssessment(a);
            setDraft(d);
          }}
          onReview={() => setStep("review")}
          onSessionLost={sessionLost}
        />
      )}

      {step === "review" && (
        <ReviewStep
          draft={draft}
          setDraft={setDraft}
          missing={assessment?.missing ?? []}
          canChat={aiEnabled}
          onBack={() => setStep("chat")}
          onContinue={() => setStep("contact")}
        />
      )}

      {step === "contact" && handle && (
        <ContactStep
          handle={handle}
          draft={draft}
          files={files}
          setFiles={setFiles}
          onBack={() => setStep("review")}
          onSubmitted={onSubmitted}
          onSessionLost={sessionLost}
        />
      )}
    </div>
  );
}
