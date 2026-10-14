import { beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  createGoogleProvider,
  googleAuthorizationUrl,
} from "../src/google-oidc.js";
import { loadConfig } from "../src/config.js";
import { safeStaffReturn } from "@whistle/shared";

const config = {
  clientId: "synthetic-client",
  clientSecret: "synthetic-secret",
  redirectUri: "https://staff.test/api/staff/google/callback",
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>,
  local: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  keys = await generateKeyPair("RS256");
  local = createLocalJWKSet({
    keys: [{ ...(await exportJWK(keys.publicKey)), kid: "test", alg: "RS256" }],
  });
});
async function signed(
  overrides: Record<string, unknown> = {},
  wrongKey = false,
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: "https://accounts.google.com",
    aud: config.clientId,
    sub: "google-sub",
    iat: now,
    exp: now + 300,
    nonce: "expected-nonce",
    email: "Staff@Gmail.com",
    email_verified: true,
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test" })
    .sign(
      wrongKey ? (await generateKeyPair("RS256")).privateKey : keys.privateKey,
    );
}
function provider(idToken: string, ok = true) {
  const transport = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ id_token: idToken }), {
        status: ok ? 200 : 502,
      }),
  );
  return {
    transport,
    google: createGoogleProvider(config, { fetch: transport, jwks: local }),
  };
}
describe("Google OIDC validation", () => {
  it("uses PKCE and requests only login scopes", () => {
    const url = new URL(
      googleAuthorizationUrl(config, "state", "nonce", "challenge"),
    );
    expect(url.origin).toBe("https://accounts.google.com");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      response_type: "code",
      scope: "openid email",
      code_challenge_method: "S256",
      state: "state",
      nonce: "nonce",
      prompt: "select_account",
      redirect_uri: config.redirectUri,
    });
    expect(url.href).not.toContain(config.clientSecret);
    expect(url.searchParams.has("access_type")).toBe(false);
  });
  it("verifies signed tokens, normalizes email and sends the code verifier server-side", async () => {
    const { google, transport } = provider(await signed());
    expect(await google.exchange("code", "verifier", "expected-nonce")).toEqual(
      { sub: "google-sub", email: "staff@gmail.com", authoritativeEmail: true },
    );
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(Object.fromEntries(options!.body as URLSearchParams)).toMatchObject({
      client_secret: config.clientSecret,
      code_verifier: "verifier",
      code: "code",
    });
    expect(options!.redirect).toBe("error");
  });
  it("recognizes Workspace claims and distinguishes third-party emails", async () => {
    const workspace = provider(
      await signed({ email: "Staff@company.test", hd: "company.test" }),
    );
    expect(
      (await workspace.google.exchange("code", "verifier", "expected-nonce"))
        .authoritativeEmail,
    ).toBe(true);
    const thirdParty = provider(await signed({ email: "staff@company.test" }));
    expect(
      (await thirdParty.google.exchange("code", "verifier", "expected-nonce"))
        .authoritativeEmail,
    ).toBe(false);
    const legacyIssuer = provider(await signed({ iss: "accounts.google.com" }));
    expect(
      (await legacyIssuer.google.exchange("code", "verifier", "expected-nonce"))
        .sub,
    ).toBe("google-sub");
  });
  it.each([
    { iss: "https://attacker.test" },
    { aud: "other-client" },
    { azp: "other-client" },
    { nonce: "wrong-nonce" },
    { email_verified: false },
    { email_verified: "true" },
    { email: "invalid" },
    { sub: "" },
    { exp: 1 },
    { exp: undefined },
    { iat: 1 },
    { iat: Math.floor(Date.now() / 1000) + 120 },
  ])("rejects invalid claims %j", async (claims) => {
    const { google } = provider(await signed(claims));
    await expect(
      google.exchange("code", "verifier", "expected-nonce"),
    ).rejects.toThrow();
  });
  it("rejects invalid signatures and provider failures", async () => {
    await expect(
      provider(await signed({}, true)).google.exchange(
        "code",
        "verifier",
        "expected-nonce",
      ),
    ).rejects.toThrow();
    await expect(
      provider("invalid").google.exchange("code", "verifier", "expected-nonce"),
    ).rejects.toThrow();
    await expect(
      provider("", false).google.exchange("code", "verifier", "expected-nonce"),
    ).rejects.toThrow("unavailable");
    const google = createGoogleProvider(config, {
      fetch: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
      jwks: local,
    });
    await expect(
      google.exchange("code", "verifier", "expected-nonce"),
    ).rejects.toThrow();
  });
});

describe("staff Google configuration and return paths", () => {
  const env = {
    NODE_ENV: "test",
    SUITE_DATABASE_URL: "postgres://synthetic",
    CASE_KEYRING: JSON.stringify({
      active: "a",
      keys: { a: randomBytes(32).toString("base64") },
    }),
    CAPABILITY_PRIVATE_KEY: "synthetic",
    SERVICE_EVENT_KEY: "synthetic",
    ABUSE_KEY: "synthetic",
  };
  it("is optional and rejects partial configuration", () => {
    expect(loadConfig(env).google).toBeUndefined();
    expect(() =>
      loadConfig({ ...env, STAFF_GOOGLE_CLIENT_ID: config.clientId }),
    ).toThrow("both");
    expect(() =>
      loadConfig({ ...env, STAFF_GOOGLE_CLIENT_SECRET: config.clientSecret }),
    ).toThrow("both");
    expect(
      loadConfig({
        ...env,
        PUBLIC_WEB_URL: "https://staff.test",
        STAFF_GOOGLE_CLIENT_ID: config.clientId,
        STAFF_GOOGLE_CLIENT_SECRET: config.clientSecret,
      }).google,
    ).toEqual(config);
  });
  it("reads protected secret files, including an empty disabled placeholder", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wb-google-secret-"));
    const file = join(directory, "secret");
    try {
      await writeFile(file, "", { mode: 0o600 });
      expect(
        loadConfig({ ...env, STAFF_GOOGLE_CLIENT_SECRET_FILE: file }).google,
      ).toBeUndefined();
      await writeFile(file, config.clientSecret + "\n");
      expect(
        loadConfig({
          ...env,
          STAFF_GOOGLE_CLIENT_ID: config.clientId,
          STAFF_GOOGLE_CLIENT_SECRET_FILE: file,
        }).google?.clientSecret,
      ).toBe(config.clientSecret);
    } finally {
      await rm(directory, { recursive: true });
    }
  });
  it.each([
    "https://evil.test/staff",
    "//evil.test/staff",
    "/staff/login",
    "/staff/accept",
    "/staff/../report",
    "/staff\\evil",
    "/staff\n",
    "javascript:alert(1)",
    "/%2f%2fevil.test",
  ])("rejects unsafe return path %s", (value) => {
    expect(safeStaffReturn(value)).toBe("/staff");
  });
  it("preserves allowed staff paths and queries", () => {
    expect(safeStaffReturn("/staff/account?tab=sessions")).toBe(
      "/staff/account?tab=sessions",
    );
    expect(safeStaffReturn("/staff/admin/users/new")).toBe(
      "/staff/admin/users/new",
    );
  });
});
