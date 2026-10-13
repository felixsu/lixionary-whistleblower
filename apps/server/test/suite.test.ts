import { beforeAll, afterAll, describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { generate } from "otplib";
import {
  hashSecret,
  seal,
  unseal,
  mac,
  digest,
  capability,
  token,
  verifyCapability,
} from "@whistle/runtime";
import { defaultSettings } from "@whistle/shared";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb, rows } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { buildApp as buildPrivacy } from "../../privacy/src/app.js";
import { loadConfig as privacyConfig } from "../../privacy/src/config.js";
import { runMigrations as migratePrivacy } from "../../privacy/src/db/migrate.js";
import { createDb as privateDb } from "../../privacy/src/db/client.js";
import { expire } from "../src/jobs.js";
import { expire as expirePrivate } from "../../privacy/src/jobs.js";
import type { FastifyInstance, InjectOptions } from "fastify";
const password = "A test-only long password";
const origin = "http://localhost:9551";
let app: FastifyInstance,
  privacy: FastifyInstance,
  caseStore: ReturnType<typeof createDb>,
  vault: ReturnType<typeof privateDb>,
  suiteUrl: string,
  privateUrl: string;
const kp = generateKeyPairSync("ed25519"),
  ring = { active: "a", keys: { a: randomBytes(32).toString("base64") } },
  vaultRing = { active: "v", keys: { v: randomBytes(32).toString("base64") } },
  shared = randomBytes(32).toString("hex");
const counts = new Map<string, number>();
const limiter = {
  async hit(key: string, max: number) {
    const n = (counts.get(key) ?? 0) + 1;
    counts.set(key, n);
    return n <= max;
  },
};
const ids = {
  admin: randomUUID(),
  manager: randomUUID(),
  manager2: randomUUID(),
  analyst: randomUUID(),
  outsider: randomUUID(),
  restricted: randomUUID(),
  restricted2: randomUUID(),
  standard: randomUUID(),
  independent: randomUUID(),
};
const cookies: Record<string, string> = {};
let receipt: {
    caseCode: string;
    pin: string;
    recoveryCode: string;
    capability: string;
  },
  caseId: string,
  reporterCookie: string;
