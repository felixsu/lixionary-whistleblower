import { readFileSync } from "node:fs";
import { parseKeyring, loadEmailConfig } from "@whistle/runtime";
function get(name: string, env: NodeJS.ProcessEnv, required = true) {
  const file = env[`${name}_FILE`],
    value = file ? readFileSync(file, "utf8").trim() : env[name];
  if (required && !value) throw new Error(`${name} required`);
  return value ?? "";
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  if (
    env.NODE_ENV === "production" &&
    !env.PUBLIC_WEB_URL?.startsWith("https://")
  )
    throw new Error("Production requires PUBLIC_WEB_URL with HTTPS");
  return {
    env: env.NODE_ENV ?? "development",
    production: env.NODE_ENV === "production",
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 6405),
    webUrl: env.PUBLIC_WEB_URL ?? "http://localhost:9551",
    caseUrl: env.CASE_ORIGIN ?? "http://localhost:9550",
    dbUrl: get("PRIVACY_DATABASE_URL", env),
    redisUrl: get("PRIVACY_REDIS_URL", env),
    keys: parseKeyring(get("VAULT_KEYRING", env)),
    publicKey: get("CAPABILITY_PUBLIC_KEY", env),
    eventKey: get("SERVICE_EVENT_KEY", env),
    abuseKey: get("PRIVACY_ABUSE_KEY", env),
    storage: env.PRIVACY_STORAGE ?? "./data/privacy",
    trustProxy:
      env.TRUST_PROXY === "1"
        ? (_address: string, hop: number) => hop === 0
        : false,
    scanner: env.CLAMDSCAN_BIN ?? "clamdscan",
    email: loadEmailConfig("PRIVACY", env),
    twilio: {
      sid: get("TWILIO_ACCOUNT_SID", env, false),
      token: get("TWILIO_AUTH_TOKEN", env, false),
      from: env.TWILIO_FROM ?? "",
    },
    ai: {
      apiKey: get("MINIMAX_API_KEY", env, false),
      baseUrl: env.MINIMAX_BASE_URL ?? "https://api.minimax.io/v1",
      model: env.MINIMAX_MODEL ?? "MiniMax-M3",
      thinking: "disabled" as const,
      timeoutMs: 45000,
    },
  };
}
export type Config = ReturnType<typeof loadConfig>;
