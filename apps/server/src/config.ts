import { readFileSync } from "node:fs";
import { parseKeyring, loadEmailConfig } from "@whistle/runtime";
import { loadJiraConfig } from "./jira-config.js";
export function secret(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const file = env[`${name}_FILE`];
  const value = file ? readFileSync(file, "utf8").trim() : env[name];
  if (!value) throw new Error(`${name} required`);
  return value;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  const webUrl = env.PUBLIC_WEB_URL ?? "http://localhost:9551";
  if (production && !webUrl.startsWith("https://"))
    throw new Error("Production requires HTTPS");
  const googleClientId = env.STAFF_GOOGLE_CLIENT_ID?.trim() ?? "";
  const googleSecret = env.STAFF_GOOGLE_CLIENT_SECRET_FILE
    ? readFileSync(env.STAFF_GOOGLE_CLIENT_SECRET_FILE, "utf8").trim()
    : (env.STAFF_GOOGLE_CLIENT_SECRET?.trim() ?? "");
  if (!!googleClientId !== !!googleSecret)
    throw new Error("Google login requires both staff client ID and secret");
  return {
    env: env.NODE_ENV ?? "development",
    production,
    port: Number(env.PORT ?? 9550),
    host: env.HOST ?? "127.0.0.1",
    webUrl,
    jira: loadJiraConfig(env, webUrl),
    google: googleClientId
      ? {
          clientId: googleClientId,
          clientSecret: googleSecret,
          redirectUri: new URL("/api/staff/google/callback", webUrl).href,
        }
      : undefined,
    dbUrl: secret("SUITE_DATABASE_URL", env),
    keys: parseKeyring(secret("CASE_KEYRING", env)),
    signingKey: secret("CAPABILITY_PRIVATE_KEY", env),
    eventKey: secret("SERVICE_EVENT_KEY", env),
    privacyUrl: env.PRIVACY_ORIGIN ?? "http://127.0.0.1:6405",
    abuseKey: secret("ABUSE_KEY", env),
    trustProxy:
      env.TRUST_PROXY === "1"
        ? (_address: string, hop: number) => hop === 0
        : false,
    email: loadEmailConfig("STAFF", env),
  };
}
export type Config = ReturnType<typeof loadConfig>;
