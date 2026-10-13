"use client";
import { useEffect, useState, useRef } from "react";
import { ReportGate } from "@/components/suite/report-gate";
import { api, ApiError } from "@/lib/api";
import {
  Shell,
  useLanguage,
  useAction,
  Field,
  Text,
  Check,
  Select,
  ErrorBox,
  Receipt,
} from "@/components/suite/common";
import type { CompanySettings } from "@whistle/shared";
type Company = Pick<
  CompanySettings,
  | "companyName"
  | "policy"
  | "privacyNotice"
  | "categories"
  | "businessUnits"
  | "aiEnabled"
> & { version: number };
export default function Report() {
  const l = useLanguage(),
    { t, lang } = l,
    a = useAction(lang);
  const [company, setCompany] = useState<Company>(),
    [receipt, setReceipt] = useState<{
      caseCode: string;
      pin: string;
      recoveryCode: string;
    }>();
  const [reportToken, setReportToken] = useState(""),
    [gateOpen, setGateOpen] = useState(true);
  const reportApi = async <T,>(
    path: string,
    options: Parameters<typeof api>[1] = {},
  ) => {
    try {
      return await api<T>(path, {
        ...options,
        headers: { ...options.headers, "x-report-access": reportToken },
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "report_access_required")
        setGateOpen(true);
      throw e;
    }
  };
  const submission = useRef<{
    pin: string;
    recoveryCode: string;
    submissionToken: string;
  } | null>(null);
  const newSecret = () =>
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [title, setTitle] = useState(""),
    [summary, setSummary] = useState(""),
    [category, setCategory] = useState("other"),
    [unit, setUnit] = useState(""),
    [sensitive, setSensitive] = useState(false),
    [review, setReview] = useState(false),
    [policy, setPolicy] = useState(false);
  const [aiConsent, setAiConsent] = useState(false),
    [intake, setIntake] = useState<{ id: string; token: string }>(),
    [chat, setChat] = useState<{ role: string; body: string }[]>([]),
    [answer, setAnswer] = useState("");
  useEffect(() => {
    void api<Company>("/api/reporter/company")
      .then((c) => {
        setCompany(c);
        setCategory(c.categories[0]!.key);
      })
      .catch((e) => a.setError(String(e)));
  }, []);
  const aiCall = <T,>(path: string, body?: unknown) =>
    reportApi<T>(`/privacy/intake/${intake!.id}/${path}`, {
      method: "POST",
      body,
      headers: { Authorization: `Bearer ${intake!.token}` },
    });
  return (
    <Shell language={l}>
      <ErrorBox error={a.error} />
      {gateOpen && !receipt && (
        <ReportGate
          lang={lang}
          resumeToken={reportToken || undefined}
          onVerified={(raw) => {
            setReportToken(raw);
            setGateOpen(false);
            a.setError("");
          }}
          onCancel={() => setGateOpen(false)}
        />
      )}
      {!reportToken && !receipt && (
        <section>
          <h1>{t("report")}</h1>
          <p>
            {lang === "id"
              ? "Verifikasi email karyawan Anda untuk memulai."
              : "Verify your employee email to begin."}
          </p>
          <button onClick={() => setGateOpen(true)}>
            {lang === "id" ? "Verifikasi email" : "Verify email"}
          </button>
        </section>
      )}
      {receipt ? (
        <Receipt
          receipt={{ ...receipt, recoverySecret: receipt.recoveryCode }}
          t={t}
          onDone={() => {
            setReceipt(undefined);
            window.location.href = "/case";
          }}
        />
      ) : company && reportToken ? (
        <>
          <h1>{t("report")}</h1>
          <section>
            <h2>{company.companyName}</h2>
            <details open>
              <summary>{t("policy")}</summary>
              <p>{company.policy[lang]}</p>
            </details>
            <details open>
              <summary>{t("notice")}</summary>
              <p>{company.privacyNotice[lang]}</p>
            </details>
            <Check
              label={
                lang === "id"
                  ? "Saya telah membaca kebijakan dan pemberitahuan privasi."
                  : "I have read the policy and privacy notice."
              }
              checked={policy}
              onChange={(e) => setPolicy(e.target.checked)}
            />
          </section>
          {company.aiEnabled && (
            <section>
              <h2>{t("ai")}</h2>
              {!intake ? (
                <>
                  <Check
                    label={t("aiConsent")}
                    checked={aiConsent}
                    onChange={(e) => setAiConsent(e.target.checked)}
                  />
                  <button
                    disabled={!aiConsent || a.busy || !policy}
                    onClick={() =>
                      void a.run(async () => {
                        setIntake(
                          await reportApi("/privacy/intake", {
                            method: "POST",
                            body: {
                              consent: true,
                              policyVersion: company.version,
                              locale: lang,
                            },
                          }),
                        );
                      })
                    }
                  >
                    {t("ai")}
                  </button>
                </>
              ) : (
                <>
                  <div aria-live="polite">
                    {chat.map((m, i) => (
                      <p key={i}>
                        <strong>{m.role === "user" ? t("body") : "AI"}:</strong>{" "}
                        {m.body}
                      </p>
                    ))}
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void a.run(async () => {
                        const { answer: reply } = await aiCall<{
                          answer: string;
                        }>("messages", { body: answer });
                        setChat([
                          ...chat,
                          { role: "user", body: answer },
                          { role: "assistant", body: reply },
                        ]);
                        setAnswer("");
                      });
                    }}
                  >
                    <Text
                      label={t("body")}
                      required
                      maxLength={5000}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                    />
                    <button disabled={a.busy}>{t("send")}</button>
                  </form>
                  <button
                    disabled={a.busy || !chat.length}
                    onClick={() =>
                      void a.run(async () => {
                        const r = await aiCall<{
                          draft: {
                            title: string;
                            summary: string;
                            category: string | null;
                            details: Record<string, string>;
                          };
                        }>("draft", {});
                        setTitle(r.draft.title);
                        setSummary(r.draft.summary);
                        setDetails(r.draft.details ?? {});
                        if (
                          company.categories.some(
                            (c) => c.key === r.draft.category,
                          )
                        )
                          setCategory(r.draft.category!);
                        setReview(false);
                      })
                    }
                  >
                    {t("draft")}
                  </button>
                  <button
                    disabled={a.busy}
                    onClick={() =>
                      void a.run(async () => {
                        await reportApi(`/privacy/intake/${intake.id}`, {
                          method: "DELETE",
                          headers: { Authorization: `Bearer ${intake.token}` },
                        });
                        setIntake(undefined);
                        setChat([]);
                        setAiConsent(false);
                      })
                    }
                  >
                    {t("withdraw")}
                  </button>
                </>
              )}
            </section>
          )}
          <section>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void a.run(async () => {
                  submission.current ??= {
                    pin: newSecret(),
                    recoveryCode: newSecret(),
                    submissionToken: newSecret(),
                  };
                  const r = await reportApi<{
                    caseCode: string;
                    pin: string;
                    recoveryCode: string;
                  }>("/api/reporter/reports", {
                    method: "POST",
                    body: {
                      submission: submission.current,
                      title,
                      summary,
                      category,
                      businessUnit: unit,
                      sensitive,
                      details,
                      locale: lang,
                      privacyReviewed: true,
                      policyVersion: company.version,
                      ...(intake
                        ? { intakeId: intake.id, intakeToken: intake.token }
                        : {}),
                    },
                  }).catch(async (e) => {
                    if (e instanceof ApiError && e.code === "policy_changed") {
                      const current = await api<Company>(
                        "/api/reporter/company",
                      );
                      setCompany(current);
                      if (!current.categories.some((c) => c.key === category))
                        setCategory(current.categories[0]!.key);
                      if (unit && !current.businessUnits.includes(unit))
                        setUnit("");
                      setPolicy(false);
                      setReview(false);
                    }
                    throw e;
                  });
                  setReceipt(r);
                  setReportToken("");
                  setGateOpen(false);
                  submission.current = null;
                  setTitle("");
                  setSummary("");
                  setDetails({});
                  setAnswer("");
                  setReview(false);
                  setPolicy(false);
                  setAiConsent(false);
                  setChat([]);
                  setIntake(undefined);
                });
              }}
            >
              <Field
                label={t("title")}
                required
                minLength={5}
                maxLength={200}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setReview(false);
                }}
              />
              <Text
                label={t("summary")}
                required
                minLength={20}
                maxLength={10000}
                value={summary}
                onChange={(e) => {
                  setSummary(e.target.value);
                  setReview(false);
                }}
              />
              <details open={Object.values(details).some(Boolean)}>
                <summary>
                  {lang === "id"
                    ? "Detail tambahan (opsional)"
                    : "Additional details (optional)"}
                </summary>
                {[
                  "what",
                  "who",
                  "when",
                  "where",
                  "howKnown",
                  "evidence",
                  "impact",
                  "ongoing",
                ].map((key) => (
                  <Text
                    key={key}
                    label={t(key)}
                    maxLength={5000}
                    value={details[key] ?? ""}
                    onChange={(e) => {
                      setDetails({ ...details, [key]: e.target.value });
                      setReview(false);
                    }}
                  />
                ))}
              </details>
              <Select
                label={t("category")}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {company.categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c[lang]}
                  </option>
                ))}
              </Select>
              {company.businessUnits.length > 0 && (
                <Select
                  label={t("businessUnit")}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  <option value="">—</option>
                  {company.businessUnits.map((u) => (
                    <option key={u}>{u}</option>
                  ))}
                </Select>
              )}
              <Check
                label={t("sensitive")}
                checked={sensitive}
                onChange={(e) => setSensitive(e.target.checked)}
              />
              <p>{t("privacy")}</p>
              <Check
                label={t("review")}
                required
                checked={review}
                onChange={(e) => setReview(e.target.checked)}
              />
              <button disabled={a.busy || !review || !policy}>
                {t("submit")}
              </button>
            </form>
          </section>
        </>
      ) : !company ? (
        <p>{t("loading")}</p>
      ) : null}
    </Shell>
  );
}
