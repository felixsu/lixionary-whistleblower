import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { attachments, auditLog, intakeMessages, notificationOutbox, reports } from "../src/db/schema.js";
import { processOutbox } from "../src/notify/outbox.js";
import type { Mail } from "../src/notify/mailer.js";
import { createAdmin, createTestApp, loginCookie, parseSse, sampleReport, type TestContext } from "./helpers.js";

let t: TestContext;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

async function startIntake() {
  const res = await t.app.inject({ method: "POST", url: "/api/intake/sessions" });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string; token: string; aiEnabled: boolean };
}

function sendChat(s: { id: string; token: string }, content: string) {
  return t.app.inject({
    method: "POST",
    url: `/api/intake/sessions/${s.id}/messages`,
    headers: { "x-intake-token": s.token },
    payload: { content },
  });
}

function multipart(filename: string, mime: string, data: Buffer) {
  const boundary = "----whistletest";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, data, tail]), contentType: `multipart/form-data; boundary=${boundary}` };
}

async function upload(s: { id: string; token: string }, filename: string, mime: string, data: Buffer) {
  const { payload, contentType } = multipart(filename, mime, data);
  return t.app.inject({
    method: "POST",
    url: `/api/intake/sessions/${s.id}/attachments`,
    headers: { "x-intake-token": s.token, "content-type": contentType },
    payload,
  });
}

async function submit(s: { id: string; token: string }, extra: Record<string, unknown> = {}) {
  return t.app.inject({
    method: "POST",
    url: "/api/reports",
    payload: {
      intakeSessionId: s.id,
      intakeToken: s.token,
      report: sampleReport,
      contact: { email: "reporter@example.com", phone: "", preference: "email" },
      attachmentIds: [],
      consent: true,
      ...extra,
    },
  });
}

