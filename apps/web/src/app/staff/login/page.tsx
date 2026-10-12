"use client";
import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api } from "@/lib/api";
import {
  Shell,
  useLanguage,
  useAction,
  Field,
  ErrorBox,
} from "@/components/suite/common";
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
    [sent, setSent] = useState(false);
  return (
    <Shell language={l}>
      <section className="auth-card">
        <p className="eyebrow">{t("staffAccess")}</p>
        <h1>{t("staff")}</h1>
        {stage === "password" && <p className="muted">{t("staffIntro")}</p>}
        <ErrorBox error={a.error} />
        {stage === "password" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
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
                if (!r.mfaEnrolled)
                  setEnroll(
                    await api("/api/staff/mfa/enroll", {
                      method: "POST",
                      body: {},
                    }),
                  );
                setStage("mfa");
              });
            }}
          >
            <Field
              label={t("email")}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            {!reset && (
              <Field
                label={t("password")}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            )}
            <button disabled={a.busy}>{t(reset ? "reset" : "login")}</button>
            <button
              className="secondary"
              type="button"
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
                } else window.location.href = "/staff";
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
            <button disabled={a.busy}>{t("verify")}</button>
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
                window.location.href = "/staff";
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
