import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import {
  readFile,
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { generate, generateSecret } from "otplib";
import type { FastifyInstance, InjectOptions } from "fastify";
import { digest, hashSecret, seal, unseal } from "@whistle/runtime";
import { createDb, rows } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/app.js";
import type { GoogleIdentity } from "../src/google-oidc.js";

const origin = "http://localhost:9551",
  password = "Synthetic staff password for Google tests";
const ring = { active: "a", keys: { a: randomBytes(32).toString("base64") } };
let store: ReturnType<typeof createDb>,
  app: FastifyInstance,
  disabled: FastifyInstance,
  initializedHash: string;
let identity: GoogleIdentity;
const exchange = vi.fn(
  async (_code: string, _verifier: string, _nonce: string) => identity,
);
const limits = new Map<string, number>();
const limiter = {
  async hit(key: string, max: number) {
    const n = (limits.get(key) ?? 0) + 1;
    limits.set(key, n);
    return n <= max;
  },
};
const legacyIds = Array.from({ length: 5 }, randomUUID);

beforeAll(async () => {
  const ownerUrl = (
    await readFile(
      new URL("../../../.suite-dev/test-database-url", import.meta.url),
      "utf8",
    )
  ).trim();
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await owner.unsafe(
    "DROP DATABASE IF EXISTS whistle_google_test WITH (FORCE)",
  );
  await owner.unsafe("CREATE DATABASE whistle_google_test");
  await owner.end();
  const url = ownerUrl.replace(/\/postgres$/, "/whistle_google_test");
  initializedHash = await hashSecret(password);
  // Upgrade an actual pre-feature database, rather than testing only an empty schema.
  const migrations = new URL("../src/db/migrations/", import.meta.url);
  const baseline = await mkdtemp(join(tmpdir(), "wb-google-migrations-"));
  const connection = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const journal = JSON.parse(
      await readFile(new URL("meta/_journal.json", migrations), "utf8"),
    );
    journal.entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 6,
    );
    await mkdir(join(baseline, "meta"));
    await writeFile(
      join(baseline, "meta/_journal.json"),
      JSON.stringify(journal),
    );
    for (const entry of journal.entries)
      await copyFile(
        new URL(entry.tag + ".sql", migrations),
        join(baseline, entry.tag + ".sql"),
      );
    await migrate(drizzle(connection), { migrationsFolder: baseline });
    for (const [i, id] of legacyIds.entries()) {
      await connection`insert into staff(id,email,name,role,password_hash) values(${id},${`legacy-${i}@gmail.com`},'Legacy','analyst',${initializedHash})`;
      if (i === 0)
        await connection`insert into audit_events(actor_id,action,meta) values('bootstrap','staff_bootstrapped',${JSON.stringify({ staffId: id })}::jsonb)`;
      if (i > 0 && i < 4)
        await connection`insert into audit_events(actor_id,action) values(${id},${["", "invitation_accepted", "password_reset", "staff_password_authenticated"][i]!})`;
    }
  } finally {
    await connection.end();
    await rm(baseline, { recursive: true });
  }
  await runMigrations(url);
  store = createDb(url);
  const env = {
    NODE_ENV: "test",
    PUBLIC_WEB_URL: origin,
    SUITE_DATABASE_URL: url,
    CASE_KEYRING: JSON.stringify(ring),
    CAPABILITY_PRIVATE_KEY: "synthetic",
    SERVICE_EVENT_KEY: "synthetic",
    ABUSE_KEY: "synthetic",
  };
  disabled = await buildApp({ db: store.db, config: loadConfig(env), limiter });
  app = await buildApp({
    db: store.db,
    limiter,
    google: { exchange },
    config: loadConfig({
      ...env,
      STAFF_GOOGLE_CLIENT_ID: "test-client",
      STAFF_GOOGLE_CLIENT_SECRET: "test-secret",
    }),
  });
});
beforeEach(() => {
  limits.clear();
  exchange.mockClear();
});
afterAll(async () => {
  await app?.close();
  await disabled?.close();
  await store?.close();
});

