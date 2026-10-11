import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../apps/privacy/package.json", import.meta.url),
);
const sharp = require("sharp");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const base = "http://localhost:9551",
  origin = base;
let cookie = "";
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const r = await fetch(base + path, {
    method,
    headers: {
      origin,
      "x-csrf": "1",
      cookie,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal(r.ok, true, `API request failed (${r.status})`);
  return r.json();
}
async function privateRequest(
  path,
  body,
  method = body === undefined ? "GET" : "POST",
) {
  const { capability } = await api("/api/reporter/capability", {});
  return fetch(base + "/privacy/reporter" + path, {
    method,
    headers: {
      origin,
      "x-csrf": "1",
      authorization: `Bearer ${capability}`,
      ...(body !== undefined && !(body instanceof FormData)
        ? { "content-type": "application/json" }
        : {}),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
  });
}
const company = await api("/api/reporter/company");
await api("/api/reporter/reports", {
  title: "Evidence pipeline test case",
  summary:
    "Synthetic evidence is submitted to verify quarantine, sanitization, redaction and custody.",
  category: company.categories[0].key,
  privacyReviewed: true,
  policyVersion: company.version,
});
const image = await sharp({
  create: { width: 100, height: 100, channels: 3, background: "white" },
})
  .withExif({ IFD0: { Artist: "private-original@example.test" } })
  .png()
  .toBuffer();
const pdf = await PDFDocument.create(),
  page = pdf.addPage([300, 300]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText("PRIVATE ORIGINAL IDENTITY", { x: 20, y: 250, size: 12, font });
pdf.setAuthor("private-original@example.test");
async function upload(bytes, name) {
  const form = new FormData();
  form.append("file", new Blob([bytes]), name);
  const response = await privateRequest("/files", form);
  assert.equal(response.status, 202);
  return (await response.json()).id;
}
async function waitFor(id) {
  for (let n = 0; n < 90; n++) {
    const response = await privateRequest("/files");
    assert.equal(response.ok, true);
    const files = (await response.json()).files;
    const file = files.find((x) => x.id === id);
    if (file && ["review", "rejected"].includes(file.status)) return file;
    await pause(2000);
  }
  throw new Error("Evidence processing timed out");
}
const imageId = await upload(image, "source.png"),
  pdfId = await upload(Buffer.from(await pdf.save()), "source.pdf");
for (const id of [imageId, pdfId]) {
  const file = await waitFor(id);
  assert.equal(file.status, "review");
  const preview = await privateRequest(`/files/${id}/preview`);
  assert.equal(preview.ok, true);
  const bytes = Buffer.from(await preview.arrayBuffer());
  assert.notEqual(
    bytes.includes(Buffer.from("private-original@example.test")),
    true,
  );
  const redacted = await privateRequest(`/files/${id}/redact`, {
    rectangles: [{ page: 1, x: 0, y: 0, width: 1, height: 0.5 }],
  });
  assert.equal(redacted.ok, true);
  const staleApproval = await privateRequest(`/files/${id}/approve`, {
    privacyReviewed: true,
    sha256: file.sha256,
  });
  assert.equal(staleApproval.status, 409);
  const latest = (await (await privateRequest("/files")).json()).files.find(
    (f) => f.id === id,
  );
  const approved = await privateRequest(`/files/${id}/approve`, {
    privacyReviewed: true,
    sha256: latest.sha256,
  });
  assert.equal(approved.ok, true);
  const original = await privateRequest(`/files/${id}/original`);
  assert.equal(original.status, 404);
}
const eicar = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
);
const badId = await upload(eicar, "test.txt");
assert.equal((await waitFor(badId)).status, "rejected");
for (let n = 0; n < 15; n++) {
  const report = await api("/api/reporter/case");
  if (report.evidence.length === 2) {
    assert.equal(
      report.evidence.every((e) =>
        e.transformation.includes("reporter_redacted"),
      ),
      true,
    );
    console.log(
      "PNG and PDF scanned and sanitized; permanent redaction and approved publication verified; originals denied; EICAR rejected.",
    );
    process.exit(0);
  }
  await pause(2000);
}
throw new Error("Publication timed out");
