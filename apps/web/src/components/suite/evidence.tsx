"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  Check,
  ErrorBox,
  Field,
  privateApi,
  useAction,
  type Lang,
} from "./common";
type File = {
  id: string;
  status: string;
  mime: string;
  pages: number;
  sha256: string;
  error_code: string | null;
};
export function Evidence({
  t,
  lang,
  closed,
}: {
  t: (s: string) => string;
  lang: Lang;
  closed: boolean;
}) {
  const a = useAction(lang),
    [files, setFiles] = useState<File[]>([]),
    [selected, setSelected] = useState<File>(),
    [url, setUrl] = useState(""),
    [review, setReview] = useState(false),
    [rect, setRect] = useState({
      page: 1,
      x: 0,
      y: 0,
      width: 0.1,
      height: 0.1,
    });
  const load = useCallback(async () => {
    const r = await privateApi<{ files: File[] }>("/files");
    setFiles(r.files);
  }, []);
  useEffect(() => {
    void load().catch(() => {});
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load().catch(() => {});
    }, 5000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  async function preview(f: File) {
    const { capability } = await api<{ capability: string }>(
      "/api/reporter/capability",
      { method: "POST", body: {} },
    );
    const response = await fetch(`/privacy/reporter/files/${f.id}/preview`, {
      headers: { Authorization: `Bearer ${capability}` },
    });
    if (!response.ok) throw new Error("preview_failed");
    const next = URL.createObjectURL(await response.blob());
    setUrl(next);
    setSelected(f);
    setReview(false);
  }
  return (
    <section>
      <h2>{t("files")}</h2>
      <ErrorBox error={a.error} />
      {!closed && (
        <label>
          {t("upload")}
          <input
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.pptx"
            disabled={a.busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void a.run(async () => {
                  const data = new FormData();
                  data.append("file", file);
                  await privateApi("/files", { method: "POST", body: data });
                  await load();
                  e.target.value = "";
                });
            }}
          />
        </label>
      )}
      <p>
        {lang === "id"
          ? "File asli disegel. Hanya versi yang disanitasi dan Anda setujui dibagikan kepada staf. Periksa semua halaman."
          : "Original files are sealed. Staff receive only the sanitized version you approve. Review every page."}
      </p>
      {files.map((f) => (
        <article key={f.id}>
          <span>
            {t("files")} {files.indexOf(f) + 1} · {t(f.status)}
          </span>
          {["review", "published"].includes(f.status) && (
            <button onClick={() => void a.run(() => preview(f))}>
              {t("preview")}
            </button>
          )}
          {["quarantined", "review", "rejected"].includes(f.status) && (
            <button
              onClick={() =>
                void a.run(async () => {
                  await privateApi(`/files/${f.id}`, { method: "DELETE" });
                  await load();
                  if (selected?.id === f.id) {
                    setSelected(undefined);
                    setUrl("");
                  }
                })
              }
            >
              {t("delete")}
            </button>
          )}
        </article>
      ))}
      {selected && url && (
        <article>
          {selected.mime === "application/pdf" ? (
            <iframe title={t("preview")} src={url} />
          ) : (
            <img src={url} alt={t("preview")} />
          )}{" "}
          {selected.status === "review" && !closed && (
            <>
              <p>
                {lang === "id"
                  ? "Samarkan bagian yang sensitif dengan persegi panjang. Posisi dan ukuran memakai pecahan halaman (0–1); titik awal di kiri atas. Pratinjau diperbarui setelah diterapkan."
                  : "Cover sensitive details with a rectangle. Position and size use fractions of the page (0–1), starting at its top left. Review the updated preview after applying."}
              </p>
              <div className="grid">
                {(["page", "x", "y", "width", "height"] as const).map((k) => (
                  <Field
                    key={k}
                    label={
                      k === "page"
                        ? t("page")
                        : {
                            x:
                              lang === "id"
                                ? "Posisi horizontal"
                                : "Horizontal position",
                            y:
                              lang === "id"
                                ? "Posisi vertikal"
                                : "Vertical position",
                            width: lang === "id" ? "Lebar" : "Width",
                            height: lang === "id" ? "Tinggi" : "Height",
                          }[k]
                    }
                    type="number"
                    min={k === "page" ? 1 : 0}
                    max={k === "page" ? selected.pages : 1}
                    step={k === "page" ? 1 : 0.01}
                    value={rect[k]}
                    onChange={(e) =>
                      setRect({ ...rect, [k]: Number(e.target.value) })
                    }
                  />
                ))}
              </div>
              <button
                disabled={a.busy}
                onClick={() =>
                  void a.run(async () => {
                    await privateApi(`/files/${selected.id}/redact`, {
                      method: "POST",
                      body: { rectangles: [rect] },
                    });
                    const latest = await privateApi<{ files: File[] }>(
                      "/files",
                    );
                    await preview(
                      latest.files.find((f) => f.id === selected.id)!,
                    );
                  })
                }
              >
                {t("redact")}
              </button>
              <Check
                label={t("review")}
                checked={review}
                onChange={(e) => setReview(e.target.checked)}
              />
              <button
                disabled={!review || a.busy}
                onClick={() =>
                  void a.run(async () => {
                    await privateApi(`/files/${selected.id}/approve`, {
                      method: "POST",
                      body: { privacyReviewed: true, sha256: selected.sha256 },
                    });
                    setSelected(undefined);
                    setUrl("");
                    await load();
                  })
                }
              >
                {t("approve")}
              </button>
            </>
          )}
        </article>
      )}
    </section>
  );
}
