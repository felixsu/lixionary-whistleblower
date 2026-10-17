"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import {
  Shell,
  StatusBadge,
  useLanguage,
  useAction,
  Field,
  Text,
  Check,
  Select,
  ErrorBox,
  Receipt,
  privateApi,
  usePoll,
} from "@/components/suite/common";
import { CaseConversation } from "@/components/suite/case-conversation";
import { Evidence } from "@/components/suite/evidence";
type Case = {
  caseCode: string;
  state: string;
  content: { title: string; summary: string; details?: Record<string, string> };
  acknowledgedAt?: string | null;
  acknowledgmentDueAt?: string | null;
  nextFollowupDueAt?: string | null;
  feedback?: {
    trust: number;
    communication: number;
    protection: number;
    submittedAt?: string;
  } | null;
  detrimentReports?: {
    id: string;
    body: { text?: string };
    created_at: string;
  }[];
  messages: { id: string; author: string; body: string; createdAt: string }[];
  verification: { state: string };
  verificationRequests: { id: string; state: string; reason: string }[];
  publicOutcome: string | null;
};
type Contact = {
  id: string;
  kind: string;
  destination: string;
  verifiedAt: string | null;
  notifications: boolean;
};
export default function Portal() {
  const l = useLanguage(),
    { t, lang } = l,
    a = useAction(lang);
  const [report, setReport] = useState<Case>(),
    [login, setLogin] = useState(true),
    [caseCode, setCaseCode] = useState(""),
    [pin, setPin] = useState(""),
    [recovery, setRecovery] = useState(false),
    [receipt, setReceipt] = useState<{
      caseCode: string;
      pin: string;
      recoveryCode: string;
    }>(),
    [body, setBody] = useState(""),
    [review, setReview] = useState(false),
    [detrimentBody, setDetrimentBody] = useState(""),
    [detrimentReview, setDetrimentReview] = useState(false),
    [fbTrust, setFbTrust] = useState(5),
    [fbCommunication, setFbCommunication] = useState(5),
    [fbProtection, setFbProtection] = useState(5);
  const [contacts, setContacts] = useState<Contact[]>([]),
    [kind, setKind] = useState("email"),
    [destination, setDestination] = useState(""),
    [notify, setNotify] = useState(false),
    [challenge, setChallenge] = useState(""),
    [code, setCode] = useState(""),
    [requestId, setRequestId] = useState("");
  const load = useCallback(async () => {
    const c = await api<Case>("/api/reporter/case");
    setReport(c);
    setLogin(false);
    try {
      setContacts(
        (await privateApi<{ contacts: Contact[] }>("/contacts")).contacts,
      );
    } catch {}
  }, []);
  useEffect(() => {
    void load().catch(() => setLogin(true));
  }, [load]);
  usePoll(
    useCallback(async () => {
      if (!login) await load();
    }, [login, load]),
  );
  return (
    <Shell language={l}>
      <ErrorBox error={a.error} />
      {receipt ? (
        <Receipt
          t={t}
          receipt={{ ...receipt, recoverySecret: receipt.recoveryCode }}
          onDone={() => {
            setReceipt(undefined);
            void load();
          }}
        />
      ) : login ? (
        <section className="auth-card">
          <h1>{t("portal")}</h1>
          <p className="muted">{t("caseIntro")}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(async () => {
                if (recovery)
                  setReceipt(
                    await api("/api/reporter/recover", {
                      method: "POST",
                      body: { caseCode, recoveryCode: pin },
                    }),
                  );
                else
                  await api("/api/reporter/session", {
                    method: "POST",
                    body: { caseCode, pin },
                  });
                setPin("");
                await load();
              });
            }}
          >
            <Field
              label={t("caseCode")}
              required
              value={caseCode}
              placeholder="WB-1234-5678"
              autoComplete="off"
              onChange={(e) => setCaseCode(e.target.value.toUpperCase())}
            />
            <Field
              label={t(recovery ? "recovery" : "pin")}
              required
              type="password"
              autoComplete="off"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            <button disabled={a.busy}>{t("portal")}</button>
            <Check
              label={t("recover")}
              checked={recovery}
              onChange={(e) => {
                setRecovery(e.target.checked);
                setPin("");
              }}
            />
          </form>
        </section>
      ) : report ? (
        <>
          <section>
            <h1>{report.caseCode}</h1>
            <StatusBadge state={report.state}>{t(report.state)}</StatusBadge>
            <StatusBadge state={report.verification.state}>
              {t(report.verification.state)}
            </StatusBadge>
            <h2>{report.content.title}</h2>
            <p>{report.content.summary}</p>
            {Object.entries(report.content.details ?? {})
              .filter(([, v]) => v)
              .map(([key, value]) => (
                <p key={key}>
                  <strong>{t(key)}:</strong> {value}
                </p>
              ))}
            <p className="muted">
              {report.acknowledgedAt
                ? `${t("acknowledgedOn")}: ${new Date(report.acknowledgedAt).toLocaleDateString(lang)}`
                : report.acknowledgmentDueAt
                  ? `${t("acknowledgmentDue")}: ${new Date(report.acknowledgmentDueAt).toLocaleDateString(lang)}`
                  : null}
              {report.nextFollowupDueAt
                ? ` · ${t("nextFollowupDue")}: ${new Date(report.nextFollowupDueAt).toLocaleDateString(lang)}`
                : null}
            </p>
            {report.publicOutcome && <p>{report.publicOutcome}</p>}
            <button
              onClick={() =>
                void a.run(async () => {
                  await api("/api/reporter/session", { method: "DELETE" });
                  setReport(undefined);
                  setContacts([]);
                  setLogin(true);
                  setReceipt(undefined);
                  setBody("");
                  setCaseCode("");
                  setPin("");
                  setDestination("");
                  setChallenge("");
                  setCode("");
                  setRequestId("");
                  setReview(false);
                  window.location.replace("/");
                })
              }
            >
              {t("signout")}
            </button>
            <button
              onClick={() =>
                void a.run(async () =>
                  setReceipt(
                    await api("/api/reporter/rotate", {
                      method: "POST",
                      body: {},
                    }),
                  ),
                )
              }
            >
              {t("rotate")}
            </button>
          </section>
          <CaseConversation
            key={report.caseCode}
            t={t}
            lang={lang}
            closed={report.state === "closed"}
            onShared={load}
          />
          <section>
            <h2>{t("investigatorMessages")}</h2>
            <div aria-live="polite">
              {report.messages.map((m) => (
                <article key={m.id}>
                  <small>
                    {m.author === "staff" ? t("staff") : t("body")} ·{" "}
                    {new Date(m.createdAt).toLocaleString(lang)}
                  </small>
                  <p>{m.body}</p>
                </article>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void a.run(async () => {
                  await api(
                    report.state === "closed"
                      ? "/api/reporter/reopen"
                      : "/api/reporter/messages",
                    {
                      method: "POST",
                      body:
                        report.state === "closed"
                          ? { reason: body }
                          : { body, privacyReviewed: true },
                    },
                  );
                  setBody("");
                  setReview(false);
                  await load();
                });
              }}
            >
              <Text
                label={t(report.state === "closed" ? "reason" : "body")}
                required
                minLength={report.state === "closed" ? 10 : 1}
                value={body}
                onChange={(e) => {
                  setBody(e.target.value);
                  setReview(false);
                }}
              />
              <Check
                label={t("review")}
                required
                checked={review}
                onChange={(e) => setReview(e.target.checked)}
              />
              <button disabled={a.busy || !review}>
                {t(report.state === "closed" ? "reopen" : "send")}
              </button>
            </form>
          </section>
          <section>
            <h2>{t("detrimentHeading")}</h2>
            <p className="muted">{t("detrimentNotice")}</p>
            {(report.detrimentReports ?? []).map((d) => (
              <article key={d.id}>
                <small>{new Date(d.created_at).toLocaleString(lang)}</small>
                <p>{d.body?.text}</p>
              </article>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void a.run(async () => {
                  await api("/api/reporter/detriment", {
                    method: "POST",
                    body: { body: detrimentBody, privacyReviewed: true },
                  });
                  setDetrimentBody("");
                  setDetrimentReview(false);
                  await load();
                });
              }}
            >
              <Text
                label={t("detrimentHeading")}
                required
                minLength={10}
                maxLength={10000}
                value={detrimentBody}
                onChange={(e) => {
                  setDetrimentBody(e.target.value);
                  setDetrimentReview(false);
                }}
              />
              <Check
                label={t("review")}
                required
                checked={detrimentReview}
                onChange={(e) => setDetrimentReview(e.target.checked)}
              />
              <button disabled={a.busy || !detrimentReview}>
                {t("submitDetriment")}
              </button>
            </form>
          </section>
          {report.state === "closed" && (
            <section>
              <h2>{t("feedbackHeading")}</h2>
              {report.feedback ? (
                <p role="status">{t("feedbackSubmitted")}</p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void a.run(async () => {
                      await api("/api/reporter/feedback", {
                        method: "POST",
                        body: {
                          trust: fbTrust,
                          communication: fbCommunication,
                          protection: fbProtection,
                        },
                      });
                      await load();
                    });
                  }}
                >
                  <Select
                    label={t("feedbackTrust")}
                    value={String(fbTrust)}
                    onChange={(e) => setFbTrust(Number(e.target.value))}
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label={t("feedbackCommunication")}
                    value={String(fbCommunication)}
                    onChange={(e) => setFbCommunication(Number(e.target.value))}
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                  <Select
                    label={t("feedbackProtection")}
                    value={String(fbProtection)}
                    onChange={(e) => setFbProtection(Number(e.target.value))}
                  >
                    {[5, 4, 3, 2, 1].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                  <button disabled={a.busy}>{t("submitFeedback")}</button>
                </form>
              )}
            </section>
          )}
          <section>
            <h2>{t("contacts")}</h2>
            <p>{t("verifyMeaning")}</p>
            {report.verificationRequests
              .filter((r) => r.state === "pending")
              .map((r) => (
                <article key={r.id}>
                  <p>{r.reason}</p>
                  <button onClick={() => setRequestId(r.id)}>
                    {t("verify")}
                  </button>
                  <button
                    onClick={() =>
                      void a.run(async () => {
                        await api(
                          `/api/reporter/verification/${r.id}/decline`,
                          { method: "POST", body: {} },
                        );
                        await load();
                      })
                    }
                  >
                    {lang === "id" ? "Tolak permintaan" : "Decline request"}
                  </button>
                </article>
              ))}
            {contacts.map((c) => (
              <article key={c.id}>
                <p>
                  {c.destination} · {c.verifiedAt ? t("verified") : t("none")}
                </p>
                <Check
                  label={t("notifications")}
                  checked={c.notifications}
                  onChange={(e) =>
                    void a.run(async () => {
                      await privateApi(`/contacts/${c.id}`, {
                        method: "PATCH",
                        body: { notifications: e.target.checked },
                      });
                      await load();
                    })
                  }
                />
                <button
                  onClick={() =>
                    void a.run(async () => {
                      await privateApi(`/contacts/${c.id}`, {
                        method: "DELETE",
                      });
                      await load();
                    })
                  }
                >
                  {t("delete")}
                </button>
              </article>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void a.run(async () => {
                  const r = await privateApi<{ challengeId: string }>(
                    "/contacts/challenge",
                    {
                      method: "POST",
                      body: {
                        kind,
                        destination,
                        notifications: notify,
                        locale: lang,
                      },
                    },
                  );
                  setChallenge(r.challengeId);
                  setCode("");
                  await load();
                });
              }}
            >
              <Select
                label={t("contacts")}
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value);
                  setDestination("");
                }}
              >
                <option value="email">Email</option>
                <option value="phone">
                  {lang === "id" ? "Telepon" : "Phone"}
                </option>
              </Select>
              <Field
                label={t("destination")}
                type={kind === "email" ? "email" : "tel"}
                required
                autoComplete="off"
                placeholder={
                  kind === "email" ? "you@example.com" : "+628123456789"
                }
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
              />
              <Check
                label={t("notifications")}
                checked={notify}
                onChange={(e) => setNotify(e.target.checked)}
              />
              <button disabled={a.busy}>{t("otp")}</button>
            </form>
            {challenge && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void a.run(async () => {
                    await privateApi("/contacts/verify", {
                      method: "POST",
                      body: {
                        challengeId: challenge,
                        code,
                        requestId: requestId || null,
                      },
                    });
                    setChallenge("");
                    setCode("");
                    setDestination("");
                    await load();
                  });
                }}
              >
                <Field
                  label={t("code")}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  required
                  pattern="[0-9]{6}"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
                <button disabled={a.busy}>{t("verify")}</button>
              </form>
            )}
          </section>
          <Evidence t={t} lang={lang} closed={report.state === "closed"} />
        </>
      ) : (
        <p>{t("loading")}</p>
      )}
    </Shell>
  );
}
