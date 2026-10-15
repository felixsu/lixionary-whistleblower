import {
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { digest, postgresLimiter } from "@whistle/runtime";
import type { StaffIdentity } from "@whistle/shared";
import { loadJiraConfig } from "../src/jira-config.js";
import { createJiraClient } from "../src/jira.js";
import { loadConfig } from "../src/config.js";
import { createDb, rows } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { buildApp } from "../src/app.js";

const web = "http://localhost:9551";
const secret = "synthetic-jira-secret-" + "x".repeat(32);
const env = {
  JIRA_URL: "https://jira.example.test",
  JIRA_CLIENT_ID: "synthetic-client",
  JIRA_CLIENT_SECRET: secret,
};
const config = loadJiraConfig(env, web)!;
const staff: StaffIdentity = {
  id: randomUUID(),
  name: "Synthetic administrator",
  email: "admin@example.test",
  role: "admin",
  mfaEnrolled: true,
};
const board = {
  project: { key: "LWB", name: "Whistleblower", archived: false },
  columns: [
    {
      status: "pending" as const,
      total: 26,
      nextOffset: 25,
      cards: [
        {
          key: "LWB-1",
          title: "Synthetic feature",
          type: "feature_request" as const,
          status: "pending" as const,
          resolution: null,
          externalReporter: { email: "private@example.test" },
          description: "not sent to the browser",
        },
      ],
    },
  ],
};
const launch = () => ({
  launchUrl: `${config.baseUrl}/intake?code=synthetic-launch-secret`,
  origin: config.baseUrl,
  expiresAt: new Date(Date.now() + 60000).toISOString(),
});

describe("Jira configuration", () => {
  it("is optional and validates enabled credentials, origins, and LWB", async () => {
    expect(loadJiraConfig({}, web)).toBeUndefined();
    expect(loadJiraConfig({ ...env, JIRA_URL: "" }, web)).toBeUndefined();
    expect(config.returnOrigin).toBe(web);
    for (const bad of [
      { JIRA_URL: "https://jira.example.test/path" },
      { JIRA_URL: "https://user:pass@jira.example.test" },
      { JIRA_URL: "https://jira.example.test?token=secret" },
      { JIRA_URL: "http://external.example.test" },
      { JIRA_CLIENT_ID: "" },
      { JIRA_CLIENT_SECRET: "short" },
      { JIRA_PROJECT_KEY: "LDF" },
    ])
      expect(() => loadJiraConfig({ ...env, ...bad }, web)).toThrow();
    expect(() =>
      loadJiraConfig({ ...env, NODE_ENV: "production" }, web),
    ).toThrow();
    expect(() =>
      loadJiraConfig(
        { ...env, NODE_ENV: "production", JIRA_URL: "http://localhost:6310" },
        "https://reports.example.test",
      ),
    ).toThrow();
    const root = await mkdtemp(join(tmpdir(), "wb-jira-"));
    try {
      const file = join(root, "secret");
      await writeFile(file, secret + "\n", { mode: 0o600 });
      expect(
        loadJiraConfig(
          {
            ...env,
            JIRA_CLIENT_SECRET: "wrong",
            JIRA_CLIENT_SECRET_FILE: file,
          },
          web,
        )?.clientSecret,
      ).toBe(secret);
      await writeFile(file, "");
      expect(() =>
        loadJiraConfig({ ...env, JIRA_CLIENT_SECRET_FILE: file }, web),
      ).toThrow();
    } finally {
      await rm(root, { recursive: true });
    }
  });
});

describe("Jira HTTP client", () => {
  let server: Server;
  let baseUrl: string;
  let calls: {
    path: string;
    body: Record<string, any>;
    authorization?: string;
  }[];
  let refusal: number;
  let malformed: boolean;
  beforeAll(async () => {
    server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const path = req.url!;
      const body =
        path === "/oauth/token"
          ? Object.fromEntries(new URLSearchParams(raw))
          : JSON.parse(raw);
      calls.push({ path, body, authorization: req.headers.authorization });
      res.setHeader("Content-Type", "application/json");
      if (path === "/oauth/token")
        return res.end(
          JSON.stringify({
            access_token: `token-${calls.filter((c) => c.path === path).length}`,
            expires_in: 3600,
          }),
        );
      if (refusal) {
        res.statusCode = refusal;
        if (refusal === 401) refusal = 0;
        return res.end(
          JSON.stringify({ error: { code: "forbidden", message: secret } }),
        );
      }
      if (malformed) return res.end("not-json " + secret);
      const result = path.endsWith("get_board")
        ? board
        : {
            ...launch(),
            origin: baseUrl,
            launchUrl: `${baseUrl}/intake?code=synthetic`,
          };
      res.end(JSON.stringify({ result }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(() => {
    calls = [];
    refusal = 0;
    malformed = false;
  });
  afterEach(() => vi.useRealTimers());
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  it("uses OAuth, shares cached tokens, minimizes reporter and board data, and pages columns", async () => {
    const client = createJiraClient({ ...config, baseUrl });
    const [first] = await Promise.all([
      client.board({}),
      client.board({ column: "pending", offset: 25 }),
    ]);
    await client.launch("issue", { ...staff, name: "x".repeat(150) });
    expect(calls.filter((c) => c.path === "/oauth/token")).toHaveLength(1);
    expect(calls[0]!.body).toEqual({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: secret,
    });
    expect(calls.find((c) => c.body.offset === 25)?.body).toEqual({
      projectKey: "LWB",
      column: "pending",
      offset: 25,
      limit: 25,
    });
    expect(calls.at(-1)!.body).toEqual({
      projectKey: "LWB",
      type: "issue",
      returnOrigin: web,
      reporter: { externalId: staff.id, displayName: "x".repeat(120) },
    });
    expect(
      calls.slice(1).every((c) => c.authorization === "Bearer token-1"),
    ).toBe(true);
    expect(JSON.stringify(first)).not.toContain("private@example.test");
    expect(JSON.stringify(first)).not.toContain("not sent to the browser");
  });
  it("refreshes before expiry and once after 401", async () => {
    let now = Date.now();
    const client = createJiraClient({ ...config, baseUrl }, { now: () => now });
    await client.board({});
    now += 3540001;
    await client.board({});
    refusal = 401;
    await client.board({});
    expect(calls.filter((c) => c.path === "/oauth/token")).toHaveLength(3);
  });
  it("does not retry other errors or expose provider responses", async () => {
    const client = createJiraClient({ ...config, baseUrl });
    refusal = 403;
    await expect(client.board({})).rejects.toThrow(/^Jira unavailable$/);
    expect(calls).toHaveLength(2);
    refusal = 0;
    malformed = true;
    await expect(client.board({})).rejects.toThrow(/^Jira unavailable$/);
  });
  it("bounds 401 retries and rejects token, envelope, and launch failures", async () => {
    const failures = [
      {
        tokenFailure: true,
        response: new Response("sensitive-token-error", { status: 500 }),
      },
      {
        tokenFailure: true,
        response: Response.json({ access_token: "", expires_in: 3600 }),
      },
      { response: Response.json({ result: null }) },
      {
        response: Response.json({
          result: { ...launch(), launchUrl: "https://evil.example/intake" },
        }),
      },
      {
        response: Response.json({
          result: { ...launch(), expiresAt: "2000-01-01T00:00:00Z" },
        }),
      },
    ];
    for (const failure of failures) {
      const fake = vi.fn<typeof fetch>();
      if (!failure.tokenFailure)
        fake.mockResolvedValueOnce(
          Response.json({ access_token: "fake", expires_in: 3600 }),
        );
      fake.mockResolvedValueOnce(failure.response);
      await expect(
        createJiraClient(config, { fetch: fake }).launch("issue", staff),
      ).rejects.toThrow(/^Jira unavailable$/);
    }
    const fake = vi
      .fn<typeof fetch>()
      .mockImplementation(async (url) =>
        String(url).endsWith("/oauth/token")
          ? Response.json({ access_token: randomUUID(), expires_in: 3600 })
          : new Response(null, { status: 401 }),
      );
    await expect(
      createJiraClient(config, { fetch: fake }).board({}),
    ).rejects.toThrow(/^Jira unavailable$/);
    expect(fake).toHaveBeenCalledTimes(4);
  });
  it("aborts requests after ten seconds and sanitizes transport errors", async () => {
    vi.useFakeTimers();
    const fake = vi
      .fn<typeof fetch>()
      .mockImplementation(
        (_url, options) =>
          new Promise((_resolve, reject) =>
            options!.signal!.addEventListener("abort", () =>
              reject(new Error(secret)),
            ),
          ),
      );
    // AbortSignal.timeout uses a native timer; capture the configured deadline and drive it deterministically.
    const controller = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => controller.signal);
    const result = createJiraClient(config, { fetch: fake }).board({});
    const checked = expect(result).rejects.toThrow(/^Jira unavailable$/);
    expect(timeout).toHaveBeenCalledWith(10000);
    controller.abort();
    await checked;
    timeout.mockRestore();
  });
});

describe("Jira administrator endpoints", () => {
  let store: ReturnType<typeof createDb>;
  let app: FastifyInstance;
  let disabled: FastifyInstance;
  const launchCall = vi.fn(async (_type: string, _staff: StaffIdentity) =>
    launch(),
  );
  const boardCall = vi.fn(
    async (_query: { column?: string; offset?: number }) => board,
  );
  const cookies: Record<string, string> = {};
  beforeAll(async () => {
    const ownerUrl = (
      await readFile(
        new URL("../../../.suite-dev/test-database-url", import.meta.url),
        "utf8",
      )
    ).trim();
    const owner = postgres(ownerUrl, { max: 1, onnotice: () => {} });
    await owner.unsafe(
      "DROP DATABASE IF EXISTS whistle_jira_test WITH (FORCE)",
    );
    await owner.unsafe("CREATE DATABASE whistle_jira_test");
    await owner.end();
    const url = ownerUrl.replace(/\/postgres$/, "/whistle_jira_test");
    await runMigrations(url);
    store = createDb(url);
    for (const role of [
      "admin",
      "another-admin",
      "manager",
      "analyst",
      "pre-mfa",
      "expired",
      "inactive",
    ]) {
      const id = randomUUID();
      const raw = randomUUID();
      cookies[role] = `wb_staff=${raw}`;
      await rows(
        store.db,
        sql`insert into staff(id,email,name,role,password_hash,active) values(${id},${role + "@example.test"},'Synthetic administrator',${["manager", "analyst"].includes(role) ? role : "admin"},'unused',${role !== "inactive"})`,
      );
      await rows(
        store.db,
        sql`insert into staff_sessions(token_hash,staff_id,mfa,expires_at) values(${digest(raw)},${id},${role !== "pre-mfa"},${new Date(Date.now() + (role === "expired" ? -60000 : 3600000))})`,
      );
    }
    const configEnv = {
      NODE_ENV: "test",
      PUBLIC_WEB_URL: web,
      SUITE_DATABASE_URL: url,
      CASE_KEYRING: JSON.stringify({
        active: "a",
        keys: { a: randomBytes(32).toString("base64") },
      }),
      CAPABILITY_PRIVATE_KEY: "synthetic",
      SERVICE_EVENT_KEY: "synthetic",
      ABUSE_KEY: "synthetic",
    };
    const limiter = postgresLimiter((query) => store.db.execute(query));
    app = await buildApp({
      db: store.db,
      config: loadConfig({ ...configEnv, ...env }),
      limiter,
      jira: { launch: launchCall, board: boardCall },
    });
    disabled = await buildApp({
      db: store.db,
      config: loadConfig(configEnv),
      limiter,
    });
  });
  beforeEach(async () => {
    launchCall.mockClear();
    boardCall.mockClear();
    await rows(store.db, sql`delete from rate_limits`);
  });
  afterAll(async () => {
    await app?.close();
    await disabled?.close();
    await store?.close();
  });
  const call = (
    role: string,
    path = "",
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: payload ? "POST" : "GET",
      url: "/api/admin/jira" + path,
      headers: {
        cookie: cookies[role] ?? "",
        origin: web,
        "x-csrf": "1",
        ...headers,
      },
      payload,
    });
  it("requires an active administrator with a verified MFA session on every endpoint", async () => {
    for (const role of [
      "anonymous",
      "manager",
      "analyst",
      "pre-mfa",
      "expired",
      "inactive",
    ]) {
      for (const path of ["", "/board", "/intake"]) {
        const result = await call(
          role,
          path,
          path === "/intake" ? { type: "issue" } : undefined,
        );
        expect(result.statusCode).toBe(
          ["anonymous", "expired", "inactive"].includes(role) ? 401 : 403,
        );
      }
    }
    expect(launchCall).not.toHaveBeenCalled();
    expect(boardCall).not.toHaveBeenCalled();
  });
  it("checks CSRF and input before allowing launches", async () => {
    expect(
      (
        await call(
          "admin",
          "/intake",
          { type: "issue" },
          { origin: "https://evil.example" },
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await call("admin", "/intake", { type: "issue" }, { "x-csrf": "" }))
        .statusCode,
    ).toBe(403);
    for (const body of [
      { type: "bad" },
      { type: "issue", reporter: { id: "spoof" } },
      { type: "issue", projectKey: "LDF" },
    ])
      expect((await call("admin", "/intake", body)).statusCode).toBe(400);
    expect((await call("admin", "/board?column=unknown")).statusCode).toBe(400);
    expect((await call("admin", "/board?offset=25")).statusCode).toBe(400);
    expect(
      (await call("admin", "/board?column=pending&offset=-1")).statusCode,
    ).toBe(400);
  });
  it("returns safe metadata, derives identity, and proxies pagination", async () => {
    const status = await call("admin");
    expect(status.json()).toEqual({
      enabled: true,
      origin: config.baseUrl,
      projectKey: "LWB",
    });
    expect(status.headers["cache-control"]).toBe("no-store");
    for (const type of ["issue", "feature_request"])
      expect((await call("admin", "/intake", { type })).statusCode).toBe(200);
    expect(launchCall.mock.calls[0]![1]).toMatchObject({
      role: "admin",
      name: "Synthetic administrator",
    });
    expect(
      (await call("admin", "/board?column=pending&offset=25")).statusCode,
    ).toBe(200);
    expect(boardCall).toHaveBeenCalledWith({ column: "pending", offset: 25 });
    expect(JSON.stringify(status.json())).not.toContain(secret);
  });
  it("uses durable per-admin rate limits", async () => {
    for (let i = 0; i < 10; i++)
      expect(
        (await call("admin", "/intake", { type: "issue" })).statusCode,
      ).toBe(200);
    const limited = await call("admin", "/intake", { type: "issue" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBe("600");
    expect(launchCall).toHaveBeenCalledTimes(10);
    const restarted = await buildApp(app.deps);
    try {
      expect(
        (
          await restarted.inject({
            method: "POST",
            url: "/api/admin/jira/intake",
            payload: { type: "issue" },
            headers: { cookie: cookies.admin!, origin: web, "x-csrf": "1" },
          })
        ).statusCode,
      ).toBe(429);
    } finally {
      await restarted.close();
    }
    expect(
      (await call("another-admin", "/intake", { type: "issue" })).statusCode,
    ).toBe(200);
  });
  it("handles disabled and unavailable integrations without leaking details", async () => {
    const headers = { cookie: cookies.admin! };
    expect(
      (await disabled.inject({ url: "/api/admin/jira", headers })).json(),
    ).toEqual({ enabled: false });
    expect(
      (await disabled.inject({ url: "/api/admin/jira/board", headers }))
        .statusCode,
    ).toBe(503);
    launchCall.mockRejectedValueOnce(new Error(secret));
    const result = await call("admin", "/intake", { type: "issue" });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({ error: "jira_unavailable" });
  });
});
