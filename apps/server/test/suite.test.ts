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
async function call(
  path: string,
  body?: unknown,
  cookie?: string,
  method?: string,
) {
  return app.inject({
    url: path,
    method: (method ??
      (body === undefined ? "GET" : "POST")) as InjectOptions["method"],
    payload: body as InjectOptions["payload"],
    headers: { origin, "x-csrf": "1", ...(cookie ? { cookie } : {}) },
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
    ).toBe(503);
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
    ).toBe(409);
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
