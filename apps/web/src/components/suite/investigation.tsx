"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { outcomes, type StaffIdentity } from "@whistle/shared";
import {
  Check,
  ErrorBox,
  Field,
  Select,
  Text,
  useAction,
  StatusBadge,
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
  content: { title: string; summary: string; details?: Record<string, string> };
  messages: { id: string; author: string; body: string; createdAt: string }[];
  verification: { state: string };
  notes: Row[];
  findings: Row[];
  tasks: Row[];
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
}: {
  report: InvestigationCase;
  user: StaffIdentity;
  t: (s: string) => string;
  lang: Lang;
  reload: () => Promise<void>;
}) {
  const a = useAction(lang),
    [body, setBody] = useState(""),
    [record, setRecord] = useState(""),
    [kind, setKind] = useState("note"),
    [due, setDue] = useState(""),
    [owner, setOwner] = useState(""),
    [people, setPeople] = useState<{ id: string; name: string }[]>([]),
    [reason, setReason] = useState(""),
    [completion, setCompletion] = useState(""),
    [outcome, setOutcome] = useState<string>(outcomes[0]),
    [rationale, setRationale] = useState(""),
    [explanation, setExplanation] = useState("");
  const manager = user.role === "manager";
  const [categories, setCategories] = useState<
      { key: string; en: string; id: string }[]
    >([]),
    [category, setCategory] = useState(r.category),
    [severity, setSeverity] = useState(r.severity);
  useEffect(() => {
    void api<{ categories: { key: string; en: string; id: string }[] }>(
      "/api/reporter/company",
    )
      .then((c) => setCategories(c.categories))
      .catch(() => {});
  }, []);
  useEffect(() => {
    void api<{ staff: { id: string; name: string }[] }>(
      `/api/cases/${r.id}/people`,
    )
      .then((x) => setPeople(x.staff))
      .catch(() => {});
  }, [r.id]);
  async function action(path: string, data: unknown) {
    await api(`/api/cases/${r.id}/${path}`, { method: "POST", body: data });
    await reload();
  }
  return (
    <>
      <ErrorBox error={a.error} />
      <section>
        <h1>
          {r.caseCode} · {r.content.title}
        </h1>
        <StatusBadge state={r.state}>{t(r.state)}</StatusBadge>
        <StatusBadge state={r.verification.state}>
          {t(r.verification.state)}
        </StatusBadge>
        {r.hold && <StatusBadge state="hold">{t("hold")}</StatusBadge>}
        <p>{r.content.summary}</p>
        {Object.entries(r.content.details ?? {})
          .filter(([, v]) => v)
          .map(([key, value]) => (
            <p key={key}>
              <strong>{t(key)}:</strong> {value}
            </p>
          ))}
        <button
          disabled={a.busy}
          onClick={() =>
            void a.run(async () => {
              await api(`/api/cases/${r.id}/recuse`, {
                method: "POST",
                body: {},
              });
              location.href = "/staff";
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
      {r.state !== "closed" && (
        <section>
          <h2>{lang === "id" ? "Penilaian awal" : "Triage assessment"}</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void a.run(() =>
                action("classification", { category, severity }),
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
                    location.href = "/staff";
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
      <section>
        <h2>{t("files")}</h2>
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
      <section>
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
        {(["notes", "findings", "tasks"] as const).map((k) => (
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
                {k === "tasks" && !x.completed_at && r.state !== "closed" && (
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
            <Select
              label={t("add")}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="note">{t("notes")}</option>
              <option value="finding">{t("findings")}</option>
              <option value="task">{t("tasks")}</option>
            </Select>
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
      {["triage", "investigating", "waiting_reporter"].includes(r.state) && (
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
            <button disabled={a.busy}>{t("closure")}</button>
          </form>
        </section>
      )}
      {r.state === "closure_review" && r.closure && (
        <section>
          <h2>{t("reviewClosure")}</h2>
          <p>{t(String(r.closure.outcome))}</p>
          <p>{String(r.closure.rationale)}</p>
          <p>{String(r.closure.publicExplanation)}</p>
          {manager && r.closure.requestedBy !== user.id && (
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
                  void a.run(() =>
                    action("closure/review", { approve: true, reason }),
                  )
                }
              >
                {t("accept")}
              </button>
              <button
                disabled={a.busy || reason.length < 10}
                onClick={() =>
                  void a.run(() =>
                    action("closure/review", { approve: false, reason }),
                  )
                }
              >
                {t("reject")}
              </button>
            </>
          )}
        </section>
      )}
      {manager && (
        <section>
          <h2>{t("hold")}</h2>
          <Text
            label={t("reason")}
            minLength={10}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Check
            label={t("hold")}
            checked={r.hold}
            disabled={a.busy || reason.length < 10}
            onChange={(e) =>
              void a.run(() =>
                action("hold", { hold: e.target.checked, reason }),
              )
            }
          />
          {r.state === "closed" && (
            <>
              <h3>{t("reopen")}</h3>
              {r.reopenRequests.map((x) => (
                <p key={String(x.id)}>
                  {String((x.body as Row)?.reason ?? "")}
                </p>
              ))}
              <button
                disabled={a.busy || reason.length < 10}
                onClick={() => void a.run(() => action("reopen", { reason }))}
              >
                {t("reopen")}
              </button>
            </>
          )}
        </section>
      )}
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
  );
}
