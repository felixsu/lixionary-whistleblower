"use client";
import { useEffect, useRef, useState } from "react";
import localFont from "next/font/local";
import { safeStaffReturn } from "@/components/suite/staff-navigation";
import { QRCodeSVG } from "qrcode.react";
import { api, ApiError } from "@/lib/api";
import {
  Shell,
  useLanguage,
  useAction,
  Field,
  ErrorBox,
  friendly,
} from "@/components/suite/common";

const googleSans = localFont({
  src: "../../fonts/google-sans-latin-500-normal.woff2",
  weight: "500",
  display: "swap",
  preload: false,
});

export default function Login() {
  const l = useLanguage(),
    { t, lang } = l,
    a = useAction(lang);
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [stage, setStage] = useState<"password" | "mfa" | "saved">("password"),
    [enroll, setEnroll] = useState<{ secret: string; uri: string }>(),
    [code, setCode] = useState(""),
    [codes, setCodes] = useState<string[]>([]),
    [reset, setReset] = useState(false),
    [sent, setSent] = useState(false),
    [googleEnabled, setGoogleEnabled] = useState(false),
    [googleError, setGoogleError] = useState(""),
    [hydrated, setHydrated] = useState(false),
    [resuming, setResuming] = useState(false);
  const initialized = useRef(false);
  async function prepareMfa(enrolled: boolean) {
    if (!enrolled)
      setEnroll(
        await api("/api/staff/mfa/enroll", { method: "POST", body: {} }),
      );
    setStage("mfa");
  }
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    setHydrated(true);
    void api<{ googleEnabled: boolean }>("/api/staff/login/options")
      .then((options) => setGoogleEnabled(options.googleEnabled))
      .catch(() => {});
    const params = new URLSearchParams(window.location.search);
    const resume = params.get("google") === "continue";
    const error = params.get("googleError");
    if (error) {
      const known = [
        "google_cancelled",
        "google_expired",
        "google_ineligible",
        "google_disabled",
        "rate_limit",
      ];
      setGoogleError(known.includes(error) ? error : "google_failed");
    }
    params.delete("google");
    params.delete("googleError");
    if (resume || error)
      window.history.replaceState(
        null,
        "",
        `/staff/login${params.size ? "?" + params.toString() : ""}`,
      );
    if (resume) {
      setResuming(true);
      void api<{ mfaVerified: boolean; mfaEnrolled: boolean }>("/api/staff/me")
        .then(async (identity) => {
          if (identity.mfaVerified) finishLogin();
          else await prepareMfa(identity.mfaEnrolled);
        })
        .catch(() => setGoogleError("google_expired"))
        .finally(() => setResuming(false));
    }
  }, []);
  function finishLogin() {
    window.location.href = safeStaffReturn(
      new URLSearchParams(window.location.search).get("next"),
    );
  }
  return (
    <Shell language={l}>
      <section className="auth-card">
        <p className="eyebrow">{t("staffAccess")}</p>
        <h1>{t("staff")}</h1>
        {stage === "password" && <p className="muted">{t("staffIntro")}</p>}
        <ErrorBox
          error={
            a.error ||
            (googleError
              ? friendly(new ApiError(401, googleError, ""), lang)
              : "")
          }
        />
        {resuming && <p role="status">{t("loading")}</p>}
        {stage === "password" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setGoogleError("");
              void a.run(async () => {
                if (reset) {
                  await api("/api/staff/password/request", {
                    method: "POST",
                    body: { email },
                  });
                  setSent(true);
                  return;
                }
                const r = await api<{ mfaEnrolled: boolean }>(
                  "/api/staff/login",
                  { method: "POST", body: { email, password } },
                );
                setPassword("");
                await prepareMfa(r.mfaEnrolled);
              });
            }}
          >
            <Field
              label={t("email")}
              type="email"
              autoComplete="username"
              disabled={!hydrated || a.busy || resuming}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!reset && (
              <Field
                label={t("password")}
                type="password"
                autoComplete="current-password"
                disabled={!hydrated || a.busy || resuming}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <button disabled={!hydrated || a.busy || resuming}>
              {t(reset ? "reset" : "login")}
            </button>
            {!reset && googleEnabled && (
              <button
                className={`secondary google-login ${googleSans.className}`}
                type="button"
                disabled={!hydrated || a.busy || resuming}
                onClick={() => {
                  setGoogleError("");
                  void a.run(async () => {
                    const { authorizationUrl } = await api<{
                      authorizationUrl: string;
                    }>("/api/staff/google/start", {
                      method: "POST",
                      body: {
                        next: safeStaffReturn(
                          new URLSearchParams(window.location.search).get(
                            "next",
                          ),
                        ),
                      },
                    });
                    window.location.assign(authorizationUrl);
                  });
                }}
              >
                <img
                  src="/google-g.png"
                  width={20}
                  height={20}
                  alt=""
                  aria-hidden="true"
                />
                <span>{t("googleLogin")}</span>
              </button>
            )}
            <button
              className="secondary"
              type="button"
              disabled={!hydrated || a.busy || resuming}
              onClick={() => setReset(!reset)}
            >
              {t(reset ? "login" : "reset")}
            </button>
            {sent && (
              <p>
                {lang === "id"
                  ? "Jika akun tersedia, tautan akan dikirim."
                  : "If the account exists, a link will be sent."}
              </p>
            )}
          </form>
        ) : stage === "mfa" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                const r = await api<{ recoveryCodes: string[] }>(
                  "/api/staff/mfa/confirm",
                  { method: "POST", body: { code } },
                );
                setCode("");
                setEnroll(undefined);
                if (r.recoveryCodes.length) {
                  setCodes(r.recoveryCodes);
                  setStage("saved");
                } else finishLogin();
              });
            }}
          >
            {enroll && (
              <>
                <p>{t("enroll")}</p>
                <QRCodeSVG
                  className="mfa-qr"
                  value={enroll.uri}
                  size={256}
                  marginSize={4}
                  level="M"
                  bgColor="#ffffff"
                  fgColor="#000000"
                  role="img"
                  aria-label={t("mfaQr")}
                  title={t("mfaQr")}
                />
                <p>{t("setupKey")}</p>
                <p className="secret">{enroll.secret}</p>
                <a href={enroll.uri}>
                  {lang === "id"
                    ? "Buka aplikasi autentikator"
                    : "Open authenticator app"}
                </a>
              </>
            )}
            <Field
              label={t("authenticator")}
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button disabled={a.busy || resuming}>{t("verify")}</button>
          </form>
        ) : (
          <>
            <p>
              {lang === "id"
                ? "Simpan kode pemulihan satu kali ini di tempat aman."
                : "Save these single-use recovery codes somewhere secure."}
            </p>
            <div className="secret">
              {codes.map((c) => (
                <p key={c}>{c}</p>
              ))}
            </div>
            <button
              onClick={() => {
                setCodes([]);
                finishLogin();
              }}
            >
              {t("saved")}
            </button>
          </>
        )}
      </section>
    </Shell>
  );
}