function cookie(
  response: { headers: { [key: string]: unknown } },
  name: string,
) {
  const values = response.headers["set-cookie"];
  return (
    (Array.isArray(values) ? values : [values])
      .find((v) => typeof v === "string" && v.startsWith(name + "="))
      ?.split(";")[0] ?? ""
  );
}
function call(path: string, body?: unknown, staffCookie?: string) {
  return app.inject({
    url: path,
    method: body === undefined ? "GET" : "POST",
    payload: body as InjectOptions["payload"],
    headers: {
      origin,
      "x-csrf": "1",
      ...(staffCookie ? { cookie: staffCookie } : {}),
    },
  });
}
async function staff(
  options: {
    active?: boolean;
    initialized?: boolean;
    enrolled?: boolean;
    email?: string;
  } = {},
) {
  const id = randomUUID(),
    email = options.email ?? `${id}@gmail.com`,
    sub = "sub-" + id,
    secret = generateSecret();
  await rows(
    store.db,
    sql`insert into staff(id,email,name,role,password_hash,password_initialized,active,mfa_enc) values(${id},${email},'Google staff','analyst',${initializedHash},${options.initialized ?? true},${options.active ?? true},${options.enrolled === false ? null : seal(secret, ring, "mfa:" + id)})`,
  );
  identity = { sub, email, authoritativeEmail: true };
  return { id, email, sub, secret };
}
async function start(next: string | null = "/staff/account") {
  const response = await call("/api/staff/google/start", { next });
  expect(response.statusCode).toBe(200);
  const url = new URL(response.json().authorizationUrl);
  return {
    state: url.searchParams.get("state")!,
    browser: cookie(response, "wb_staff_google"),
    url,
    response,
  };
}
async function callback(
  flow: Awaited<ReturnType<typeof start>>,
  suffix = "&code=synthetic-code",
  browser = flow.browser,
) {
  return app.inject({
    url: `/api/staff/google/callback?state=${flow.state}${suffix}`,
    headers: { ...(browser ? { cookie: browser } : {}) },
  });
}
async function field(id: string) {
  return (await rows(store.db, sql`select * from staff where id=${id}`))[0]!;
}