describe("AI intake", () => {
  it("streams the reply, stores both turns and strips the READY marker", async () => {
    const s = await startIntake();
    t.ai.replies = ["Thanks — recap here.\n[[READY]]"];
    const res = await sendChat(s, "My manager takes kickbacks from a vendor.");
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = parseSse(res.body);
    const text = events.filter((e) => e.type === "delta").map((e) => e.text).join("");
    expect(text).toBe("Thanks — recap here.\n");
    expect(events.at(-1)).toMatchObject({ type: "done", turnCount: 1, suggestFinish: true });

    // System prompt first, then greeting + user turn.
    expect(t.ai.calls[0]![0]!.role).toBe("system");
    expect(t.ai.calls[0]!.slice(1).map((m) => m.role)).toEqual(["assistant", "user"]);

    const state = await t.app.inject({ url: `/api/intake/sessions/${s.id}`, headers: { "x-intake-token": s.token } });
    expect(state.json().messages.map((m: { role: string }) => m.role)).toEqual(["assistant", "user", "assistant"]);
  });

  it("rolls back the user turn when the AI fails", async () => {
    const s = await startIntake();
    t.ai.failStream = true;
    const events = parseSse((await sendChat(s, "Something happened")).body);
    expect(events.at(-1)?.type).toBe("error");
    const rows = await t.db.select().from(intakeMessages).where(eq(intakeMessages.sessionId, s.id));
    expect(rows).toHaveLength(1); // only the greeting
  });

  it("rejects a wrong session token and reports AI unavailability", async () => {
    const s = await startIntake();
    expect((await sendChat({ id: s.id, token: "x".repeat(43) }, "hi")).statusCode).toBe(404);
    t.ai.enabled = false;
    const res = await sendChat(s, "hi");
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe("ai_disabled");
  });

  it("builds a draft, retrying once on malformed JSON", async () => {
    const s = await startIntake();
    await sendChat(s, "Vendor Z pays our procurement manager.");
    t.ai.completions = [
      "not json",
      JSON.stringify({ draft: { ...sampleReport, title: "Kickbacks" }, completeness: 65, missing: ["Which contracts?"] }),
    ];
    const res = await t.app.inject({
      method: "POST",
      url: `/api/intake/sessions/${s.id}/draft`,
      headers: { "x-intake-token": s.token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ completeness: 65, missing: ["Which contracts?"], draft: { title: "Kickbacks" } });

    t.ai.completions = ["nope", "still nope"];
    const failed = await t.app.inject({
      method: "POST",
      url: `/api/intake/sessions/${s.id}/draft`,
      headers: { "x-intake-token": s.token },
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error).toBe("ai_failed");
  });
});

describe("submission and reporter follow-up", () => {
  it("requires an email or phone", async () => {
    const s = await startIntake();
    const res = await submit(s, { contact: { email: "", phone: "" } });
    expect(res.statusCode).toBe(400);
  });

  it("encrypts contact details, queues a notification and blocks double submission", async () => {
    const s = await startIntake();
    const res = await submit(s);
    expect(res.statusCode).toBe(200);
    const { caseCode, pin } = res.json();
    expect(caseCode).toMatch(/^WB-/);
    expect(pin).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/);

    const [row] = await t.db.select().from(reports).where(eq(reports.caseCode, caseCode));
    expect(row!.contactEmailEnc).toMatch(/^v1:/);
    expect(row!.contactEmailEnc).not.toContain("reporter@example.com");
    expect(row!.contactPhoneEnc).toBeNull();
    expect(row!.pinHash).not.toContain(pin);
    expect(row!.completeness).toBe(100); // heuristic: every field filled, no AI assessment

    const outbox = await t.db.select().from(notificationOutbox);
    expect(outbox).toHaveLength(1);

    expect((await submit(s)).statusCode).toBe(409);
  });

  it("lets the reporter check status and talk to admins with case code + PIN", async () => {
    const s = await startIntake();
    const { caseCode, pin } = (await submit(s)).json();

    const wrongPin = await t.app.inject({ method: "POST", url: "/api/status", payload: { caseCode, pin: "AAAAA-AAAAA" } });
    const wrongCase = await t.app.inject({ method: "POST", url: "/api/status", payload: { caseCode: "WB-0000-0000", pin } });
    expect(wrongPin.statusCode).toBe(401);
    expect(wrongCase.statusCode).toBe(401);
    expect(wrongPin.json().message).toBe(wrongCase.json().message);

    const lookup = await t.app.inject({
      method: "POST",
      url: "/api/status",
      payload: { caseCode: caseCode.toLowerCase().replace(/-/g, " "), pin: pin.toLowerCase() },
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toMatchObject({ caseCode, status: "new", messages: [] });

    // Admin asks a question; reporter sees it and answers.
    const admin = await createAdmin(t.db);
    const cookie = await loginCookie(t.app, admin.email, admin.password);
    const [report] = await t.db.select().from(reports).where(eq(reports.caseCode, caseCode));
    const sent = await t.app.inject({
      method: "POST",
      url: `/api/admin/reports/${report!.id}/messages`,
      headers: { cookie, "x-csrf": "1" },
      payload: { body: "Can you share the vendor's name?" },
    });
    expect(sent.statusCode).toBe(201);

    const reply = await t.app.inject({
      method: "POST",
      url: "/api/status/messages",
      payload: { caseCode, pin, body: "It is Vendor Z Ltd." },
    });
    expect(reply.statusCode).toBe(200);
    expect(reply.json().messages.map((m: { author: string }) => m.author)).toEqual(["admin", "reporter"]);

    const list = await t.app.inject({ url: "/api/admin/reports", headers: { cookie } });
    expect(list.json().items[0]).toMatchObject({ unreadReporterMessages: 1, attachmentCount: 0 });

    await t.app.inject({
      method: "PATCH",
      url: `/api/admin/reports/${report!.id}/status`,
      headers: { cookie, "x-csrf": "1" },
      payload: { status: "closed_resolved" },
    });
    const closed = await t.app.inject({ method: "POST", url: "/api/status/messages", payload: { caseCode, pin, body: "hello?" } });
    expect(closed.statusCode).toBe(409);
  });
});

describe("admin", () => {
  it("requires a session and the CSRF header", async () => {
    expect((await t.app.inject({ url: "/api/admin/reports" })).statusCode).toBe(401);
    const admin = await createAdmin(t.db);
    const noCsrf = await t.app.inject({ method: "POST", url: "/api/admin/login", payload: admin });
    expect(noCsrf.statusCode).toBe(403);
    const bad = await t.app.inject({
      method: "POST",
      url: "/api/admin/login",
      headers: { "x-csrf": "1" },
      payload: { ...admin, password: "wrong password!" },
    });
    expect(bad.statusCode).toBe(401);
    const cookie = await loginCookie(t.app, admin.email, admin.password);
    expect((await t.app.inject({ url: "/api/admin/me", headers: { cookie } })).json().email).toBe(admin.email);
  });

  it("audits contact reveals and status changes", async () => {
    const s = await startIntake();
    await submit(s, { contact: { email: "reporter@example.com", phone: "+62 812 3456 7890", preference: "phone" } });
    const admin = await createAdmin(t.db);
    const cookie = await loginCookie(t.app, admin.email, admin.password);
    const { items } = (await t.app.inject({ url: "/api/admin/reports?status=new", headers: { cookie } })).json();
    expect(items).toHaveLength(1);
    const id = items[0].id;

    const detail = (await t.app.inject({ url: `/api/admin/reports/${id}`, headers: { cookie } })).json();
    expect(detail).toMatchObject({ hasEmail: true, hasPhone: true, contactPreference: "phone" });
    expect(JSON.stringify(detail)).not.toContain("reporter@example.com");

    const revealed = await t.app.inject({
      method: "POST",
      url: `/api/admin/reports/${id}/reveal-contact`,
      headers: { cookie, "x-csrf": "1" },
    });
    expect(revealed.json()).toEqual({ email: "reporter@example.com", phone: "+62 812 3456 7890", preference: "phone" });

    await t.app.inject({
      method: "PATCH",
      url: `/api/admin/reports/${id}/status`,
      headers: { cookie, "x-csrf": "1" },
      payload: { status: "valid" },
    });
    const audit = await t.db.select().from(auditLog).where(eq(auditLog.reportId, id));
    expect(audit.map((a) => a.action).sort()).toEqual(["contact_revealed", "status_changed"]);
  });

  it("emails admins about new reports without leaking report content", async () => {
    await createAdmin(t.db, "a1@example.com");
    await createAdmin(t.db, "a2@example.com");
    await submit(await startIntake());
    const sent: Mail[] = [];
    const n = await processOutbox(t.db, { send: async (m) => void sent.push(m) }, "http://web", t.app.log);
    expect(n).toBe(1);
    expect(sent[0]!.to.sort()).toEqual(["a1@example.com", "a2@example.com"]);
    expect(sent[0]!.text).not.toContain("Kickbacks");
    expect(sent[0]!.text).not.toContain("reporter@example.com");
    expect(await processOutbox(t.db, { send: async () => {} }, "http://web", t.app.log)).toBe(0);
  });
});

describe("attachments", () => {
  it("strips EXIF from images, rejects disallowed types and links files on submit", async () => {
    const s = await startIntake();
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "red" } })
      .jpeg()
      .withExif({ IFD0: { Artist: "Reporter Real Name", Copyright: "secret" } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const ok = await upload(s, "../../photo.jpg", "image/jpeg", jpeg);
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ mime: "image/jpeg", originalName: "photo.jpg" });

    const [stored] = await t.db.select().from(attachments).where(eq(attachments.id, ok.json().id));
    const onDisk = readFileSync(join(t.uploadDir, stored!.storageKey));
    expect((await sharp(onDisk).metadata()).exif).toBeUndefined();
    expect(onDisk.includes(Buffer.from("Reporter Real Name"))).toBe(false);

    const exe = await upload(s, "evil.pdf", "application/pdf", Buffer.from("MZ\x90\x00 not really a pdf"));
    expect(exe.statusCode).toBe(400);

    const discarded = await upload(s, "notes.txt", "text/plain", Buffer.from("timeline of events"));
    expect(discarded.statusCode).toBe(200);

    const res = await submit(s, { attachmentIds: [ok.json().id] });
    expect(res.statusCode).toBe(200);
    const rows = await t.db.select().from(attachments);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reportId).not.toBeNull();

    const admin = await createAdmin(t.db);
    const cookie = await loginCookie(t.app, admin.email, admin.password);
    const { items } = (await t.app.inject({ url: "/api/admin/reports", headers: { cookie } })).json();
    expect(items[0].attachmentCount).toBe(1);
    const dl = await t.app.inject({ url: `/api/admin/attachments/${rows[0]!.id}`, headers: { cookie } });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers["content-disposition"]).toContain("attachment");
    expect(dl.rawPayload.equals(onDisk)).toBe(true);
  });
});