const reportAdmissions = new Map<string, string>();
async function admission(path: string, body: unknown, reportToken?: string) {
  return privacy.inject({
    url: "/privacy/admission/" + path,
    method: "POST",
    payload: body as InjectOptions["payload"],
    headers: {
      origin,
      "x-csrf": "1",
      ...(reportToken ? { "x-report-access": reportToken } : {}),
    },
  });
}
async function admissionCode(challengeId: string) {
  const jobs = await rows(
    vault.db,
    sql`select id,body_enc from delivery_jobs where kind='admission_otp' order by created_at desc`,
  );
  const job = jobs
    .map((j) =>
      unseal<Record<string, unknown>>(
        String(j.body_enc),
        vaultRing,
        "job:" + j.id,
      ),
    )
    .find((j) => j.challengeId === challengeId);
  return String(job!.code);
}
async function verifiedAccess() {
  const id = randomUUID(),
    email = `employee-${id}@example.test`;
  await rows(
    vault.db,
    sql`insert into employees(id,email_hash,body_enc) values(${id},${mac(shared, "employee:" + email)},${seal({ name: "Synthetic employee", email, phone: "+628123456789" }, vaultRing, "employee:" + id)})`,
  );
  const c = await admission("challenge", { email });
  expect(c.statusCode).toBe(200);
  const v = await admission("verify", {
    challengeId: c.json().challengeId,
    code: await admissionCode(c.json().challengeId),
  });
  expect(v.statusCode).toBe(200);
  return { reportToken: v.json().reportToken as string, id, email };
}
async function call(
  path: string,
  body?: unknown,
  cookie?: string,
  method?: string,
) {
  let reportToken: string | undefined;
  if (path === "/api/reporter/reports" && body && typeof body === "object") {
    const payload = body as {
      submission?: {
        pin: string;
        recoveryCode: string;
        submissionToken: string;
      };
    };
    payload.submission ??= {
      pin: token(),
      recoveryCode: token(),
      submissionToken: token(),
    };
    reportToken = reportAdmissions.get(payload.submission.submissionToken);
    if (!reportToken) {
      reportToken = (await verifiedAccess()).reportToken;
      reportAdmissions.set(payload.submission.submissionToken, reportToken);
    }
  }
  return app.inject({
    url: path,
    method: (method ??
      (body === undefined ? "GET" : "POST")) as InjectOptions["method"],
    payload: body as InjectOptions["payload"],
    headers: {
      origin,
      "x-csrf": "1",
      ...(cookie ? { cookie } : {}),
      ...(reportToken ? { "x-report-access": reportToken } : {}),
    },
  });
}
function cookie(r: { headers: Record<string, unknown> }) {
  return String(r.headers["set-cookie"]).split(";")[0]!;
}
async function privateCall(
  path: string,
  body?: unknown,
  method?: string,
  cap?: string,
) {
  const bearer =
    cap ??
    (await call("/api/reporter/capability", {}, reporterCookie)).json()
      .capability;
  return privacy.inject({
    url: `/privacy/reporter${path}`,
    method: (method ??
      (body === undefined ? "GET" : "POST")) as InjectOptions["method"],
    payload: body as InjectOptions["payload"],
    headers: { origin, "x-csrf": "1", authorization: `Bearer ${bearer}` },
  });
}
beforeAll(async () => {
  const url = (
    await readFile(
      new URL("../../../.suite-dev/test-database-url", import.meta.url),
      "utf8",
    )
  ).trim();
  const owner = postgres(url, { max: 1 });
  for (const name of ["whistle_suite_test", "whistle_privacy_test"]) {
    await owner.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await owner.unsafe(`CREATE DATABASE ${name}`);
  }
  await owner.end();
  suiteUrl = url.replace(/\/postgres$/, "/whistle_suite_test");
  privateUrl = url.replace(/\/postgres$/, "/whistle_privacy_test");
  await runMigrations(suiteUrl);
  await migratePrivacy(privateUrl);
  caseStore = createDb(suiteUrl);
  vault = privateDb(privateUrl);
  const cfg = loadConfig({
    NODE_ENV: "test",
    PUBLIC_WEB_URL: origin,
    SUITE_DATABASE_URL: suiteUrl,
    CASE_KEYRING: JSON.stringify(ring),
    CAPABILITY_PRIVATE_KEY: kp.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    SERVICE_EVENT_KEY: shared,
    REDIS_URL: "redis://localhost:6379",
    ABUSE_KEY: shared,
  });
  app = await buildApp({ db: caseStore.db, config: cfg, limiter });
  privacy = await buildPrivacy({
    db: vault.db,
    config: privacyConfig({
      NODE_ENV: "test",
      PRIVACY_SMTP_HOST: "mailpit",
      PUBLIC_WEB_URL: origin,
      PRIVACY_DATABASE_URL: privateUrl,
      VAULT_KEYRING: JSON.stringify(vaultRing),
      CAPABILITY_PUBLIC_KEY: kp.publicKey
        .export({ type: "spki", format: "pem" })
        .toString(),
      SERVICE_EVENT_KEY: shared,
      PRIVACY_REDIS_URL: "redis://localhost:6379",
      PRIVACY_ABUSE_KEY: shared,
      PRIVACY_STORAGE: new URL(
        "../../../.suite-dev/test-files",
        import.meta.url,
      ).pathname,
    }),
    limiter,
  });
  vi.stubGlobal("fetch", async (url: string, opts: RequestInit) => {
    const path = new URL(url).pathname;
    const target = String(url).includes(":9550") ? app : privacy;
    const res = await target.inject({
      url: path,
      method: opts.method as InjectOptions["method"],
      headers: opts.headers as Record<string, string>,
      payload: opts.body as string,
    });
    return new Response(res.body, {
      status: res.statusCode,
      headers: res.headers as Record<string, string>,
    });
  });
  for (const [name, id] of Object.entries(ids).filter(
    ([n]) => !["standard", "independent"].includes(n),
  )) {
    const role =
      name === "admin"
        ? "admin"
        : name === "analyst" || name === "outsider"
          ? "analyst"
          : "manager";
    await rows(
      caseStore.db,
      sql`insert into staff(id,email,name,role,password_hash) values(${id},${name + "@example.test"},${name},${role},${await hashSecret(password)})`,
    );
  }
  await rows(
    caseStore.db,
    sql`insert into teams(id,name,restricted) values(${ids.standard},'Standard',false),(${ids.independent},'Independent',true)`,
  );
  for (const sid of [ids.manager, ids.manager2, ids.analyst])
    await rows(
      caseStore.db,
      sql`insert into team_members values(${ids.standard},${sid})`,
    );
  for (const sid of [ids.restricted, ids.restricted2])
    await rows(
      caseStore.db,
      sql`insert into team_members values(${ids.independent},${sid})`,
    );
  const body = {
    ...defaultSettings,
    defaultTeamId: ids.standard,
    restrictedTeamId: ids.independent,
    retention: {
      cases: 365,
      contacts: 365,
      evidence: 365,
      transcripts: 365,
      audit: 365,
      backups: 365,
    },
  };
  await rows(
    caseStore.db,
    sql`insert into settings(id,body,configured) values(1,${JSON.stringify(body)}::jsonb,true)`,
  );
}, 60000);
afterAll(async () => {
  vi.unstubAllGlobals();
  await app?.close();
  await privacy?.close();
  await caseStore?.close();
  await vault?.close();
});
describe("suite privacy and workflow boundaries", () => {
  it("requires MFA and blocks replay", async () => {
    for (const name of [
      "admin",
      "manager",
      "manager2",
      "analyst",
      "outsider",
      "restricted",
    ]) {
      const login = await call("/api/staff/login", {
        email: name + "@example.test",
        password,
      });
      expect(login.statusCode).toBe(200);
      const pre = cookie(login);
      expect((await call("/api/cases", undefined, pre)).statusCode).toBe(403);
      const enroll = await call("/api/staff/mfa/enroll", {}, pre);
      expect(enroll.statusCode).toBe(200);
      const code = await generate({ secret: enroll.json().secret });
      const confirmed = await call("/api/staff/mfa/confirm", { code }, pre);
      expect(confirmed.statusCode).toBe(200);
      expect(confirmed.json().recoveryCodes).toHaveLength(8);
      cookies[name] = cookie(confirmed);
      const secondLogin = await call("/api/staff/login", {
        email: name + "@example.test",
        password,
      });
      expect(
        (await call("/api/staff/mfa/confirm", { code }, cookie(secondLogin)))
          .statusCode,
      ).toBe(401);
    }
  }, 30000);
  it("submits without contacts and returns secrets only once", async () => {
    const r = await call("/api/reporter/reports", {
      title: "Potential procurement misconduct",
      summary:
        "I observed suspicious procurement transactions that warrant a review.",
      category: "fraud",
      privacyReviewed: true,
      policyVersion: 1,
    });
    expect(r.statusCode).toBe(201);
    receipt = r.json();
    reporterCookie = cookie(r);
    const own = await call("/api/reporter/case", undefined, reporterCookie);
    caseId = own.json().id;
    expect(own.json().pin).toBeUndefined();
    expect(own.json().recoveryCode).toBeUndefined();
    expect(await rows(vault.db, sql`select * from contacts`)).toHaveLength(0);
  });
  it("retries a lost submission response without duplicates or stored plaintext secrets", async () => {
    const submission = {
      pin: token(),
      recoveryCode: token(),
      submissionToken: token(),
    };
    const payload = {
      title: "A retry-safe anonymous report",
      summary:
        "The response may be lost after saving, but retry must preserve the same case.",
      category: "fraud",
      privacyReviewed: true,
      policyVersion: 1,
      submission,
    };
    const first = await call("/api/reporter/reports", payload);
    expect(first.statusCode).toBe(201);
    const retry = await call("/api/reporter/reports", payload);
    expect(retry.statusCode).toBe(201);
    expect(retry.json().caseCode).toBe(first.json().caseCode);
    expect(retry.json().pin).toBe(submission.pin);
    const [r] = await rows(
      caseStore.db,
      sql`select * from cases where submission_hash=${digest(submission.submissionToken)}`,
    );
    expect(JSON.stringify(r)).not.toContain(submission.pin);
    expect(
      unseal(String(r!.content_enc), ring, "case:" + r!.id),
    ).not.toHaveProperty("submission");
    expect(
      (
        await call("/api/reporter/reports", {
          ...payload,
          submission: { ...submission, pin: token() },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("reserves a private AI transcript without exposing it in the staff report", async () => {
    const intakeId = randomUUID(),
      intakeToken = token();
    await rows(
      vault.db,
      sql`insert into intakes(id,token_hash,locale,consent_version,transcript_enc) values(${intakeId},${digest(intakeToken)},'en',1,${seal([{ role: "user", content: "An unreviewed private identity clue" }], vaultRing, "intake:" + intakeId)})`,
    );
    const payload = {
      title: "A reviewed assistant draft",
      summary:
        "Only this reviewed summary should be shared with the assigned review team.",
      category: "fraud",
      privacyReviewed: true,
      policyVersion: 1,
      intakeId,
      intakeToken,
      submission: {
        pin: token(),
        recoveryCode: token(),
        submissionToken: token(),
      },
    };
    const access = await verifiedAccess();
    reportAdmissions.set(
      payload.submission.submissionToken,
      access.reportToken,
    );
    await rows(
      vault.db,
      sql`update intakes set admission_id=(select id from admission_grants where token_hash=${digest(access.reportToken)}) where id=${intakeId}`,
    );
    const result = await call("/api/reporter/reports", payload);
    expect(result.statusCode).toBe(201);
    const view = await call("/api/reporter/case", undefined, cookie(result));
    const [intake] = await rows(
      vault.db,
      sql`select case_id from intakes where id=${intakeId}`,
    );
    expect(intake!.case_id).toBe(view.json().id);
    const staff = await call(
      "/api/cases/" + view.json().id,
      undefined,
      cookies.manager,
    );
    expect(staff.statusCode).toBe(200);
    expect(staff.body).not.toContain("unreviewed private identity");
    expect(staff.body).not.toContain(intakeToken);
    expect(
      (
        await call("/api/reporter/reports", {
          ...payload,
          intakeToken: token(),
          submission: {
            pin: token(),
            recoveryCode: token(),
            submissionToken: token(),
          },
        })
      ).statusCode,
    ).toBe(409);
  });
  it("enforces CSRF, assignment and administrative separation", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/reporter/rotate",
          headers: { cookie: reporterCookie },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    for (const name of ["admin", "analyst", "outsider", "restricted"])
      expect(
        (await call(`/api/cases/${caseId}`, undefined, cookies[name]))
          .statusCode,
      ).toBe(404);
    expect(
      (
        await call(
          `/api/cases/${caseId}/assign`,
          { staffId: ids.outsider },
          cookies.manager,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          `/api/cases/${caseId}/assign`,
          { staffId: ids.analyst, owner: true },
          cookies.manager,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await call(`/api/cases/${caseId}`, undefined, cookies.analyst))
        .statusCode,
    ).toBe(200);
  });
  it("verifies a contact privately without allowing staff access or recovery", async () => {
    const request = await call(
      `/api/cases/${caseId}/verification`,
      {
        reason:
          "Please confirm control of a contact for private notifications.",
      },
      cookies.analyst,
    );
    expect(request.statusCode).toBe(200);
    const challenge = await privateCall("/contacts/challenge", {
      kind: "email",
      destination: "reporter-private@example.test",
      notifications: true,
    });
    expect(challenge.statusCode).toBe(200);
    const [job] = await rows(
      vault.db,
      sql`select * from delivery_jobs where kind='otp' order by created_at desc limit 1`,
    );
    const body = unseal<Record<string, unknown>>(
      String(job!.body_enc),
      vaultRing,
      `job:${job!.id}`,
    );
    const verified = await privateCall("/contacts/verify", {
      challengeId: challenge.json().challengeId,
      code: body.code,
    });
    expect(verified.statusCode).toBe(200);
    expect(
      (
        await privateCall("/contacts/verify", {
          challengeId: challenge.json().challengeId,
          code: body.code,
        })
      ).statusCode,
    ).toBe(400);
    const events = await rows(
      vault.db,
      sql`select * from delivery_jobs where kind='event' order by created_at`,
    );
    for (const e of events) {
      const b = unseal<Record<string, unknown>>(
          String(e.body_enc),
          vaultRing,
          `job:${e.id}`,
        ),
        stamp = Date.now().toString();
      const response = await app.inject({
        method: "POST",
        url: "/internal/events",
        headers: {
          "x-service-time": stamp,
          "x-service-signature": mac(
            shared,
            `${stamp}:events:${JSON.stringify(b)}`,
          ),
        },
        payload: b,
      });
      expect(response.statusCode).toBe(200);
    }
    const staff = await call(
      `/api/cases/${caseId}`,
      undefined,
      cookies.analyst,
    );
    expect(staff.json().verification.state).toBe("verified");
    expect(staff.body).not.toContain("reporter-private");
    expect(staff.body).not.toContain("destination");
    expect(
      (
        await privacy.inject({
          url: "/privacy/reporter/contacts",
          headers: { cookie: cookies.admin },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await call("/api/reporter/recover", {
          caseCode: receipt.caseCode,
          recoveryCode: "reporter-private@example.test",
        })
      ).statusCode,
    ).toBe(401);
  });
  it("keeps notifications and private contacts encrypted", async () => {
    const [c] = await rows(
      vault.db,
      sql`select * from contacts where case_id=${caseId}`,
    );
    expect(String(c!.destination_enc)).not.toContain("reporter-private");
    const audits = JSON.stringify(
      await rows(caseStore.db, sql`select * from audit_events`),
    );
    expect(audits).not.toContain("reporter-private");
    expect(audits).not.toContain(receipt.pin);
    expect(
      (await call("/api/admin/analytics", undefined, cookies.admin)).json()
        .groups,
    ).toHaveLength(0);
  });
  it("supports conversation and independent closure approval", async () => {
    expect(
      (
        await call(
          "/api/reporter/messages",
          {
            body: "Additional facts from the anonymous reporter.",
            privacyReviewed: true,
          },
          reporterCookie,
        )
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await call(
          `/api/cases/${caseId}/messages`,
          { body: "Thank you. We will review the documents." },
          cookies.analyst,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("/api/reporter/case", undefined, reporterCookie)).json()
        .messages,
    ).toHaveLength(2);
    expect(
      (
        await call(
          `/api/cases/${caseId}/state`,
          { state: "triage" },
          cookies.analyst,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          `/api/cases/${caseId}/state`,
          { state: "closed" },
          cookies.analyst,
        )
      ).statusCode,
    ).toBe(409);
    const task = await call(
      `/api/cases/${caseId}/records`,
      { kind: "task", body: "Improve procurement approval controls." },
      cookies.analyst,
    );
    const closure = {
      outcome: "substantiated",
      rationale:
        "The available documents substantiate the reported procurement issue.",
      publicExplanation:
        "The investigation is complete and corrective actions have been taken.",
    };
    expect(
      (await call(`/api/cases/${caseId}/closure`, closure, cookies.manager))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          `/api/cases/${caseId}/tasks/${task.json().id}/complete`,
          { completionEvidence: "Approval procedures updated and reviewed." },
          cookies.analyst,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await call(`/api/cases/${caseId}/closure`, closure, cookies.manager))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          `/api/cases/${caseId}/closure/review`,
          { approve: true, reason: "Independent review completed." },
          cookies.manager,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          `/api/cases/${caseId}/closure/review`,
          { approve: true, reason: "Independent review completed." },
          cookies.manager2,
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          "/api/reporter/messages",
          { body: "This should be rejected.", privacyReviewed: true },
          reporterCookie,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(
          "/api/reporter/reopen",
          { reason: "There are additional facts for the team." },
          reporterCookie,
        )
      ).statusCode,
    ).toBe(200);
  });
  it("respects legal holds when deleting old cases", async () => {
    await call(
      `/api/cases/${caseId}/hold`,
      {
        hold: true,
        reason: "Preserve records for an ongoing legal proceeding.",
      },
      cookies.manager,
    );
    await rows(
      caseStore.db,
      sql`update cases set closed_at=now()-interval '400 days' where id=${caseId}`,
    );
    await expire(caseStore.db);
    expect(
      await rows(caseStore.db, sql`select id from cases where id=${caseId}`),
    ).toHaveLength(1);
  });
  it("revokes sessions and capabilities during recovery", async () => {
    const old = reporterCookie;
    const recovered = await call("/api/reporter/recover", {
      caseCode: receipt.caseCode,
      recoveryCode: receipt.recoveryCode,
    });
    expect(recovered.statusCode).toBe(200);
    reporterCookie = cookie(recovered);
    expect((await call("/api/reporter/case", undefined, old)).statusCode).toBe(
      401,
    );
    expect(
      (await privateCall("/contacts", undefined, undefined, receipt.capability))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await call("/api/reporter/session", {
          caseCode: receipt.caseCode,
          pin: receipt.pin,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await call("/api/reporter/recover", {
          caseCode: receipt.caseCode,
          recoveryCode: receipt.recoveryCode,
        })
      ).statusCode,
    ).toBe(401);
    receipt = recovered.json();
  });
  it("routes leadership allegations independently and revokes recused access", async () => {
    const r = await call("/api/reporter/reports", {
      title: "Review team conflict of interest",
      summary:
        "This concern involves members of the standard review team and company leadership.",
      category: "other",
      sensitive: true,
      privacyReviewed: true,
      policyVersion: 1,
    });
    const own = await call("/api/reporter/case", undefined, cookie(r));
    const id = own.json().id;
    expect(
      (await call(`/api/cases/${id}`, undefined, cookies.manager)).statusCode,
    ).toBe(404);
    expect(
      (await call(`/api/cases/${id}`, undefined, cookies.restricted))
        .statusCode,
    ).toBe(200);
    expect(
      (await call(`/api/cases/${caseId}/recuse`, {}, cookies.analyst))
        .statusCode,
    ).toBe(200);
    expect(
      (await call(`/api/cases/${caseId}`, undefined, cookies.analyst))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          `/api/cases/${caseId}/assign`,
          { staffId: ids.analyst },
          cookies.manager,
        )
      ).statusCode,
    ).toBe(409);
  });
  it("rejects forged internal calls and capabilities, disabled AI, and disclosure endpoints", async () => {
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/internal/events",
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await privacy.inject({
          method: "POST",
          url: "/internal/evidence",
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await privacy.inject({
          method: "POST",
          url: "/privacy/intake",
          headers: { origin, "x-csrf": "1" },
          payload: { consent: true, locale: "en", policyVersion: 1 },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await privacy.inject({
          method: "POST",
          url: "/privacy/intake",
          headers: { origin, "x-csrf": "1" },
          payload: { locale: "en", policyVersion: 1 },
        })
      ).statusCode,
    ).toBe(400);
    expect(() =>
      verifyCapability(
        receipt.capability + "bad",
        kp.publicKey.export({ type: "spki", format: "pem" }).toString(),
      ),
    ).toThrow();
    for (const path of [
      "/api/admin/reports",
      "/api/admin/reports/" + caseId + "/contact",
      "/privacy/reporter/original",
    ])
      expect((await call(path, undefined, cookies.admin)).statusCode).toBe(404);
  });
  it("offboards staff without allowing an outstanding password reset to reactivate them", async () => {
    const reset = token();
    await rows(
      caseStore.db,
      sql`insert into staff_tokens(staff_id,token_hash,purpose,expires_at) values(${ids.outsider},${digest(reset)},'password_reset',now()+interval '30 minutes')`,
    );
    const disabled = await call(
      "/api/admin/staff/" + ids.outsider,
      { active: false, role: "analyst", name: "outsider" },
      cookies.admin,
      "PATCH",
    );
    expect(disabled.statusCode).toBe(200);
    expect(
      (await call("/api/staff/me", undefined, cookies.outsider)).statusCode,
    ).toBe(401);
    expect(
      (await call("/api/staff/password/accept", { token: reset, password }))
        .statusCode,
    ).toBe(401);
    // Even a previously queued reset inserted after disable cannot bypass it.
    const late = token();
    await rows(
      caseStore.db,
      sql`insert into staff_tokens(staff_id,token_hash,purpose,expires_at) values(${ids.outsider},${digest(late)},'password_reset',now()+interval '30 minutes')`,
    );
    expect(
      (await call("/api/staff/password/accept", { token: late, password }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await call(
          "/api/admin/staff/" + ids.admin,
          { active: false, role: "admin", name: "admin" },
          cookies.admin,
          "PATCH",
        )
      ).statusCode,
    ).toBe(409);
  });
  it("does not delete a refreshed contact selected by an older retention scan", async () => {
    const result = await call("/api/reporter/reports", {
      title: "Retention race test report",
      summary:
        "Synthetic report checks that a changed contact is not deleted by a stale selection.",
      category: "fraud",
      privacyReviewed: true,
      policyVersion: 1,
    });
    expect(result.statusCode).toBe(201);
    const own = await call("/api/reporter/case", undefined, cookie(result));
    const contact = randomUUID();
    await rows(
      vault.db,
      sql`insert into contacts(id,case_id,kind,destination_enc,destination_hash,created_at) values(${contact},${own.json().id},'email',${seal("retention@example.test", vaultRing, "contact:" + contact)},${digest(token())},now()-interval '400 days')`,
    );
    const bridge = globalThis.fetch;
    vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
      if (String(args[0]).endsWith("/retention/lease"))
        await rows(
          vault.db,
          sql`update contacts set created_at=now() where id=${contact}`,
        );
      return bridge(...args);
    });
    try {
      await expirePrivate(vault.db, privacy.privacyDeps.config);
    } finally {
      vi.stubGlobal("fetch", bridge);
    }
    expect(
      await rows(vault.db, sql`select id from contacts where id=${contact}`),
    ).toHaveLength(1);
  });
  it("rejects approval of a different evidence version than the reporter reviewed", async () => {
    const result = await call("/api/reporter/reports", {
      title: "Evidence version approval test",
      summary:
        "Only the exact sanitized version reviewed by this reporter may be published.",
      category: "fraud",
      privacyReviewed: true,
      policyVersion: 1,
    });
    const view = await call("/api/reporter/case", undefined, cookie(result));
    const file = randomUUID(),
      current = digest("the new redacted version");
    await rows(
      vault.db,
      sql`insert into files(id,case_id,original_path,original_sha256,original_size,status,mime,size,pages,sha256,transformation) values(${file},${view.json().id},'sealed-original',${digest("original")},100,'review','image/png',100,1,${current},'rasterized;metadata_removed')`,
    );
    const stale = await privateCall(
      "/files/" + file + "/approve",
      { privacyReviewed: true, sha256: digest("earlier preview") },
      "POST",
      result.json().capability,
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error).toBe("preview_changed");
    expect(
      (
        await privateCall(
          "/files/" + file + "/approve",
          { privacyReviewed: true, sha256: current },
          "POST",
          result.json().capability,
        )
      ).statusCode,
    ).toBe(200);
  });
  it("rejects cross-case, expired and excessive OTP attempts without revealing a destination", async () => {
    const result = await call("/api/reporter/reports", {
      title: "OTP boundary test report",
      summary:
        "Synthetic report checks code expiry, case binding and aggregate attempt limits.",
      category: "fraud",
      privacyReviewed: true,
      policyVersion: 1,
    });
    expect(result.statusCode).toBe(201);
    const cap = result.json().capability;
    const own = await call("/api/reporter/case", undefined, cookie(result));
    const challenge = await privateCall(
      "/contacts/challenge",
      { kind: "email", destination: "boundary@example.test" },
      "POST",
      cap,
    );
    expect(challenge.statusCode).toBe(200);
    const challengeId = challenge.json().challengeId;
    const [job] = await rows(
      vault.db,
      sql`select * from delivery_jobs where case_id=${own.json().id} and kind='otp'`,
    );
    const body = unseal<{ code: string }>(
      String(job!.body_enc),
      vaultRing,
      "job:" + job!.id,
    );
    const otherCap = (
      await call("/api/reporter/capability", {}, reporterCookie)
    ).json().capability;
    const cross = await privateCall(
      "/contacts/verify",
      { challengeId, code: body.code },
      "POST",
      otherCap,
    );
    expect(cross.statusCode).toBe(400);
    expect(cross.body).not.toContain("boundary@example.test");
    await rows(
      vault.db,
      sql`update challenges set expires_at=now()-interval '1 second' where id=${challengeId}`,
    );
    expect(
      (
        await privateCall(
          "/contacts/verify",
          { challengeId, code: body.code },
          "POST",
          cap,
        )
      ).statusCode,
    ).toBe(400);
    const next = randomUUID();
    const [contact] = await rows(
      vault.db,
      sql`select id from contacts where case_id=${own.json().id}`,
    );
    await rows(
      vault.db,
      sql`insert into challenges(id,case_id,contact_id,code_hash,expires_at) values(${next},${own.json().id},${contact!.id},${mac(shared, next + ":123456")},now()+interval '5 minutes')`,
    );
    for (let attempt = 0; attempt < 4; attempt++)
      expect(
        (
          await privateCall(
            "/contacts/verify",
            { challengeId: next, code: "000000" },
            "POST",
            cap,
          )
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await privateCall(
          "/contacts/verify",
          { challengeId: next, code: "123456" },
          "POST",
          cap,
        )
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await rows(
          vault.db,
          sql`select verified_at from contacts where id=${contact!.id}`,
        )
      )[0]!.verified_at,
    ).toBeNull();
  });
  it("recognizes Zoho contact verification without SMTP and leaves SMS unavailable", async () => {
    counts.clear();
    const config = privacy.privacyDeps.config;
    const previous = config.email;
    try {
      const report = await call("/api/reporter/reports", {
        title: "Zoho provider configuration test",
        summary:
          "Synthetic report verifies email availability independently of the SMTP transport.",
        category: "fraud",
        privacyReviewed: true,
        policyVersion: 1,
      });
      expect(report.statusCode).toBe(201);
      const cap = report.json().capability;
      config.email = {
        provider: "zoho",
        apiKey: randomBytes(16).toString("hex"),
        from: "noreply@example.test",
      };
      const ops = await call("/api/admin/operations", undefined, cookies.admin);
      expect(ops.json().privacy.providers.email).toBe(true);
      expect(ops.json().privacy.providers.phone).toBe(false);
      const email = await privateCall(
        "/contacts/challenge",
        {
          kind: "email",
          destination: "zoho-fixture@example.test",
        },
        "POST",
        cap,
      );
      expect(email.statusCode).toBe(200);
      const phone = await privateCall(
        "/contacts/challenge",
        {
          kind: "phone",
          destination: "+628123456789",
        },
        "POST",
        cap,
      );
      expect(phone.statusCode).toBe(503);
      expect(phone.json().error).toBe("sms_unavailable");
      config.email = {
        provider: "zoho",
        apiKey: "",
        from: "noreply@example.test",
      };
      expect(
        (
          await privateCall(
            "/contacts/challenge",
            {
              kind: "email",
              destination: "missing-fixture@example.test",
            },
            "POST",
            cap,
          )
        ).statusCode,
      ).toBe(503);
      expect(
        (await call("/api/admin/operations", undefined, cookies.admin)).json()
          .privacy.providers.email,
      ).toBe(false);
    } finally {
      config.email = previous;
    }
  });
  it("provides safe administrator user details and preserves pending invitations during edits", async () => {
    counts.clear();
    const email = `invited-${randomUUID()}@example.test`;
    const invited = await call(
      "/api/admin/staff",
      {
        email: "  " + email.toUpperCase() + "  ",
        name: "Invited user",
        role: "analyst",
      },
      cookies.admin,
    );
    expect(invited.statusCode).toBe(200);
    const [staff] = await rows(
      caseStore.db,
      sql`select id from staff where email=${email}`,
    );
    const path = `/api/admin/staff/${staff!.id}`;
    const detail = await call(path, undefined, cookies.admin);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().staff).toMatchObject({
      email,
      name: "Invited user",
      role: "analyst",
      active: false,
      mfa_enrolled: false,
    });
    expect(Object.keys(detail.json().staff).sort()).toEqual(
      [
        "id",
        "email",
        "name",
        "role",
        "active",
        "mfa_enrolled",
        "created_at",
      ].sort(),
    );
    expect(
      (
        await call(
          "/api/admin/staff",
          { email, name: "Duplicate", role: "manager" },
          cookies.admin,
        )
      ).statusCode,
    ).toBe(409);
    for (const role of ["manager", "analyst"]) {
      expect((await call(path, undefined, cookies[role])).statusCode).toBe(403);
      expect(
        (await call(path + "/password-reset", {}, cookies[role])).statusCode,
      ).toBe(403);
      expect(
        (
          await call(
            "/api/admin/staff",
            {
              email: `blocked-${randomUUID()}@example.test`,
              name: "Blocked",
              role: "admin",
            },
            cookies[role],
          )
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await call(
            path,
            { name: "Blocked", role: "admin", active: true },
            cookies[role],
            "PATCH",
          )
        ).statusCode,
      ).toBe(403);
    }
    expect((await call(path)).statusCode).toBe(401);
    expect(
      (await call(`/api/admin/staff/${randomUUID()}`, undefined, cookies.admin))
        .statusCode,
    ).toBe(404);
    expect(
      (
        await call(
          `/api/admin/staff/${randomUUID()}/password-reset`,
          {},
          cookies.admin,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await call(path + "/password-reset", {}, cookies.admin)).json().error,
    ).toBe("staff_inactive");
    const pending = await rows(
      caseStore.db,
      sql`select body from jobs where staff_id=${staff!.id} and kind='staff_token'`,
    );
    const raw = unseal<string>(
      (pending[0]!.body as Record<string, string>).tokenEnc!,
      ring,
      "staff-token",
    );
    expect(
      (
        await call(
          path,
          { name: "Edited invite", role: "manager", active: false },
          cookies.admin,
          "PATCH",
        )
      ).statusCode,
    ).toBe(200);
    const remaining = await rows(
      caseStore.db,
      sql`select body from jobs where staff_id=${staff!.id} and kind='staff_token'`,
    );
    expect(remaining).toEqual(pending);
    expect(
      (await call("/api/staff/password/accept", { token: raw, password }))
        .statusCode,
    ).toBe(200);
    const updated = await call(path, undefined, cookies.admin);
    expect(updated.json().staff).toMatchObject({
      name: "Edited invite",
      role: "manager",
      active: true,
      mfa_enrolled: false,
      email,
    });
  });
  it("shares reset issuance, records the administrator, and revokes sessions only on password acceptance", async () => {
    counts.clear();
    const id = randomUUID(),
      email = `reset-${id}@example.test`,
      rawSession = token(),
      mfaEnc = seal("SYNTHETICMFASECRET", ring, "mfa:" + id);
    await rows(
      caseStore.db,
      sql`insert into staff(id,email,name,role,password_hash,mfa_enc) values(${id},${email},'Reset user','analyst',${await hashSecret(password)},${mfaEnc})`,
    );
    await rows(
      caseStore.db,
      sql`insert into staff_sessions(token_hash,staff_id,mfa,expires_at) values(${digest(rawSession)},${id},true,now()+interval '1 hour')`,
    );
    const path = `/api/admin/staff/${id}/password-reset`;
    const getRaw = async () => {
      const [job] = await rows(
        caseStore.db,
        sql`select body from jobs where staff_id=${id} and kind='staff_token'`,
      );
      expect(JSON.stringify(job!.body)).not.toContain(email);
      return unseal<string>(
        (job!.body as Record<string, string>).tokenEnc!,
        ring,
        "staff-token",
      );
    };
    expect((await call(path, {}, cookies.admin)).json()).toEqual({ ok: true });
    const first = await getRaw();
    const existingCookie = "wb_staff=" + rawSession;
    expect(
      (await call("/api/staff/me", undefined, existingCookie)).statusCode,
    ).toBe(200);
    const events = await rows(
      caseStore.db,
      sql`select actor_id,meta from audit_events where action='staff_password_reset_requested' and meta->>'staffId'=${id}`,
    );
    expect(events).toEqual([{ actor_id: ids.admin, meta: { staffId: id } }]);
    expect(
      (await call("/api/staff/password/request", { email })).statusCode,
    ).toBe(200);
    const second = await getRaw();
    expect(second).not.toBe(first);
    expect(
      (await call("/api/staff/password/accept", { token: first, password }))
        .statusCode,
    ).toBe(401);
    await rows(
      caseStore.db,
      sql`update staff_tokens set expires_at=now()-interval '1 second' where token_hash=${digest(second)}`,
    );
    expect(
      (await call("/api/staff/password/accept", { token: second, password }))
        .statusCode,
    ).toBe(401);
    expect((await call(path, {}, cookies.admin)).statusCode).toBe(200);
    const third = await getRaw(),
      newPassword = "A different test-only long password";
    expect(
      (
        await call("/api/staff/password/accept", {
          token: third,
          password: newPassword,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call("/api/staff/me", undefined, existingCookie)).statusCode,
    ).toBe(401);
    expect(
      (
        await call("/api/staff/password/accept", {
          token: third,
          password: newPassword,
        })
      ).statusCode,
    ).toBe(401);
    const [after] = await rows(
      caseStore.db,
      sql`select mfa_enc from staff where id=${id}`,
    );
    expect(after!.mfa_enc).toBe(mfaEnc);
    expect(
      (await call("/api/staff/login", { email, password })).statusCode,
    ).toBe(401);
    const login = await call("/api/staff/login", {
      email,
      password: newPassword,
    });
    expect(login.json().mfaEnrolled).toBe(true);
    expect(
      (await call(`/api/admin/staff/${id}`, undefined, cookie(login)))
        .statusCode,
    ).toBe(403);
  });
  it("shares destination reset limits between administrators and self-service recovery", async () => {
    counts.clear();
    const id = randomUUID(),
      email = `reset-limit-${id}@example.test`;
    await rows(
      caseStore.db,
      sql`insert into staff(id,email,name,role,password_hash) values(${id},${email},'Reset budget user','analyst',${await hashSecret(password)})`,
    );
    expect(
      (await call("/api/staff/password/request", { email })).statusCode,
    ).toBe(200);
    for (let n = 1; n < 10; n++)
      expect(
        (await call(`/api/admin/staff/${id}/password-reset`, {}, cookies.admin))
          .statusCode,
      ).toBe(200);
    expect(
      (await call(`/api/admin/staff/${id}/password-reset`, {}, cookies.admin))
        .statusCode,
    ).toBe(429);
    expect(
      (await call("/api/staff/password/request", { email })).statusCode,
    ).toBe(429);
    const [pending] = await rows(
      caseStore.db,
      sql`select count(*)::int n from staff_tokens where staff_id=${id} and used_at is null`,
    );
    expect(pending!.n).toBe(1);
  });
  it("enforces the gate for direct report and AI requests", async () => {
    const submission = {
      pin: token(),
      recoveryCode: token(),
      submissionToken: token(),
    };
    const r = await app.inject({
      url: "/api/reporter/reports",
      method: "POST",
      headers: { origin, "x-csrf": "1" },
      payload: {
        submission,
        title: "Blocked test report",
        summary:
          "A valid synthetic narrative that must not be submitted without employee verification.",
        category: "fraud",
        privacyReviewed: true,
        policyVersion: 1,
      },
    });
    expect(r.statusCode).toBe(401);
    expect(r.json().error).toBe("report_access_required");
    for (const path of [
      "/privacy/intake",
      "/privacy/intake/" + randomUUID() + "/messages",
      "/privacy/intake/" + randomUUID() + "/draft",
    ]) {
      const r = await privacy.inject({
        url: path,
        method: "POST",
        headers: { origin, "x-csrf": "1" },
        payload: {
          consent: true,
          locale: "en",
          policyVersion: 1,
          body: "Synthetic message",
        },
      });
      expect(r.statusCode).toBe(401);
    }
  });
  it("rejects unknown and inactive report emails without creating OTP jobs or access", async () => {
    counts.clear();
    const id = randomUUID(),
      email = `disabled-${id}@example.test`;
    await rows(
      vault.db,
      sql`insert into employees(id,email_hash,body_enc,active) values(${id},${mac(shared, "employee:" + email)},${seal({ name: "Disabled employee", email, phone: "+628123456789" }, vaultRing, "employee:" + id)},false)`,
    );
    const snapshot = async () => {
      const [r] = await rows(
        vault.db,
        sql`select (select count(*) from delivery_jobs where kind='admission_otp') jobs,(select count(*) from admission_challenges) challenges,(select count(*) from admission_grants) grants,(select count(*) from intakes) intakes`,
      );
      return r;
    };
    const before = await snapshot();
    for (const [address, status] of [
      [`unknown-${id}@example.test`, "unregistered"],
      [email, "disabled"],
    ]) {
      const r = await admission("challenge", {
        email: address,
        purpose: "report",
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ status });
    }
    expect(await snapshot()).toEqual(before);
  });
  it("verifies unregistered requests, approves atomically, and requires a fresh report OTP", async () => {
    const email = `request-${randomUUID()}@example.test`,
      employee = { name: "Access applicant", email, phone: "+628123456789" };
    const c = await admission("challenge", { email });
    expect(c.json()).toEqual({ status: "unregistered" });
    expect(
      (await admission("requests", { ...employee, requestToken: token() }))
        .statusCode,
    ).toBe(401);
    const otp = await admission("challenge", { email, purpose: "request" }),
      cid = otp.json().challengeId;
    const proof = await admission("verify", {
      challengeId: cid,
      code: await admissionCode(cid),
    });
    expect(proof.json().reportToken).toBeUndefined();
    expect(
      (
        await admission("requests", {
          ...employee,
          email: "different@example.test",
          requestToken: proof.json().requestToken,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await admission("requests", {
          ...employee,
          requestToken: proof.json().requestToken,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await admission("requests", {
          ...employee,
          requestToken: proof.json().requestToken,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await call("/api/admin/employee-requests", undefined, cookies.manager))
        .statusCode,
    ).toBe(403);
    const list = await call(
      "/api/admin/employee-requests",
      undefined,
      cookies.admin,
    );
    const request = list
      .json()
      .items.find((r: { email: string }) => r.email === email);
    expect(request.state).toBe("pending");
    const resolve = () =>
      call(
        `/api/admin/employee-requests/${request.id}/resolve`,
        { decision: "approved", employee },
        cookies.admin,
      );
    const outcomes = await Promise.all([resolve(), resolve()]);
    expect(outcomes.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const [stored] = await rows(
      vault.db,
      sql`select body_enc from employees where email_hash=${mac(shared, "employee:" + email)}`,
    );
    expect(stored!.body_enc).not.toContain(email);
    const decision = await rows(
      vault.db,
      sql`select id from delivery_jobs where kind='admission_decision'`,
    );
    expect(decision.length).toBeGreaterThan(0);
  });
  it("persists OTP attempts and rejects expiration, reuse, and disabled employees", async () => {
    const access = await verifiedAccess();
    const [c] = await rows(
      vault.db,
      sql`select id from admission_challenges where email_hash=${mac(shared, "employee:" + access.email)}`,
    );
    expect(
      (
        await admission("verify", {
          challengeId: c!.id,
          code: await admissionCode(String(c!.id)),
        })
      ).statusCode,
    ).toBe(400);
    const bad = await verifiedAccess();
    // Create an isolated challenge without resetting destination send limits.
    const cid = randomUUID();
    await rows(
      vault.db,
      sql`insert into admission_challenges(id,email_hash,email_enc,purpose,code_hash,locale,expires_at) values(${cid},${mac(shared, "employee:" + bad.email)},${seal(bad.email, vaultRing, "admission-challenge:" + cid)},'report',${mac(shared, cid + ":123456")},'en',now()+interval '5 minutes')`,
    );
    for (let i = 0; i < 5; i++)
      expect(
        (await admission("verify", { challengeId: cid, code: "000000" }))
          .statusCode,
      ).toBe(400);
    expect(
      (await admission("verify", { challengeId: cid, code: "123456" }))
        .statusCode,
    ).toBe(400);
    const [attempts] = await rows(
      vault.db,
      sql`select attempts from admission_challenges where id=${cid}`,
    );
    expect(attempts!.attempts).toBe(5);
    await rows(
      vault.db,
      sql`update admission_challenges set expires_at=now()-interval '1 second',attempts=0 where id=${cid}`,
    );
    expect(
      (await admission("verify", { challengeId: cid, code: "123456" }))
        .statusCode,
    ).toBe(400);
    const disabled = await call(
      `/api/admin/employees/${access.id}`,
      {
        name: "Disabled employee",
        email: access.email,
        phone: "+628123456789",
        active: false,
      },
      cookies.admin,
      "PUT",
    );
    expect(disabled.statusCode).toBe(200);
    expect(
      (await admission("challenge", { email: access.email })).json(),
    ).toEqual({ status: "disabled" });
    const r = await privacy.inject({
      url: "/privacy/intake",
      method: "POST",
      headers: { origin, "x-csrf": "1", "x-report-access": access.reportToken },
      payload: { consent: true, locale: "en", policyVersion: 1 },
    });
    expect(r.statusCode).toBe(401);
  });
  it("keeps published reports unlinkable to directory records and limits each grant to one submission", async () => {
    const access = await verifiedAccess(),
      submission = {
        pin: token(),
        recoveryCode: token(),
        submissionToken: token(),
      };
    const send = (credentials = submission) =>
      app.inject({
        url: "/api/reporter/reports",
        method: "POST",
        headers: {
          origin,
          "x-csrf": "1",
          "x-report-access": access.reportToken,
        },
        payload: {
          submission: credentials,
          title: "Anonymous employee report",
          summary:
            "A synthetic concern with no employee name or contact embedded in its content.",
          category: "fraud",
          privacyReviewed: true,
          policyVersion: 1,
        },
      });
    const r = await send();
    expect(r.statusCode).toBe(201);
    const retry = await send();
    expect(retry.statusCode).toBe(201);
    expect(retry.json().caseCode).toBe(r.json().caseCode);
    expect(
      (
        await send({
          pin: token(),
          recoveryCode: token(),
          submissionToken: token(),
        })
      ).statusCode,
    ).toBe(401);
    const [g] = await rows(
      vault.db,
      sql`select * from admission_grants where token_hash=${digest(access.reportToken)}`,
    );
    expect(g!.employee_id).toBeNull();
    const c = await call("/api/reporter/case", undefined, cookie(r));
    const safe = JSON.stringify(c.json());
    expect(safe).not.toContain(access.email);
    expect(safe).not.toContain(access.id);
    expect(safe).not.toContain(access.reportToken);
    expect(
      (await call("/api/admin/employees", undefined, cookies.analyst))
        .statusCode,
    ).toBe(403);
  });
  it("completes verified email admission, AI intake, draft, and anonymous submission", async () => {
    counts.clear();
    const bridge = globalThis.fetch;
    const aiApp = await buildPrivacy({
      db: vault.db,
      config: {
        ...privacy.privacyDeps.config,
        ai: {
          ...privacy.privacyDeps.config.ai,
          apiKey: "synthetic-fixture-key",
        },
      },
      limiter,
    });
    const [before] = await rows(
      caseStore.db,
      sql`select body from settings where id=1`,
    );
    await rows(
      caseStore.db,
      sql`update settings set body=jsonb_set(body,'{aiEnabled}','true'::jsonb) where id=1`,
    );
    const draft = {
      title: "Synthetic procurement concern",
      summary:
        "A synthetic procurement concern with sufficient detail for independent review.",
      category: "fraud",
      details: {},
    };
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string, opts: RequestInit) => {
      if (String(url).includes("api.minimax.io")) {
        calls++;
        const request = JSON.parse(String(opts.body));
        const content =
          request.max_tokens === 2048
            ? JSON.stringify({ draft, completeness: 80, missing: [] })
            : "Synthetic assistant response";
        return new Response(
          JSON.stringify({ choices: [{ message: { content } }] }),
          { status: 200 },
        );
      }
      return bridge(url, opts);
    });
    try {
      const access = await verifiedAccess();
      const headers = {
        origin,
        "x-csrf": "1",
        "x-report-access": access.reportToken,
      };
      const started = await aiApp.inject({
        url: "/privacy/intake",
        method: "POST",
        headers,
        payload: { consent: true, locale: "en", policyVersion: 1 },
      });
      expect(started.statusCode).toBe(200);
      const intake = started.json();
      const aiHeaders = { ...headers, authorization: "Bearer " + intake.token };
      const message = await aiApp.inject({
        url: `/privacy/intake/${intake.id}/messages`,
        method: "POST",
        headers: aiHeaders,
        payload: { body: draft.summary },
      });
      expect(message.statusCode).toBe(200);
      const assessed = await aiApp.inject({
        url: `/privacy/intake/${intake.id}/draft`,
        method: "POST",
        headers: aiHeaders,
        payload: {},
      });
      expect(assessed.statusCode).toBe(200);
      expect(assessed.json().draft.title).toBe(draft.title);
      expect(calls).toBe(2);
      const submitted = await app.inject({
        url: "/api/reporter/reports",
        method: "POST",
        headers,
        payload: {
          ...assessed.json().draft,
          submission: {
            pin: token(),
            recoveryCode: token(),
            submissionToken: token(),
          },
          policyVersion: 1,
          privacyReviewed: true,
          intakeId: intake.id,
          intakeToken: intake.token,
        },
      });
      expect(submitted.statusCode).toBe(201);
      const view = await call(
        "/api/reporter/case",
        undefined,
        cookie(submitted),
      );
      expect(view.statusCode).toBe(200);
      const [claimed] = await rows(
        vault.db,
        sql`select case_id from intakes where id=${intake.id}`,
      );
      expect(claimed!.case_id).toBe(view.json().id);
      const [grant] = await rows(
        vault.db,
        sql`select employee_id from admission_grants where token_hash=${digest(access.reportToken)}`,
      );
      expect(grant!.employee_id).toBeNull();
      expect(JSON.stringify(view.json())).not.toContain(access.email);
    } finally {
      vi.stubGlobal("fetch", bridge);
      await aiApp.close();
      await rows(
        caseStore.db,
        sql`update settings set body=${JSON.stringify(before!.body)}::jsonb where id=1`,
      );
    }
  });
  it("bounds AI work, resumes without resetting quotas, and denies concurrent or foreign grants", async () => {
    counts.clear();
    const bridge = globalThis.fetch,
      config = {
        ...privacy.privacyDeps.config,
        ai: {
          ...privacy.privacyDeps.config.ai,
          apiKey: "synthetic-fixture-key",
        },
      };
    const aiApp = await buildPrivacy({ db: vault.db, config, limiter });
    const [before] = await rows(
      caseStore.db,
      sql`select body from settings where id=1`,
    );
    await rows(
      caseStore.db,
      sql`update settings set body=jsonb_set(body,'{aiEnabled}','true'::jsonb) where id=1`,
    );
    let calls = 0,
      release: (() => void) | undefined,
      waitForAi = false;
    vi.stubGlobal("fetch", async (url: string, opts: RequestInit) => {
      if (String(url).includes("api.minimax.io")) {
        calls++;
        if (waitForAi)
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "Synthetic assistant response" } }],
          }),
          { status: 200 },
        );
      }
      return bridge(url, opts);
    });
    const aiCall = (
      path: string,
      body: unknown,
      reportToken: string,
      intakeToken?: string,
    ) =>
      aiApp.inject({
        url: "/privacy/intake" + path,
        method: "POST",
        headers: {
          origin,
          "x-csrf": "1",
          "x-report-access": reportToken,
          ...(intakeToken ? { authorization: "Bearer " + intakeToken } : {}),
        },
        payload: body as InjectOptions["payload"],
      });
    try {
      const access = await verifiedAccess(),
        foreign = await verifiedAccess();
      const started = await aiCall(
        "",
        { consent: true, locale: "en", policyVersion: 1 },
        access.reportToken,
      );
      expect(started.statusCode).toBe(200);
      const i = started.json();
      expect(
        (
          await aiCall(
            "",
            { consent: true, locale: "en", policyVersion: 1 },
            access.reportToken,
          )
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await aiCall(
            `/${i.id}/messages`,
            { body: "test" },
            foreign.reportToken,
            i.token,
          )
        ).statusCode,
      ).toBe(401);
      expect(calls).toBe(0);
      waitForAi = true;
      const running = aiCall(
        `/${i.id}/messages`,
        { body: "First question" },
        access.reportToken,
        i.token,
      );
      await vi.waitFor(() => expect(release).toBeDefined());
      expect(
        (await aiCall(`/${i.id}/draft`, {}, access.reportToken, i.token))
          .statusCode,
      ).toBe(409);
      expect(calls).toBe(1);
      waitForAi = false;
      release!();
      expect((await running).statusCode).toBe(200);
      expect(
        (await aiCall(`/${i.id}/draft`, {}, access.reportToken, i.token))
          .statusCode,
      ).toBe(500);
      const [charged] = await rows(
        vault.db,
        sql`select messages,drafts from admission_grants where token_hash=${digest(access.reportToken)}`,
      );
      expect(charged).toMatchObject({ messages: 1, drafts: 1 });
      await rows(
        vault.db,
        sql`update admission_grants set messages=30,drafts=3,expires_at=now()-interval '1 second' where token_hash=${digest(access.reportToken)}`,
      );
      expect(
        (
          await aiCall(
            `/${i.id}/messages`,
            { body: "Expired question" },
            access.reportToken,
            i.token,
          )
        ).statusCode,
      ).toBe(401);
      // A fresh proof of the same destination extends the existing grant, without new conversation or counters.
      const cid = randomUUID();
      await rows(
        vault.db,
        sql`insert into admission_challenges(id,email_hash,email_enc,purpose,code_hash,locale,expires_at) values(${cid},${mac(shared, "employee:" + access.email)},${seal(access.email, vaultRing, "admission-challenge:" + cid)},'report',${mac(shared, cid + ":123456")},'en',now()+interval '5 minutes')`,
      );
      const resumed = await admission("verify", {
        challengeId: cid,
        code: "123456",
        resumeToken: access.reportToken,
      });
      expect(resumed.json().reportToken).toBe(access.reportToken);
      for (const kind of ["messages", "draft"])
        expect(
          (
            await aiCall(
              `/${i.id}/${kind}`,
              { body: "Beyond quota" },
              access.reportToken,
              i.token,
            )
          ).statusCode,
        ).toBe(429);
      expect(calls).toBe(3);
      const [g] = await rows(
        vault.db,
        sql`select messages,drafts from admission_grants where token_hash=${digest(access.reportToken)}`,
      );
      expect(g).toMatchObject({ messages: 30, drafts: 3 });
    } finally {
      release?.();
      await aiApp.close();
      vi.stubGlobal("fetch", bridge);
      await rows(
        caseStore.db,
        sql`update settings set body=${JSON.stringify(before!.body)}::jsonb where id=1`,
      );
    }
  });
  it("normalizes directory emails, revokes edited addresses, and never approves over a disabled employee", async () => {
    counts.clear();
    const access = await verifiedAccess(),
      normalized = access.email.toUpperCase();
    expect(
      (
        await call(
          "/api/admin/employees",
          {
            name: "Duplicate",
            email: " " + normalized + " ",
            phone: "+628123456789",
          },
          cookies.admin,
        )
      ).statusCode,
    ).toBe(409);
    const updatedEmail = `updated-${randomUUID()}@example.test`;
    expect(
      (
        await call(
          `/api/admin/employees/${access.id}`,
          {
            name: "Updated employee",
            email: updatedEmail,
            phone: "+628123456789",
            active: false,
          },
          cookies.admin,
          "PUT",
        )
      ).statusCode,
    ).toBe(200);
    const [g] = await rows(
      vault.db,
      sql`select employee_id,revoked_at from admission_grants where token_hash=${digest(access.reportToken)}`,
    );
    expect(g!.employee_id).toBeNull();
    expect(g!.revoked_at).not.toBeNull();
    expect(
      (await admission("challenge", { email: access.email })).json().status,
    ).toBe("unregistered");
    expect(
      (await admission("challenge", { email: updatedEmail })).json().status,
    ).toBe("disabled");
    const requestId = randomUUID(),
      employee = {
        name: "Applicant",
        email: updatedEmail,
        phone: "+628123456789",
      };
    await rows(
      vault.db,
      sql`insert into employee_requests(id,email_hash,body_enc,locale) values(${requestId},${mac(shared, "employee:" + updatedEmail)},${seal(employee, vaultRing, "employee-request:" + requestId)},'id')`,
    );
    const resolve = (decision: string) =>
      call(
        `/api/admin/employee-requests/${requestId}/resolve`,
        { decision },
        cookies.admin,
      );
    expect((await resolve("approved")).statusCode).toBe(409);
    expect((await resolve("rejected")).statusCode).toBe(200);
    expect((await resolve("rejected")).statusCode).toBe(409);
    const [e] = await rows(
      vault.db,
      sql`select active from employees where id=${access.id}`,
    );
    expect(e!.active).toBe(false);
    const jobs = await rows(
      vault.db,
      sql`select id,body_enc from delivery_jobs where kind='admission_decision'`,
    );
    const body = jobs
      .map((j) =>
        unseal<Record<string, unknown>>(
          String(j.body_enc),
          vaultRing,
          "job:" + j.id,
        ),
      )
      .find((b) => b.destination === updatedEmail);
    expect(body).toMatchObject({ decision: "rejected", locale: "id" });
    const auditJobs = await rows(
      vault.db,
      sql`select id,body_enc from delivery_jobs where kind='directory_audit'`,
    );
    for (const job of auditJobs) {
      const event = unseal<Record<string, unknown>>(
        String(job.body_enc),
        vaultRing,
        "job:" + job.id,
      );
      expect(event).not.toHaveProperty("caseId");
      expect(JSON.stringify(event)).not.toContain(updatedEmail);
    }
  });
  it("retries a reserved report after a failed case commit and refuses a second concurrent submission", async () => {
    counts.clear();
    const access = await verifiedAccess(),
      submission = {
        pin: token(),
        recoveryCode: token(),
        submissionToken: token(),
      },
      hash = digest(submission.submissionToken),
      hex = hash.slice(0, 32),
      id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
    // Simulate the cross-service boundary: the privacy reservation commits while the case transaction fails.
    const path = "admission/reserve",
      stamp = Date.now().toString(),
      body = {
        reportToken: access.reportToken,
        submissionHash: hash,
        caseId: id,
      };
    expect(
      (
        await privacy.inject({
          url: "/internal/" + path,
          method: "POST",
          payload: body,
          headers: {
            "x-service-time": stamp,
            "x-service-signature": mac(
              shared,
              stamp + ":" + path + ":" + JSON.stringify(body),
            ),
          },
        })
      ).statusCode,
    ).toBe(200);
    const send = (credentials: typeof submission) =>
      app.inject({
        url: "/api/reporter/reports",
        method: "POST",
        headers: {
          origin,
          "x-csrf": "1",
          "x-report-access": access.reportToken,
        },
        payload: {
          submission: credentials,
          title: "Interrupted submission test",
          summary:
            "A privacy reservation can survive an interrupted transaction in the case database.",
          category: "fraud",
          privacyReviewed: true,
          policyVersion: 1,
        },
      });
    const results = await Promise.all([
      send(submission),
      send({ pin: token(), recoveryCode: token(), submissionToken: token() }),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([201, 401]);
    expect((await send(submission)).statusCode).toBe(201);
    expect(
      await rows(
        caseStore.db,
        sql`select id from cases where submission_hash=${hash}`,
      ),
    ).toHaveLength(1);
  });
  it("chains concurrent audit events and makes history immutable", async () => {
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        rows(
          caseStore.db,
          sql`insert into audit_events(actor_id,action,meta) values('test','concurrent',${JSON.stringify({ i })}::jsonb)`,
        ),
      ),
    );
    const list = await rows(
      caseStore.db,
      sql`select * from audit_events order by seq`,
    );
    for (let i = 1; i < list.length; i++)
      expect(list[i]!.previous_hash).toBe(list[i - 1]!.hash);
    await expect(
      rows(caseStore.db, sql`delete from audit_events`),
    ).rejects.toThrow();
  });
});
