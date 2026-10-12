"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { states, type StaffIdentity } from "@whistle/shared";
import {
  Shell,
  StatusBadge,
  useLanguage,
  useAction,
  Select,
  ErrorBox,
  usePoll,
} from "@/components/suite/common";
import { Analytics } from "@/components/suite/analytics";
import { Admin } from "@/components/suite/admin";
import {
  Investigation,
  type InvestigationCase,
} from "@/components/suite/investigation";
type List = {
  id: string;
  case_code: string;
  state: string;
  category: string;
  overdue: boolean;
  unread: boolean;
};
export default function Staff() {
  const l = useLanguage(),
    { t, lang } = l,
    a = useAction(lang),
    [user, setUser] = useState<StaffIdentity>(),
    [cases, setCases] = useState<List[]>([]),
    [state, setState] = useState(""),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(""),
    [report, setReport] = useState<InvestigationCase>(),
    [sessions, setSessions] = useState<{ id: string; expires_at: string }[]>(
      [],
    );
  const load = useCallback(async () => {
    if (selected) {
      setReport(await api(`/api/cases/${selected}`));
    } else if (user && user.role !== "admin") {
      setCases(
        (
          await api<{ cases: List[] }>(
            `/api/cases?state=${state}&page=${page}`.replace("state=&", ""),
          )
        ).cases,
      );
    }
  }, [selected, user, state, page]);
  useEffect(() => {
    void api<StaffIdentity & { mfaVerified: boolean }>("/api/staff/me")
      .then((u) => {
        if (!u.mfaVerified) location.href = "/staff/login";
        else setUser(u);
      })
      .catch(() => {
        location.href = "/staff/login";
      });
  }, []);
  useEffect(() => {
    if (user) void a.run(load);
  }, [load, user]);
  usePoll(
    useCallback(async () => {
      if (user) await load();
    }, [load, user]),
  );
  return (
    <Shell language={l}>
      <ErrorBox error={a.error} />
      {user ? (
        <>
          <section>
            <h1>{user.name}</h1>
            <StatusBadge state={user.role}>{t(user.role)}</StatusBadge>
            <button
              onClick={() =>
                void a.run(async () => {
                  await api("/api/staff/logout", { method: "POST", body: {} });
                  location.href = "/staff/login";
                })
              }
            >
              {t("signout")}
            </button>
            <details>
              <summary>{t("sessions")}</summary>
              <button
                onClick={() =>
                  void a.run(async () =>
                    setSessions(await api("/api/staff/sessions")),
                  )
                }
              >
                {t("refresh")}
              </button>
              {sessions.map((s) => (
                <p key={s.id}>
                  {new Date(s.expires_at).toLocaleString(lang)}{" "}
                  <button
                    onClick={() =>
                      void a.run(async () => {
                        await api(`/api/staff/sessions/${s.id}`, {
                          method: "DELETE",
                        });
                        setSessions(sessions.filter((x) => x.id !== s.id));
                      })
                    }
                  >
                    {t("revoke")}
                  </button>
                </p>
              ))}
            </details>
          </section>
          {user.role === "admin" ? (
            <Admin t={t} lang={lang} />
          ) : selected && report ? (
            <>
              <button
                onClick={() => {
                  setSelected("");
                  setReport(undefined);
                }}
              >
                {t("cases")}
              </button>
              <Investigation
                key={report.id}
                report={report}
                user={user}
                t={t}
                lang={lang}
                reload={load}
              />
            </>
          ) : (
            <section>
              <h2>{t("cases")}</h2>
              <Select
                label={t("state")}
                value={state}
                onChange={(e) => {
                  setState(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">{lang === "id" ? "Semua" : "All"}</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {t(s)}
                  </option>
                ))}
              </Select>
              {cases.map((c) => (
                <article className="case-row" key={c.id}>
                  <button onClick={() => setSelected(c.id)}>
                    {c.case_code}
                  </button>
                  <span className="case-meta">
                    <StatusBadge state={c.state}>{t(c.state)}</StatusBadge>{" "}
                    {c.category}
                  </span>
                  {c.overdue && (
                    <StatusBadge state="overdue">{t("overdue")}</StatusBadge>
                  )}
                  {c.unread && (
                    <StatusBadge state="unread">{t("unread")}</StatusBadge>
                  )}
                </article>
              ))}
              <nav className="pagination" aria-label={t("page")}>
                <button
                  className="secondary"
                  aria-label={t("previousPage")}
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  ←
                </button>{" "}
                {page}{" "}
                <button
                  className="secondary"
                  aria-label={t("nextPage")}
                  disabled={cases.length < 50}
                  onClick={() => setPage(page + 1)}
                >
                  →
                </button>
              </nav>
            </section>
          )}
          <Analytics lang={lang} t={t} />
        </>
      ) : (
        <p>{t("loading")}</p>
      )}
    </Shell>
  );
}
