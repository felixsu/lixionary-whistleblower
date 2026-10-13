"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { Field, Select, ErrorBox, friendly } from "./common";
import type {
  AdmissionChallenge,
  AdmissionVerification,
} from "@whistle/shared";
export function ReportGate({
  lang,
  resumeToken,
  onVerified,
  onCancel,
}: {
  lang: "en" | "id";
  resumeToken?: string;
  onVerified: (token: string) => void;
  onCancel: () => void;
}) {
  const id = lang === "id",
    text = (en: string, indo: string) => (id ? indo : en);
  const dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(true);
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [step, setStep] = useState<"email" | "unregistered" | "otp" | "disabled">(
      "email",
    ),
    [challenge, setChallenge] = useState<string>(),
    [resendAt, setResendAt] = useState(0),
    [seconds, setSeconds] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const current = useRef<{ challengeId?: string }>({});
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      alive.current = false;
      dialog.current?.close();
      document.body.style.overflow = overflow;
      previous?.focus();
      if (current.current.challengeId)
        void api("/privacy/admission/cancel", {
          method: "POST",
          body: current.current,
        }).catch(() => {});
    };
  }, []);
  useEffect(() => {
    const update = () =>
      setSeconds(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      if (alive.current) setError(friendly(e, lang));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function send() {
    const r = await api<AdmissionChallenge>("/privacy/admission/challenge", {
      method: "POST",
      body: { email, purpose: "report", locale: lang },
    });
    if (!alive.current) {
      if (r.status === "otp")
        await api("/privacy/admission/cancel", {
          method: "POST",
          body: { challengeId: r.challengeId },
        });
      return;
    }
    setCode("");
    if (r.status === "otp") {
      setChallenge(r.challengeId);
      current.current = { challengeId: r.challengeId };
      setResendAt(Date.now() + r.resendAfter * 1000);
      setStep("otp");
    } else setStep(r.status);
  }
  const close = () => {
    setEmail("");
    setCode("");
    onCancel();
  };
  return (
    <dialog
      ref={dialog}
      className="report-gate"
      aria-labelledby="report-gate-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) close();
      }}
    >
      <div className="report-gate-panel">
        <h2 id="report-gate-title">
          {text("Verify your employee email", "Verifikasi email karyawan Anda")}
        </h2>
        <p>
          {text(
            "Your email confirms reporting eligibility. It is not shared with your report or used for case recovery.",
            "Email Anda memastikan kelayakan pelaporan. Email tidak disertakan dalam laporan atau digunakan untuk pemulihan laporan.",
          )}
        </p>
        {resumeToken && (
          <p>
            {text(
              "Your access expired. Verify the same email to continue your unfinished report.",
              "Akses Anda kedaluwarsa. Verifikasi email yang sama untuk melanjutkan laporan Anda.",
            )}
          </p>
        )}
        <ErrorBox error={error} />
        {step === "email" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => send());
            }}
          >
            <Select
              label={text("Verification method", "Metode verifikasi")}
              value="email"
              onChange={() => {}}
            >
              <option value="email">Email</option>
              <option value="phone" disabled>
                {text("Phone — Not available yet", "Telepon — Belum tersedia")}
              </option>
            </Select>
            <Field
              label="Email"
              type="email"
              required
              maxLength={254}
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button disabled={busy}>{text("Continue", "Lanjutkan")}</button>
          </form>
        )}
        {step === "otp" && (
          <>
            <p role="status">
              {text(
                `A code was queued for ${email}. It expires in five minutes.`,
                `Kode dikirim ke ${email}. Berlaku lima menit.`,
              )}
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const r = await api<AdmissionVerification>(
                    "/privacy/admission/verify",
                    {
                      method: "POST",
                      body: {
                        challengeId: challenge,
                        code,
                        ...(resumeToken ? { resumeToken } : {}),
                      },
                    },
                  );
                  if ("reportToken" in r) {
                    if (alive.current) {
                      current.current = {};
                      onVerified(r.reportToken);
                    } else
                      await api("/privacy/admission/cancel", {
                        method: "POST",
                        body: { reportToken: r.reportToken },
                      });
                  } else {
                    throw new Error(
                      text(
                        "Email verification did not grant reporting access.",
                        "Verifikasi email tidak memberikan akses pelaporan.",
                      ),
                    );
                  }
                });
              }}
            >
              <Field
                label={text("Verification code", "Kode verifikasi")}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <button disabled={busy}>{text("Verify", "Verifikasi")}</button>
            </form>
            <button
              className="secondary"
              disabled={busy || seconds > 0}
              onClick={() => void run(() => send())}
            >
              {seconds > 0
                ? text(`Resend in ${seconds}s`, `Kirim ulang dalam ${seconds}d`)
                : text("Resend code", "Kirim ulang kode")}
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              {text("Change details", "Ubah data")}
            </button>
          </>
        )}
        {step === "unregistered" && (
          <p role="status">
            {text(
              "This email is not registered. You cannot create a report. Contact your company administrator to register your email, then return to verify it.",
              "Email ini belum terdaftar. Anda tidak dapat membuat laporan. Hubungi administrator perusahaan untuk mendaftarkan email Anda, lalu kembali untuk memverifikasinya.",
            )}
          </p>
        )}
        {step === "disabled" && (
          <p role="status">
            {text(
              "Your reporting access is disabled. Contact your company administrator.",
              "Akses pelaporan Anda dinonaktifkan. Hubungi administrator perusahaan.",
            )}
          </p>
        )}
        {(step === "unregistered" || step === "disabled") && (
          <button
            className="secondary"
            onClick={() => {
              setStep("email");
              setEmail("");
              setCode("");
              setError("");
            }}
          >
            {text("Try another email", "Coba email lain")}
          </button>
        )}
        <button className="secondary" onClick={close}>
          {text("Close", "Tutup")}
        </button>
      </div>
    </dialog>
  );
}
