"use client";
import { useDraftState, useStaff, DiscardDraft } from "./staff-workspace";
import type { CaseSection } from "./staff-navigation";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  outcomes,
  detrimentRisks,
  rootCauses,
  subjectResponseStatuses,
  type StaffIdentity,
} from "@whistle/shared";
import {
  Check,
  ErrorBox,
  Field,
  Select,
  StatusBadge,
  Text,
  useAction,
  type Lang,
} from "./common";
type Row = Record<string, unknown>;
export type InvestigationCase = {
  id: string;
  caseCode: string;
  state: string;
  category: string;
  severity: string;
  sensitive: boolean;
  detrimentRisk?: string;
  detrimentFlagged?: boolean;
  protectionPlan?: string | null;
  acknowledgedAt?: string | null;
  acknowledgmentDueAt?: string | null;
  nextFollowupDueAt?: string | null;
  content: {
    title: string;
    summary: string;
    relationship?: string;
    details?: Record<string, string>;
  };
  messages: { id: string; author: string; body: string; createdAt: string }[];
  verification: { state: string };
  notes: Row[];
  findings: Row[];
  tasks: Row[];
  detrimentReports?: Row[];
  evidence: Row[];
  hold: boolean;
  closure: Row | null;
  reopenRequests: Row[];
  audit: Row[];
  members: Row[];
};
export function Investigation({
  report: r,
  user,
  t,
  lang,
  reload,
  section,
}: {
  report: InvestigationCase;
  user: StaffIdentity;
  t: (s: string) => string;
  lang: Lang;
  reload: () => Promise<void>;
  section: CaseSection;
}) {
  const { clearDrafts } = useStaff(),
    router = useRouter();
  const prefix = `case.${r.id}.${section || "overview"}.`;
  const a = useAction(lang),
    [body, setBody] = useDraftState(prefix + "body", ""),
    [record, setRecord] = useDraftState(prefix + "record", ""),
    [kind, setKind] = useDraftState(
      prefix + "kind",
      section === "actions" ? "task" : "note",
    ),
    [due, setDue] = useDraftState(prefix + "due", ""),
    [owner, setOwner] = useDraftState(prefix + "owner", ""),
    [people, setPeople] = useState<{ id: string; name: string }[]>([]),
    [reason, setReason] = useDraftState(prefix + "reason", ""),
    [reviewReason, setReviewReason] = useDraftState(
      prefix + "reviewReason",
      "",
    ),
    [holdReason, setHoldReason] = useDraftState(prefix + "holdReason", ""),
    [reopenReason, setReopenReason] = useDraftState(
      prefix + "reopenReason",
      "",
    ),
    [completion, setCompletion] = useDraftState(prefix + "completion", ""),
    [outcome, setOutcome] = useDraftState<string>(
      prefix + "outcome",
      outcomes[0],
    ),
    [rationale, setRationale] = useDraftState(prefix + "rationale", ""),
    [explanation, setExplanation] = useDraftState(prefix + "explanation", ""),
    [rootCause, setRootCause] = useDraftState<string>(
      prefix + "rootCause",
      "not_applicable",
    ),
    [conflictChecked, setConflictChecked] = useState(true),
    [subjectConfidentialityProtected, setSubjectConfidentialityProtected] =
      useState(true),
    [subjectResponseStatus, setSubjectResponseStatus] = useDraftState<string>(
      prefix + "subjectResponseStatus",
      "not_applicable",
    ),
    [subjectResponseRationale, setSubjectResponseRationale] = useDraftState(
      prefix + "subjectResponseRationale",
      "",
    );
  const manager = user.role === "manager";
  const [categories, setCategories] = useState<
      { key: string; en: string; id: string }[]
    >([]),
    [category, setCategory] = useDraftState(prefix + "category", r.category),
    [severity, setSeverity] = useDraftState(prefix + "severity", r.severity),
    [detrimentRisk, setDetrimentRisk] = useDraftState(
      prefix + "detrimentRisk",
      r.detrimentRisk ?? "unassessed",
    ),
    [protectionPlan, setProtectionPlan] = useDraftState(
      prefix + "protectionPlan",
      r.protectionPlan ?? "",
    );
  useEffect(() => {
    if (section !== "") return;
    void api<{ categories: { key: string; en: string; id: string }[] }>(
      "/api/reporter/company",
    )
      .then((c) => setCategories(c.categories))
      .catch(() => {});
  }, [section]);
  useEffect(() => {
    if (section !== "" && section !== "actions") return;
    void api<{ staff: { id: string; name: string }[] }>(
      `/api/cases/${r.id}/people`,
    )
      .then((x) => setPeople(x.staff))
      .catch(() => {});
  }, [r.id, section]);
  async function action(path: string, data: unknown) {
    await api(`/api/cases/${r.id}/${path}`, { method: "POST", body: data });
    const fields: Record<string, string[]> = {
      messages: ["body"],
      records: ["record", "due", "owner", "kind"],
      classification: [
        "category",
        "severity",
        "detrimentRisk",
        "protectionPlan",
      ],
      assign: ["owner"],
      verification: ["reason"],
      closure: [
        "outcome",
        "rationale",
        "explanation",
        "rootCause",
        "subjectResponseStatus",
        "subjectResponseRationale",
      ],
      "closure/review": ["reviewReason"],
      hold: ["holdReason"],
      reopen: ["reopenReason"],
    };
    for (const field of fields[path] ??
      (path.includes("/complete") ? ["completion"] : []))
      clearDrafts(prefix + field);
    await reload();
  }
  return (
    <>
      <ErrorBox error={a.error} />
      <DiscardDraft prefix={prefix} />
      {section === "" && (
        <>
          <section>
            {r.detrimentFlagged && (
              <p>
                <StatusBadge state="overdue">
                  {t("detrimentFlagged")}
                </StatusBadge>
              </p>
            )}
            <p>{r.content.summary}</p>
            {r.content.relationship && (
              <p>
                <strong>{t("relationship")}:</strong>{" "}
                {t(`rel_${r.content.relationship}`)}
              </p>
            )}
            {(r.acknowledgedAt ||
              r.acknowledgmentDueAt ||
              r.nextFollowupDueAt) && (
              <p className="muted">
                {r.acknowledgedAt
                  ? `${t("acknowledgedOn")}: ${new Date(r.acknowledgedAt).toLocaleDateString(lang)}`
                  : r.acknowledgmentDueAt
                    ? `${t("acknowledgmentDue")}: ${new Date(r.acknowledgmentDueAt).toLocaleDateString(lang)}`
                    : null}
                {r.nextFollowupDueAt
                  ? ` · ${t("nextFollowupDue")}: ${new Date(r.nextFollowupDueAt).toLocaleDateString(lang)}`
                  : null}
              </p>
            )}
            {Object.entries(r.content.details ?? {})
              .filter(([, v]) => v)
              .map(([key, value]) => (
                <p key={key}>
                  <strong>{t(key)}:</strong> {value}
                </p>
              ))}
            {!r.acknowledgedAt && r.state !== "closed" && (
              <button
                disabled={a.busy}
                onClick={() => void a.run(() => action("acknowledge", {}))}
              >
                {t("acknowledgeReceipt")}
              </button>
            )}
            <button
              disabled={a.busy}
              onClick={() =>
                void a.run(async () => {
                  await api(`/api/cases/${r.id}/recuse`, {
                    method: "POST",
                    body: {},
                  });
                  clearDrafts(`case.${r.id}.`);
                  router.push("/staff/cases");
                })
              }
            >
              {t("recuse")}
            </button>
            {(
              {
                received: ["triage"],
                triage: ["investigating"],
                investigating: ["waiting_reporter"],
                waiting_reporter: ["investigating"],
              } as Record<string, string[]>
            )[r.state]?.map((state) => (
              <button
                key={state}
                disabled={a.busy}
                onClick={() => void a.run(() => action("state", { state }))}
              >
                {t(state)}
              </button>
            ))}
            {!manager && (
              <Check
                label={
                  lang === "id"
                    ? "Terima pemberitahuan kasus ini"
                    : "Receive alerts for this case"
                }
                checked={
                  r.members.find((m) => m.staff_id === user.id)?.subscribed !==
                  false
                }
                onChange={(e) =>
                  void a.run(() =>
                    action("subscription", { subscribed: e.target.checked }),
                  )
                }
              />
            )}
            {manager && (
              <p>
                {lang === "id"
                  ? "Manajer menerima pengingat untuk seluruh timnya."
                  : "Managers receive reminders for their entire team."}
              </p>
            )}
            {manager && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void a.run(() =>
                    action("assign", { staffId: owner, owner: true }),
                  );
                }}
              >
                <Select
                  label={t("assign")}
                  required
                  value={owner}
                  onChange={(e) => setOwner(e.target.value)}
                >
                  <option value="">—</option>
                  {people.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <button disabled={a.busy}>{t("owner")}</button>
              </form>
            )}
          </section>
          {(r.detrimentReports?.length ?? 0) > 0 && (
            <section>
              <h2>{t("detrimentReports")}</h2>
              {(r.detrimentReports ?? []).map((d) => (
                <article key={String(d.id)}>
                  <small>
                    {new Date(String(d.created_at)).toLocaleString(lang)}
                  </small>
                  <p>{String((d.body as Row)?.text ?? "")}</p>
                </article>
              ))}
            </section>
          )}
        </>
      )}
      {section === "" && (
        <>
          {r.state !== "closed" && (
            <section>
              <h2>{lang === "id" ? "Penilaian awal" : "Triage assessment"}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void a.run(() =>
                    action("classification", {
                      category,
                      severity,
                      detrimentRisk,
                      protectionPlan,
                    }),
                  );
                }}
              >
                <Select
                  label={t("category")}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c[lang]}
                    </option>
                  ))}
                </Select>
                <Select
                  label={t("severity")}
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value)}
                >
                  {["normal", "high", "critical"].map((s) => (
                    <option key={s} value={s}>
                      {t(s)}
                    </option>
                  ))}
                </Select>
                <Select
                  label={t("detrimentRisk")}
                  value={detrimentRisk}
                  onChange={(e) => setDetrimentRisk(e.target.value)}
                >
                  {detrimentRisks.map((dr) => (
                    <option key={dr} value={dr}>
                      {t(`risk_${dr}`)}
                    </option>
                  ))}
                </Select>
                <Text
                  label={t("protectionPlan")}
                  maxLength={4000}
                  value={protectionPlan}
                  onChange={(e) => setProtectionPlan(e.target.value)}
                />
                <button disabled={a.busy}>{t("save")}</button>
              </form>
              {manager && !r.sensitive && (
                <>
                  <Text
                    label={t("reason")}
                    minLength={10}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button
                    disabled={a.busy || reason.length < 10}
                    onClick={() =>
                      void a.run(async () => {
                        await api(`/api/cases/${r.id}/escalate`, {
                          method: "POST",
                          body: { reason },
                        });
                        clearDrafts(`case.${r.id}.`);
                        router.push("/staff/cases");
                      })
                    }
                  >
                    {lang === "id"
                      ? "Eskalasi ke tim independen"
                      : "Escalate to independent team"}
                  </button>
                </>
              )}
            </section>
          )}
        </>
      )}
      {section === "messages" && (
        <>
          <section>
            <h2>{t("messages")}</h2>
            {r.messages.map((m) => (
              <article key={m.id}>
                <small>
                  {t(m.author === "reporter" ? "body" : "staff")} ·{" "}
                  {new Date(m.createdAt).toLocaleString(lang)}
                </small>
                <p>{m.body}</p>
              </article>
            ))}
            {r.state !== "closed" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void a.run(async () => {
                    await action("messages", { body });
                    setBody("");
                  });
                }}
              >
                <Text
                  label={t("body")}
                  required
                  maxLength={10000}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                />
                <button disabled={a.busy}>{t("send")}</button>
              </form>
            )}
          </section>
        </>
      )}
      {section === "evidence" && (
        <>
          <section>
            <h2>{t("files")}</h2>
            {!r.evidence.length && <p>{t("noEvidence")}</p>}
            {r.evidence.map((e) => (
              <p key={String(e.id)}>
                <a
                  href={`/api/cases/${r.id}/evidence/${e.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("files")} · {String(e.mime)}
                </a>
              </p>
            ))}
          </section>
        </>
      )}
      {(section === "investigation" || section === "actions") && (
        <>
          <section>
            {section === "actions" && r.state !== "closed" && (
              <Text
                label={
                  lang === "id"
                    ? "Bukti penyelesaian tindakan"
                    : "Evidence of corrective action completion"
                }
                minLength={10}
                value={completion}
                onChange={(e) => setCompletion(e.target.value)}
              />
            )}
            {(section === "actions"
              ? (["tasks"] as const)
              : (["notes", "findings"] as const)
            ).map((k) => (
              <div key={k}>
                <h2>{t(k)}</h2>
                {r[k].map((x) => (
                  <article key={String(x.id)}>
                    <p>{String((x.body as Row)?.text ?? "")}</p>
                    {!!x.due_at && (
                      <p>
                        {t("due")}:{" "}
                        {new Date(String(x.due_at)).toLocaleString(lang)}
                      </p>
                    )}
                    {k === "tasks" &&
                      !x.completed_at &&
                      r.state !== "closed" && (
                        <button
                          disabled={a.busy || completion.length < 10}
                          onClick={() =>
                            void a.run(() =>
                              action(`tasks/${x.id}/complete`, {
                                completionEvidence: completion,
                              }),
                            )
                          }
                        >
                          {t("complete")}
                        </button>
                      )}
                  </article>
                ))}
              </div>
            ))}
            {r.state !== "closed" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void a.run(async () => {
                    await action("records", {
                      kind,
                      body: record,
                      ownerId: owner || user.id,
                      dueAt: due ? new Date(due).toISOString() : null,
                    });
                    setRecord("");
                    setDue("");
                  });
                }}
              >
                {section === "investigation" && (
                  <Select
                    label={t("add")}
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="note">{t("notes")}</option>
                    <option value="finding">{t("findings")}</option>
                  </Select>
                )}
                <Text
                  label={t(
                    kind === "task"
                      ? "tasks"
                      : kind === "finding"
                        ? "findings"
                        : "notes",
                  )}
                  required
                  value={record}
                  onChange={(e) => setRecord(e.target.value)}
                />
                {kind === "task" && (
                  <Select
                    label={t("owner")}
                    value={owner || user.id}
                    onChange={(e) => setOwner(e.target.value)}
                  >
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                )}
                {kind === "task" && (
                  <Field
                    label={t("due")}
                    type="datetime-local"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                  />
                )}
                <button disabled={a.busy}>{t("save")}</button>
              </form>
            )}
          </section>
        </>
      )}
      {section === "messages" && (
        <>
          {r.state !== "closed" && (
            <section>
              <h2>{t("requestVerification")}</h2>
              <p>{t("verifyMeaning")}</p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void a.run(() => action("verification", { reason }));
                }}
              >
                <Text
                  label={t("reason")}
                  required
                  minLength={10}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button disabled={a.busy}>{t("requestVerification")}</button>
              </form>
            </section>
          )}
        </>
      )}
      {section === "closure" && (
        <>
          {["triage", "investigating", "waiting_reporter"].includes(
            r.state,
          ) && (
            <section>
              <h2>{t("closure")}</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void a.run(() =>
                    action("closure", {
                      outcome,
                      rationale,
                      publicExplanation: explanation,
                      rootCause,
                      ...(subjectResponseStatus !== "not_applicable" ||
                      subjectResponseRationale.trim().length > 0
                        ? {
                            proceduralFairness: {
                              conflictChecked,
                              subjectConfidentialityProtected,
                              subjectResponseStatus,
                              subjectResponseRationale,
                            },
                          }
                        : {}),
                    }),
                  );
                }}
              >
                <Select
                  label={t("outcome")}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                >
                  {outcomes.map((o) => (
                    <option key={o} value={o}>
                      {t(o)}
                    </option>
                  ))}
                </Select>
                <Select
                  label={t("rootCause")}
                  value={rootCause}
                  onChange={(e) => setRootCause(e.target.value)}
                >
                  {rootCauses.map((rc) => (
                    <option key={rc} value={rc}>
                      {t(`rc_${rc}`)}
                    </option>
                  ))}
                </Select>
                <Text
                  label={t("rationale")}
                  minLength={20}
                  required
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                />
                <Text
                  label={t("explanation")}
                  minLength={20}
                  required
                  value={explanation}
                  onChange={(e) => setExplanation(e.target.value)}
                />
                <fieldset>
                  <legend>{t("proceduralFairness")}</legend>
                  <Check
                    label={t("conflictChecked")}
                    checked={conflictChecked}
                    onChange={(e) => setConflictChecked(e.target.checked)}
                  />
                  <Check
                    label={t("subjectConfidentialityProtected")}
                    checked={subjectConfidentialityProtected}
                    onChange={(e) =>
                      setSubjectConfidentialityProtected(e.target.checked)
                    }
                  />
                  <Select
                    label={t("subjectResponseStatus")}
                    value={subjectResponseStatus}
                    onChange={(e) => setSubjectResponseStatus(e.target.value)}
                  >
                    {subjectResponseStatuses.map((srs) => (
                      <option key={srs} value={srs}>
                        {t(`srs_${srs}`)}
                      </option>
                    ))}
                  </Select>
                  <Text
                    label={t("subjectResponseRationale")}
                    maxLength={4000}
                    value={subjectResponseRationale}
                    onChange={(e) =>
                      setSubjectResponseRationale(e.target.value)
                    }
                  />
                </fieldset>
                <button
                  disabled={
                    a.busy ||
                    !conflictChecked ||
                    !subjectConfidentialityProtected
                  }
                >
                  {t("closure")}
                </button>
              </form>
            </section>
          )}
        </>
      )}
      {section === "closure" && (
        <>
          {r.state === "closure_review" && r.closure && (
            <section>
              <h2>{t("reviewClosure")}</h2>
              <p>{t(String(r.closure.outcome))}</p>
              {!!r.closure.rootCause && (
                <p>
                  <strong>{t("rootCause")}:</strong>{" "}
                  {t(`rc_${String(r.closure.rootCause)}`)}
                </p>
              )}
              <p>{String(r.closure.rationale)}</p>
              <p>{String(r.closure.publicExplanation)}</p>
              {manager && r.closure.requestedBy !== user.id && (
                <>
                  <Text
                    label={t("reason")}
                    minLength={10}
                    value={reviewReason}
                    onChange={(e) => setReviewReason(e.target.value)}
                  />
                  <button
                    disabled={a.busy || reviewReason.length < 10}
                    onClick={() =>
                      void a.run(() =>
                        action("closure/review", {
                          approve: true,
                          reason: reviewReason,
                        }),
                      )
                    }
                  >
                    {t("accept")}
                  </button>
                  <button
                    disabled={a.busy || reviewReason.length < 10}
                    onClick={() =>
                      void a.run(() =>
                        action("closure/review", {
                          approve: false,
                          reason: reviewReason,
                        }),
                      )
                    }
                  >
                    {t("reject")}
                  </button>
                </>
              )}
            </section>
          )}
        </>
      )}
      {section === "closure" && (
        <>
          {manager && (
            <section>
              <h2>{t("hold")}</h2>
              <Text
                label={t("reason")}
                minLength={10}
                value={holdReason}
                onChange={(e) => setHoldReason(e.target.value)}
              />
              <Check
                label={t("hold")}
                checked={r.hold}
                disabled={a.busy || holdReason.length < 10}
                onChange={(e) =>
                  void a.run(() =>
                    action("hold", {
                      hold: e.target.checked,
                      reason: holdReason,
                    }),
                  )
                }
              />
              {r.state === "closed" && (
                <>
                  <h3>{t("reopen")}</h3>
                  <Text
                    label={t("reason")}
                    minLength={10}
                    value={reopenReason}
                    onChange={(e) => setReopenReason(e.target.value)}
                  />
                  {r.reopenRequests.map((x) => (
                    <p key={String(x.id)}>
                      {String((x.body as Row)?.reason ?? "")}
                    </p>
                  ))}
                  <button
                    disabled={a.busy || reopenReason.length < 10}
                    onClick={() =>
                      void a.run(() =>
                        action("reopen", { reason: reopenReason }),
                      )
                    }
                  >
                    {t("reopen")}
                  </button>
                </>
              )}
            </section>
          )}
        </>
      )}
      {section === "history" && (
        <>
          <section>
            <h2>{t("audit")}</h2>
            {r.audit.slice(0, 25).map((x) => (
              <p key={String(x.id)}>
                {String(x.action).replaceAll("_", " ")} ·{" "}
                {new Date(String(x.created_at)).toLocaleString(lang)}
              </p>
            ))}
          </section>
        </>
      )}
    </>
  );
}
