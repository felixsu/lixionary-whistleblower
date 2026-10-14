import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
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
let cookie = "",
  reportToken = "";
async function api(path, body, method = body === undefined ? "GET" : "POST") {
  const r = await fetch(base + path, {
    method,
    headers: {
      origin,
      "x-csrf": "1",
      "x-report-access": reportToken,
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
const email = "e2e-reporter-evidence@example.test";
const previousMail = await (
  await fetch("http://localhost:6403/api/v1/messages")
).json();
const previousMailIds = new Set(previousMail.messages?.map((m) => m.ID));
const challenge = await api("/privacy/admission/challenge", { email });
assert.equal(
  challenge.status,
  "otp",
  "Seed synthetic employees before running this development check",
);
let otp = "";
for (let n = 0; n < 30; n++) {
  const box = await (
    await fetch("http://localhost:6403/api/v1/messages")
  ).json();
  const match = box.messages?.find(
    (m) =>
      !previousMailIds.has(m.ID) && m.To.some((to) => to.Address === email),
  );
  if (match) {
    const message = await (
      await fetch("http://localhost:6403/api/v1/message/" + match.ID)
    ).json();
    otp =
      message.Text?.match(/(?:code is|verifikasi Anda adalah) (\d{6})/)?.[1] ??
      "";
    if (otp) break;
  }
  await pause(1000);
}
assert.ok(otp, "Synthetic OTP delivery timed out");
reportToken = (
  await api("/privacy/admission/verify", {
    challengeId: challenge.challengeId,
    code: otp,
  })
).reportToken;
const company = await api("/api/reporter/company");
await api("/api/reporter/reports", {
  submission: {
    pin: randomBytes(32).toString("base64url"),
    recoveryCode: randomBytes(32).toString("base64url"),
    submissionToken: randomBytes(32).toString("base64url"),
  },
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
// Produce synthetic Office fixtures using the same isolated runtime tools.
const office = JSON.parse(
  execFileSync(
    "docker",
    [
      "compose",
      "--env-file",
      process.env.SUITE_ENV_FILE ?? ".suite-dev/suite.env",
      "exec",
      "-T",
      "converter",
      "node",
      "--input-type=module",
      "-e",
      String.raw`
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const dir=await mkdtemp('/tmp/wb-fixtures-');
try {
 const inputs={
  rtf:'{\\rtf1\\ansi Synthetic Word evidence}',
  csv:'Synthetic Excel evidence\n1\n',
  fodp:'<?xml version="1.0"?><office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation"><office:body><office:presentation><draw:page draw:name="page1"><draw:frame svg:width="10cm" svg:height="3cm" svg:x="1cm" svg:y="1cm"><draw:text-box><text:p>Synthetic PowerPoint evidence</text:p></draw:text-box></draw:frame></draw:page></office:presentation></office:body></office:document>'
 };
 const result=[];
 for(const [input,output] of [['rtf','docx'],['csv','xlsx'],['fodp','pptx']]){
  await writeFile(dir+'/input.'+input,inputs[input]);
  execFileSync('libreoffice',['-env:UserInstallation=file://'+dir+'/profile','--headless','--convert-to',output,'--outdir',dir,dir+'/input.'+input],{timeout:60000,stdio:'pipe'});
  result.push({name:'source.'+output,data:(await readFile(dir+'/input.'+output)).toString('base64')});
 }
 console.log(JSON.stringify(result));
} finally {await rm(dir,{recursive:true,force:true})}
`,
    ],
    { encoding: "utf8", timeout: 200000 },
  ),
);
const ids = [
  await upload(image, "source.png"),
  await upload(Buffer.from(await pdf.save()), "source.pdf"),
];
for (const mime of ["jpeg", "webp"])
  ids.push(
    await upload(
      await sharp(image).toFormat(mime).toBuffer(),
      "source." + mime,
    ),
  );
for (const fixture of office)
  ids.push(await upload(Buffer.from(fixture.data, "base64"), fixture.name));
for (const id of ids) {
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
const badId = await upload(
  Buffer.from("Unsupported synthetic attachment"),
  "invalid.png",
);
assert.equal((await waitFor(badId)).status, "rejected");
console.log(
  "All seven formats converted, redacted, and approved; waiting for durable publication jobs.",
);
for (let n = 0; n < 90; n++) {
  const report = await api("/api/reporter/case");
  if (report.evidence.length === ids.length) {
    assert.equal(
      report.evidence.every((e) =>
        e.transformation.includes("reporter_redacted"),
      ),
      true,
    );
    console.log(
      "Images, PDF, Word, Excel and PowerPoint processed and sanitized; permanent redaction and approved publication verified; originals denied; unsupported content rejected.",
    );
    process.exit(0);
  }
  await pause(2000);
}
throw new Error("Publication timed out");
