import { readFileSync } from "node:fs";

function origin(value: string, production: boolean, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid ${name} origin`);
  }
  if (
    url.origin !== value.replace(/\/$/, "") ||
    (url.protocol !== "https:" &&
      (production ||
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error(`Invalid ${name} origin`);
  return url.origin;
}

export function loadJiraConfig(env: NodeJS.ProcessEnv, webUrl: string) {
  const url = env.JIRA_URL?.trim();
  if (!url) return undefined;
  const production = env.NODE_ENV === "production";
  const baseUrl = origin(url, production, "JIRA_URL");
  const clientId = env.JIRA_CLIENT_ID?.trim();
  const clientSecret = env.JIRA_CLIENT_SECRET_FILE
    ? readFileSync(env.JIRA_CLIENT_SECRET_FILE, "utf8").trim()
    : env.JIRA_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret || clientSecret.length < 32)
    throw new Error(
      "Jira requires a client ID and a secret of at least 32 characters",
    );
  const projectKey = env.JIRA_PROJECT_KEY?.trim() || "LWB";
  if (projectKey !== "LWB") throw new Error("JIRA_PROJECT_KEY must be LWB");
  const returnOrigin = origin(
    new URL(webUrl).origin,
    production,
    "PUBLIC_WEB_URL",
  );
  return { baseUrl, clientId, clientSecret, projectKey, returnOrigin };
}
export type JiraConfig = NonNullable<ReturnType<typeof loadJiraConfig>>;
