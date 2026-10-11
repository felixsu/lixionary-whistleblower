"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useAction, ErrorBox, type Lang } from "./common";
type Metrics = {
  groups: {
    state: string;
    count: number;
    average_days: string;
    acknowledgment_days: string | null;
  }[];
  outcomes: { outcome: string; count: number }[];
  correctiveActions: { total: number; completed: number }[];
  suppressionThreshold: number;
};
export function Analytics({
  lang,
  t,
}: {
  lang: Lang;
  t: (s: string) => string;
}) {
  const a = useAction(lang),
    [data, setData] = useState<Metrics>();
  return (
    <section>
      <h2>{t("analytics")}</h2>
      <ErrorBox error={a.error} />
      <p>
        {lang === "id"
          ? "Kelompok kurang dari lima kasus disembunyikan untuk menjaga kerahasiaan."
          : "Groups of fewer than five cases are hidden to protect confidentiality."}
      </p>
      <button
        disabled={a.busy}
        onClick={() =>
          void a.run(async () => setData(await api("/api/admin/analytics")))
        }
      >
        {t("refresh")}
      </button>
      {data && (
        <>
          <div className="scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("state")}</th>
                  <th>{lang === "id" ? "Jumlah" : "Count"}</th>
                  <th>
                    {lang === "id"
                      ? "Rata-rata umur (hari)"
                      : "Average age (days)"}
                  </th>
                  <th>
                    {lang === "id"
                      ? "Konfirmasi (hari)"
                      : "Acknowledgment (days)"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.groups.map((g) => (
                  <tr key={g.state}>
                    <td>{t(g.state)}</td>
                    <td>{g.count}</td>
                    <td>{g.average_days}</td>
                    <td>{g.acknowledgment_days ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.outcomes.map((o) => (
            <p key={o.outcome}>
              {t(o.outcome)}: {o.count}
            </p>
          ))}
          {data.correctiveActions.map((c, i) => (
            <p key={i}>
              {lang === "id"
                ? "Tindakan perbaikan selesai"
                : "Completed corrective actions"}
              : {c.completed} / {c.total}
            </p>
          ))}
          <button
            onClick={() => {
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], {
                  type: "application/json",
                }),
              );
              const link = document.createElement("a");
              link.href = url;
              link.download = "whistleblower-aggregate-metrics.json";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            {lang === "id" ? "Unduh statistik" : "Download statistics"}
          </button>
        </>
      )}
    </section>
  );
}
