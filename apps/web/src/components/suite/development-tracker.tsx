"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  JiraBoard,
  JiraStatus,
  JiraTicketType,
  JiraLaunch,
  JiraSupport,
} from "@whistle/shared";
import { api } from "@/lib/api";
import { ErrorBox, friendly } from "./common";
import { useStaff } from "./staff-workspace";

export function DevelopmentTracker() {
  const {
    language: { t, lang },
  } = useStaff();
  const [support, setSupport] = useState<JiraSupport>();
  const [board, setBoard] = useState<JiraBoard>();
  const [loading, setLoading] = useState(false);
  const [loadingColumns, setLoadingColumns] = useState<JiraStatus[]>([]);
  const [opening, setOpening] = useState(false);
  const [loadError, setLoadError] = useState<unknown>();
  const [launchError, setLaunchError] = useState<unknown>();
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [notice, setNotice] = useState("");
  const popup = useRef<Window | null>(null);
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());

  const loadBoard = useCallback(
    async (column?: JiraStatus, offset?: number) => {
      const request = new AbortController();
      requests.current.add(request);
      const version = column ? generation.current : ++generation.current;
      if (column) setLoadingColumns((current) => [...current, column]);
      else {
        setLoading(true);
        setLoadingColumns([]);
      }
      setLoadError(undefined);
      try {
        const query = column ? `?column=${column}&offset=${offset ?? 0}` : "";
        const result = await api<JiraBoard>(`/api/admin/jira/board${query}`, {
          signal: request.signal,
        });
        if (request.signal.aborted || version !== generation.current) return;
        setBoard((current) => {
          if (!column || !current) return result;
          const next = result.columns.find((item) => item.status === column);
          if (!next) return current;
          return {
            ...current,
            columns: current.columns.map((item) =>
              item.status === column
                ? {
                    ...next,
                    cards: [
                      ...item.cards,
                      ...next.cards.filter(
                        (card) =>
                          !item.cards.some((old) => old.key === card.key),
                      ),
                    ],
                  }
                : item,
            ),
          };
        });
      } catch (error) {
        if (!request.signal.aborted && version === generation.current)
          setLoadError(error);
      } finally {
        requests.current.delete(request);
        if (!request.signal.aborted && version === generation.current) {
          if (column)
            setLoadingColumns((current) =>
              current.filter((item) => item !== column),
            );
          else setLoading(false);
        }
      }
    },
    [],
  );

  const loadSupport = useCallback(async () => {
    const request = new AbortController();
    requests.current.add(request);
    setLoadError(undefined);
    try {
      const status = await api<JiraSupport>("/api/admin/jira", {
        signal: request.signal,
      });
      if (request.signal.aborted) return;
      setSupport(status);
      if (status.enabled) await loadBoard();
    } catch (error) {
      if (!request.signal.aborted) setLoadError(error);
    } finally {
      requests.current.delete(request);
    }
  }, [loadBoard]);

  useEffect(() => {
    void loadSupport();
    const pending = requests.current;
    return () => {
      for (const request of pending) request.abort();
      pending.clear();
      popup.current = null;
    };
  }, [loadSupport]);

  useEffect(() => {
    if (!support?.enabled || !support.origin) return;
    function completed(event: MessageEvent) {
      const data = event.data;
      if (
        event.origin !== support!.origin ||
        !popup.current ||
        event.source !== popup.current ||
        !data ||
        typeof data !== "object" ||
        data.type !== "lixionary-jira:ticket-created" ||
        typeof data.key !== "string" ||
        !/^LWB-\d+$/.test(data.key)
      )
        return;
      popup.current = null;
      setNotice(data.key);
      void loadBoard();
    }
    window.addEventListener("message", completed);
    return () => window.removeEventListener("message", completed);
  }, [support, loadBoard]);

  async function open(type: JiraTicketType) {
    setLaunchError(undefined);
    setPopupBlocked(false);
    setNotice("");
    // Keep an unfinished report available without replacing its contents.
    if (popup.current && !popup.current.closed) {
      popup.current.focus();
      return;
    }
    const child = window.open("", "_blank", "popup,width=760,height=900");
    if (!child) {
      setPopupBlocked(true);
      return;
    }
    popup.current = child;
    setOpening(true);
    const request = new AbortController();
    requests.current.add(request);
    try {
      const launch = await api<JiraLaunch>("/api/admin/jira/intake", {
        method: "POST",
        body: { type },
        signal: request.signal,
      });
      const url = new URL(launch.launchUrl);
      if (
        launch.origin !== support?.origin ||
        url.origin !== support.origin ||
        url.username ||
        url.password ||
        !Number.isFinite(Date.parse(launch.expiresAt)) ||
        Date.parse(launch.expiresAt) <= Date.now()
      )
        throw new Error("Invalid Jira launch");
      if (request.signal.aborted || child.closed) {
        child.close();
        return;
      }
      child.location.href = url.href;
    } catch (error) {
      child.close();
      if (popup.current === child) popup.current = null;
      if (!request.signal.aborted) setLaunchError(error);
    } finally {
      requests.current.delete(request);
      if (!request.signal.aborted) setOpening(false);
    }
  }

  return (
    <>
      <div className="user-page-heading">
        <h1>{t("developmentTracker")}</h1>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => void (support?.enabled ? loadBoard() : loadSupport())}
        >
          {t("refreshBoard")}
        </button>
      </div>
      <p>{t("jiraIntro")}</p>
      <p className="jira-privacy">{t("jiraPrivacy")}</p>
      <ErrorBox error={loadError ? friendly(loadError, lang) : ""} />
      <ErrorBox error={launchError ? friendly(launchError, lang) : ""} />
      {popupBlocked && <ErrorBox error={t("jiraPopupBlocked")} />}
      {notice && (
        <p role="status">
          {t("jiraSubmitted")} {notice}
        </p>
      )}
      {!support ? (
        !loadError && <p role="status">{t("loading")}</p>
      ) : !support.enabled ? (
        <p role="status">{t("jiraDisabled")}</p>
      ) : (
        <>
          <div className="jira-actions" aria-label={t("jiraReportActions")}>
            <button disabled={opening} onClick={() => void open("issue")}>
              {t("jiraReportError")}
            </button>
            <button
              className="secondary"
              disabled={opening}
              onClick={() => void open("feature_request")}
            >
              {t("jiraRequestFeature")}
            </button>
            {opening && <span role="status">{t("jiraOpening")}</span>}
          </div>
          <p>{board?.project.name ?? "LWB"} · LWB</p>
          {loading && <p role="status">{t("loading")}</p>}
          {board && (
            <div
              className="jira-board"
              aria-label={t("jiraBoard")}
              aria-busy={loading}
            >
              {board.columns.map((column) => (
                <section
                  key={column.status}
                  className="jira-column"
                  aria-label={t(`jira_${column.status}`)}
                >
                  <h2>
                    {t(`jira_${column.status}`)}{" "}
                    <span className="jira-total">{column.total}</span>
                  </h2>
                  {column.cards.length ? (
                    <ul>
                      {column.cards.map((card) => (
                        <li key={card.key}>
                          <strong className="jira-key">{card.key}</strong>
                          <p>{card.title}</p>
                          <small>
                            {t(
                              card.type === "issue"
                                ? "jiraIssue"
                                : "jiraFeature",
                            )}
                            {card.resolution
                              ? ` · ${t(card.resolution === "done" ? "jiraDone" : "jiraRejected")}`
                              : ""}
                          </small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>{t("jiraEmpty")}</p>
                  )}
                  {column.nextOffset !== null && (
                    <button
                      className="secondary"
                      disabled={
                        loading || loadingColumns.includes(column.status)
                      }
                      onClick={() =>
                        void loadBoard(column.status, column.nextOffset!)
                      }
                    >
                      {loadingColumns.includes(column.status)
                        ? t("loading")
                        : t("jiraLoadMore")}
                    </button>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