describe("staff Google login", () => {
  it("backfills completed onboarding from existing audit evidence, leaving unknown onboarding ineligible", async () => {
    for (const [i, id] of legacyIds.entries())
      expect((await field(id)).password_initialized).toBe(i < 4);
  });
  it("advertises availability and keeps password login usable when Google is disabled", async () => {
    expect((await call("/api/staff/login/options")).json()).toEqual({
      googleEnabled: true,
    });
    expect((await disabled.inject("/api/staff/login/options")).json()).toEqual({
      googleEnabled: false,
    });
    const result = await disabled.inject({
      url: "/api/staff/google/start",
      method: "POST",
      payload: {},
      headers: { origin, "x-csrf": "1" },
    });
    expect(result.statusCode).toBe(503);
    const user = await staff({ initialized: false });
    expect(
      (await call("/api/staff/login", { email: user.email, password }))
        .statusCode,
    ).toBe(200);
    expect((await field(user.id)).password_initialized).toBe(true);
  });
  it("requires a same-origin CSRF-protected start, binds the browser, and stores an encrypted verifier", async () => {
    for (const headers of [
      {},
      { origin: "https://evil.test", "x-csrf": "1" },
    ]) {
      expect(
        (
          await app.inject({
            url: "/api/staff/google/start",
            method: "POST",
            payload: {},
            headers,
          })
        ).statusCode,
      ).toBe(403);
    }
    const flow = await start("https://evil.test/staff");
    const header = flow.response.headers["set-cookie"] as string;
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/api/staff/google");
    const [transaction] = await rows(
      store.db,
      sql`select * from staff_google_transactions where state_hash=${digest(flow.state)}`,
    );
    expect(transaction!.return_path).toBe("/staff");
    expect(transaction!.state_hash).not.toBe(flow.state);
    const verifier = unseal<string>(
      String(transaction!.verifier_enc),
      ring,
      "google:" + digest(flow.state),
    );
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      flow.url.searchParams.get("code_challenge"),
    );
    expect(flow.url.href).not.toContain("test-secret");
  });
  it("gives an existing staff member only a pre-MFA session and binds Google after TOTP", async () => {
    const user = await staff();
    const flow = await start();
    const result = await callback(flow);
    expect(result.headers.location).toBe(
      "/staff/login?google=continue&next=%2Fstaff%2Faccount",
    );
    const pre = cookie(result, "wb_staff");
    expect(result.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringContaining("SameSite=Strict")]),
    );
    expect((await call("/api/staff/me", undefined, pre)).json()).toMatchObject({
      mfaEnrolled: true,
      mfaVerified: false,
    });
    expect((await call("/api/staff/sessions", undefined, pre)).statusCode).toBe(
      403,
    );
    expect((await field(user.id)).google_sub).toBeNull();
    expect(exchange).toHaveBeenCalledWith(
      "synthetic-code",
      expect.any(String),
      flow.url.searchParams.get("nonce"),
    );
    const confirmed = await call(
      "/api/staff/mfa/confirm",
      { code: await generate({ secret: user.secret }) },
      pre,
    );
    expect(confirmed.statusCode).toBe(200);
    expect((await field(user.id)).google_sub).toBe(user.sub);
    expect(
      (
        await call("/api/staff/me", undefined, cookie(confirmed, "wb_staff"))
      ).json().mfaVerified,
    ).toBe(true);
    expect((await call("/api/staff/me", undefined, pre)).statusCode).toBe(401);
    const events = await rows(
      store.db,
      sql`select action from audit_events where actor_id=${user.id}`,
    );
    expect(events.map((e) => e.action)).toEqual(
      expect.arrayContaining([
        "staff_google_authenticated",
        "staff_google_linked",
        "staff_mfa_authenticated",
      ]),
    );
    expect(
      (await call("/api/staff/login", { email: user.email, password }))
        .statusCode,
    ).toBe(200);
  });
  it("keeps MFA enrollment and recovery-code display mandatory before first binding", async () => {
    const user = await staff({
      enrolled: false,
      email: `${randomUUID()}@workspace.test`,
    });
    const pre = cookie(await callback(await start()), "wb_staff");
    expect((await call("/api/staff/sessions", undefined, pre)).statusCode).toBe(
      403,
    );
    const enroll = await call("/api/staff/mfa/enroll", {}, pre);
    expect(enroll.statusCode).toBe(200);
    expect(
      (await call("/api/staff/mfa/confirm", { code: "invalid" }, pre))
        .statusCode,
    ).toBe(401);
    expect((await field(user.id)).google_sub).toBeNull();
    const result = await call(
      "/api/staff/mfa/confirm",
      { code: await generate({ secret: enroll.json().secret }) },
      pre,
    );
    expect(result.statusCode).toBe(200);
    expect(result.json().recoveryCodes).toHaveLength(8);
    expect((await field(user.id)).google_sub).toBe(user.sub);
  });
  it("permits single-use local recovery codes after Google authentication", async () => {
    const user = await staff();
    await rows(
      store.db,
      sql`insert into staff_recovery(staff_id,secret_hash) values(${user.id},${await hashSecret("synthetic-recovery")})`,
    );
    const pre = cookie(await callback(await start()), "wb_staff");
    const result = await call(
      "/api/staff/mfa/confirm",
      { code: "synthetic-recovery" },
      pre,
    );
    expect(result.statusCode).toBe(200);
    expect((await field(user.id)).google_sub).toBe(user.sub);
    const secondPre = cookie(await callback(await start()), "wb_staff");
    expect(
      (
        await call(
          "/api/staff/mfa/confirm",
          { code: "synthetic-recovery" },
          secondPre,
        )
      ).statusCode,
    ).toBe(401);
  });
  it.each([
    "unknown",
    "inactive",
    "pending",
    "admin-enabled-pending",
    "third-party",
  ])("rejects %s accounts without creating staff or sessions", async (kind) => {
    const user = await staff({
      active: kind !== "inactive" && kind !== "pending",
      initialized: kind !== "pending" && kind !== "admin-enabled-pending",
    });
    if (kind === "unknown") identity.email = `${randomUUID()}@gmail.com`;
    if (kind === "third-party") identity.authoritativeEmail = false;
    const [before] = await rows(
      store.db,
      sql`select count(*)::int n from staff`,
    );
    const result = await callback(await start());
    expect(result.headers.location).toContain("googleError=google_ineligible");
    expect(cookie(result, "wb_staff")).toBe("");
    expect((await field(user.id)).google_sub).toBeNull();
    const [after] = await rows(
      store.db,
      sql`select count(*)::int n from staff`,
    );
    expect(after!.n).toBe(before!.n);
  });
  it("uses an existing sub despite email changes and never replaces a binding through email matching", async () => {
    const user = await staff();
    await rows(
      store.db,
      sql`update staff set google_sub=${user.sub} where id=${user.id}`,
    );
    identity.email = "changed@external.test";
    identity.authoritativeEmail = false;
    expect((await callback(await start())).headers.location).toContain(
      "google=continue",
    );
    identity = {
      sub: "different-" + user.sub,
      email: user.email,
      authoritativeEmail: true,
    };
    expect((await callback(await start())).headers.location).toContain(
      "googleError=google_ineligible",
    );
    expect((await field(user.id)).google_sub).toBe(user.sub);
  });
  it("does not fall back to email when the Google identity belongs to a disabled staff account", async () => {
    const original = await staff({ active: false });
    await rows(
      store.db,
      sql`update staff set google_sub=${original.sub} where id=${original.id}`,
    );
    const other = await staff();
    identity = {
      sub: original.sub,
      email: other.email,
      authoritativeEmail: true,
    };
    expect((await callback(await start())).headers.location).toContain(
      "googleError=google_ineligible",
    );
  });
  it("rejects absent or mismatched browser cookies without consuming another browser's transaction", async () => {
    await staff();
    const flow = await start();
    for (const browser of ["", "wb_staff_google=wrong-browser"]) {
      expect(
        (await callback(flow, "&code=synthetic-code", browser)).headers
          .location,
      ).toContain("googleError=google_expired");
    }
    expect(exchange).not.toHaveBeenCalled();
    expect((await callback(flow)).headers.location).toContain(
      "google=continue",
    );
  });
  it("expires transactions and rejects callback replay", async () => {
    await staff();
    const flow = await start();
    await rows(
      store.db,
      sql`update staff_google_transactions set expires_at=now()-interval '1 second' where state_hash=${digest(flow.state)}`,
    );
    expect((await callback(flow)).headers.location).toContain(
      "googleError=google_expired",
    );
    expect(exchange).not.toHaveBeenCalled();
    const valid = await start();
    expect((await callback(valid)).headers.location).toContain(
      "google=continue",
    );
    expect((await callback(valid)).headers.location).toContain(
      "googleError=google_expired",
    );
    expect(exchange).toHaveBeenCalledTimes(1);
  });
  it("consumes cancellation and malformed provider responses, preserving a safe deep link", async () => {
    await staff();
    const next = `/staff/cases/${randomUUID()}/evidence?view=list`;
    const flow = await start(next);
    const result = await callback(
      flow,
      "&error=access_denied&error_description=sensitive-provider-data",
    );
    expect(result.headers.location).toBe(
      `/staff/login?googleError=google_cancelled&next=${encodeURIComponent(next)}`,
    );
    expect(result.headers.location).not.toContain("sensitive-provider-data");
    expect((await callback(flow)).headers.location).toContain(
      "googleError=google_expired",
    );
    for (const suffix of ["", "&error=provider-failure", "&code=a&code=b"]) {
      expect(
        (await callback(await start(), suffix)).headers.location,
      ).toContain("googleError=");
    }
    expect(exchange).not.toHaveBeenCalled();
  });
  it("handles provider failures without exposing secrets and makes the failed transaction unusable", async () => {
    await staff();
    const flow = await start();
    exchange.mockRejectedValueOnce(
      new Error("sensitive-google-secret-and-token"),
    );
    const result = await callback(flow);
    expect(result.headers.location).toContain("googleError=google_failed");
    expect(result.headers.location).not.toContain("sensitive");
    const events = await rows(
      store.db,
      sql`select meta from audit_events where action='staff_google_login_failed'`,
    );
    expect(JSON.stringify(events)).not.toContain("sensitive-google");
    expect((await callback(flow)).headers.location).toContain(
      "googleError=google_expired",
    );
  });
  it("checks activity after the provider exchange and rejects revoked pre-MFA sessions", async () => {
    const user = await staff();
    exchange.mockImplementationOnce(async () => {
      await rows(
        store.db,
        sql`update staff set active=false where id=${user.id}`,
      );
      return identity;
    });
    expect((await callback(await start())).headers.location).toContain(
      "googleError=google_ineligible",
    );
    await rows(store.db, sql`update staff set active=true where id=${user.id}`);
    const pre = cookie(await callback(await start()), "wb_staff");
    await call("/api/staff/logout", {}, pre);
    expect(
      (
        await call(
          "/api/staff/mfa/confirm",
          { code: await generate({ secret: user.secret }) },
          pre,
        )
      ).statusCode,
    ).toBe(401);
    expect((await field(user.id)).google_sub).toBeNull();
  });
  it("rejects identity conflicts introduced between callback and MFA", async () => {
    const user = await staff();
    const pre = cookie(await callback(await start()), "wb_staff");
    const other = await staff();
    await rows(
      store.db,
      sql`update staff set google_sub=${user.sub} where id=${other.id}`,
    );
    const result = await call(
      "/api/staff/mfa/confirm",
      { code: await generate({ secret: user.secret }) },
      pre,
    );
    expect(result.statusCode).toBe(401);
    expect(result.json().error).toBe("google_ineligible");
    expect((await field(user.id)).google_sub).toBeNull();
  });
  it("allows only one concurrent MFA completion, rotating away both pending sessions", async () => {
    const user = await staff();
    const pre1 = cookie(await callback(await start()), "wb_staff");
    const pre2 = cookie(await callback(await start()), "wb_staff");
    const code = await generate({ secret: user.secret });
    const results = await Promise.all([
      call("/api/staff/mfa/confirm", { code }, pre1),
      call("/api/staff/mfa/confirm", { code }, pre2),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    expect((await field(user.id)).google_sub).toBe(user.sub);
  });
  it("limits Google starts and rejects an expired pre-MFA session", async () => {
    const user = await staff();
    const flow = await start();
    const pre = cookie(await callback(flow), "wb_staff");
    await rows(
      store.db,
      sql`update staff_sessions set expires_at=now()-interval '1 second' where staff_id=${user.id}`,
    );
    expect(
      (
        await call(
          "/api/staff/mfa/confirm",
          { code: await generate({ secret: user.secret }) },
          pre,
        )
      ).statusCode,
    ).toBe(401);
    for (let i = 1; i < 10; i++) await start();
    expect((await call("/api/staff/google/start", {})).statusCode).toBe(429);
  });
});
