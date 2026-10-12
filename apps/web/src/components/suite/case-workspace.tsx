"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import Link from "next/link";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";
import { states } from "@whistle/shared";
import { api, ApiError } from "@/lib/api";
import { ErrorBox, Select, StatusBadge, useAction, usePoll } from "./common";
import { useStaff } from "./staff-workspace";
import { caseSections } from "./staff-navigation";
import { Investigation, type InvestigationCase } from "./investigation";
type CaseRow = {
  id: string;
  case_code: string;
  state: string;
  category: string;
  overdue: boolean;
  unread: boolean;
};
export function CaseList() {
  const {
      language: { t, lang },
    } = useStaff(),
    a = useAction(lang);
  const params = useSearchParams(),
    router = useRouter();
  const filter = params.get("state") ?? "",
    state = states.includes(filter as (typeof states)[number]) ? filter : "";
  const parsedPage = Number(params.get("page") ?? 1),
    page =
      Number.isInteger(parsedPage) && parsedPage >= 1 && parsedPage <= 100000
        ? parsedPage
        : 1;
  const [data, setData] = useState<{ key: string; cases: CaseRow[] }>(),
    key = `${state}:${page}`;
  const cases = data?.key === key ? data.cases : undefined;
  const request = useRef(0);
  const load = useCallback(async () => {
    const generation = ++request.current;
    const query = new URLSearchParams({ page: String(page) });
    if (state) query.set("state", state);
    const result = await api<{ cases: CaseRow[] }>(`/api/cases?${query}`);
    if (generation === request.current)
      setData({ key: `${state}:${page}`, cases: result.cases });
  }, [state, page]);
  useEffect(() => {
    void a.run(load);
  }, [load]);
  usePoll(load);
  function href(nextPage: number, nextState = state) {
    const query = new URLSearchParams();
    if (nextState) query.set("state", nextState);
    if (nextPage > 1) query.set("page", String(nextPage));
    return `/staff/cases${query.size ? `?${query}` : ""}`;
  }
  return (
    <>
      <h1>{t("cases")}</h1>
      <ErrorBox error={a.error} />
      <section>
        <Select
          label={t("state")}
          value={state}
          onChange={(e) => router.push(href(1, e.target.value))}
        >
          <option value="">{lang === "id" ? "Semua" : "All"}</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {t(s)}
            </option>
          ))}
        </Select>
        {!cases ? (
          <p>{t("loading")}</p>
        ) : cases.length === 0 ? (
          <p>{t("noCases")}</p>
        ) : (
          cases.map((c) => (
            <article className="case-row" key={c.id}>
              <Link className="case-link" href={`/staff/cases/${c.id}`}>
                {c.case_code}
              </Link>
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
          ))
        )}
        <nav className="pagination" aria-label={t("page")}>
          <button
            className="secondary"
            aria-label={t("previousPage")}
            disabled={page <= 1 || a.busy}
            onClick={() => router.push(href(page - 1))}
          >
            ←
          </button>
          {page}
          <button
            className="secondary"
            aria-label={t("nextPage")}
            disabled={!cases || cases.length < 50 || a.busy}
            onClick={() => router.push(href(page + 1))}
          >
            →
          </button>
        </nav>
      </section>
    </>
  );
}
type CaseContextValue = {
  report: InvestigationCase;
  reload: () => Promise<void>;
};
const CaseContext = createContext<CaseContextValue | null>(null);
export function CaseWorkspace({ children }: { children: ReactNode }) {
  const { id } = useParams<{ id: string }>(),
    pathname = usePathname(),
    router = useRouter();
  const {
      clearDrafts,
      language: { t, lang },
    } = useStaff(),
    a = useAction(lang);
  const [report, setReport] = useState<InvestigationCase>(),
    [unavailable, setUnavailable] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const generation = ++request.current;
    try {
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        setUnavailable(true);
        setReport(undefined);
        return;
      }
      const result = await api<InvestigationCase>(`/api/cases/${id}`);
      if (generation !== request.current) return;
      setReport(result);
      setUnavailable(false);
    } catch (e) {
      if (generation !== request.current) return;
      if (
        e instanceof ApiError &&
        (e.status === 404 || (e.status === 403 && e.code !== "mfa_required"))
      ) {
        setUnavailable(true);
        setReport(undefined);
        clearDrafts(`case.${id}.`);
        return;
      }
      throw e;
    }
  }, [id, clearDrafts]);
  useEffect(() => {
    setReport(undefined);
    setUnavailable(false);
    void a.run(load);
  }, [load]);
  usePoll(load);
  const current = report?.id === id ? report : undefined;
  const base = `/staff/cases/${id}`;
  return (
    <>
      <Link href="/staff/cases">← {t("cases")}</Link>
      <ErrorBox error={a.error} />
      {unavailable ? (
        <section>
          <h1>{t("unavailableCase")}</h1>
        </section>
      ) : !current ? (
        <p>{t("loading")}</p>
      ) : (
        <CaseContext.Provider value={{ report: current, reload: load }}>
          <section className="case-header">
            <h1>
              {current.caseCode} · {current.content.title}
            </h1>
            <div className="case-badges">
              <StatusBadge state={current.state}>
                {t(current.state)}
              </StatusBadge>
              <StatusBadge state={current.verification.state}>
                {t(current.verification.state)}
              </StatusBadge>
              {current.hold && (
                <StatusBadge state="hold">{t("hold")}</StatusBadge>
              )}
            </div>
            <nav className="case-sections" aria-label={t("caseSection")}>
              {caseSections.map((s) => {
                const href = base + (s.segment ? `/${s.segment}` : "");
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={pathname === href ? "page" : undefined}
                  >
                    {t(s.key)}
                  </Link>
                );
              })}
            </nav>
            <div className="case-section-mobile">
              <Select
                label={t("caseSection")}
                value={pathname}
                onChange={(e) => router.push(e.target.value)}
              >
                {caseSections.map((s) => {
                  const href = base + (s.segment ? `/${s.segment}` : "");
                  return (
                    <option key={href} value={href}>
                      {t(s.key)}
                    </option>
                  );
                })}
              </Select>
            </div>
          </section>
          {children}
        </CaseContext.Provider>
      )}
    </>
  );
}
export function CasePage({
  section,
}: {
  section: (typeof caseSections)[number]["segment"];
}) {
  const value = useContext(CaseContext),
    {
      user,
      language: { t, lang },
    } = useStaff();
  if (!value) return null;
  return (
    <Investigation
      report={value.report}
      reload={value.reload}
      user={user}
      t={t}
      lang={lang}
      section={section}
    />
  );
}
