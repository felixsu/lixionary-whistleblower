import { z } from "zod";
import {
  jiraBoardSchema,
  jiraLaunchSchema,
  type JiraTicketType,
  type StaffIdentity,
} from "@whistle/shared";
import type { JiraConfig } from "./jira-config.js";

export class JiraUnavailable extends Error {
  constructor() {
    super("Jira unavailable");
  }
}
export interface JiraClient {
  launch(
    type: JiraTicketType,
    staff: StaffIdentity,
  ): Promise<z.infer<typeof jiraLaunchSchema>>;
  board(query: {
    column?: string;
    offset?: number;
  }): Promise<z.infer<typeof jiraBoardSchema>>;
}

export function createJiraClient(
  config: JiraConfig,
  dependencies: { fetch?: typeof fetch; now?: () => number } = {},
): JiraClient {
  const request = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? Date.now;
  let cached: { value: string; expires: number } | undefined;
  let refreshing: Promise<string> | undefined;
  async function token(): Promise<string> {
    if (cached && now() < cached.expires) return cached.value;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const response = await request(`${config.baseUrl}/oauth/token`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new JiraUnavailable();
      }
      const data = z
        .object({
          access_token: z.string().min(1),
          expires_in: z.number().int().positive(),
        })
        .parse(await response.json());
      cached = {
        value: data.access_token,
        expires: now() + Math.max(0, data.expires_in - 60) * 1000,
      };
      return cached.value;
    })();
    try {
      return await refreshing;
    } finally {
      refreshing = undefined;
    }
  }
  async function call(name: string, body: unknown): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const bearer = await token();
      const response = await request(
        `${config.baseUrl}/api/agent/v1/tools/${name}`,
        {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(10000),
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (response.status === 401 && attempt === 0) {
        await response.body?.cancel();
        if (cached?.value === bearer) cached = undefined;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new JiraUnavailable();
      }
      const envelope = z
        .object({ result: z.unknown(), error: z.unknown().optional() })
        .parse(await response.json());
      if (envelope.error || envelope.result === undefined)
        throw new JiraUnavailable();
      return envelope.result;
    }
    throw new JiraUnavailable();
  }
  async function safe<T>(action: () => Promise<T>) {
    try {
      return await action();
    } catch {
      throw new JiraUnavailable();
    }
  }
  return {
    launch: (type, staff) =>
      safe(async () => {
        const launch = jiraLaunchSchema.parse(
          await call("create_intake_launch", {
            projectKey: config.projectKey,
            type,
            returnOrigin: config.returnOrigin,
            reporter: {
              externalId: staff.id,
              displayName: Array.from(staff.name.trim()).slice(0, 120).join(""),
            },
          }),
        );
        const url = new URL(launch.launchUrl);
        if (
          launch.origin !== config.baseUrl ||
          url.origin !== config.baseUrl ||
          url.username ||
          url.password ||
          Date.parse(launch.expiresAt) <= now()
        )
          throw new JiraUnavailable();
        return launch;
      }),
    board: (query) =>
      safe(async () => {
        const board = jiraBoardSchema.parse(
          await call("get_board", {
            ...query,
            projectKey: config.projectKey,
            limit: 25,
          }),
        );
        if (board.project.key !== config.projectKey)
          throw new JiraUnavailable();
        return board;
      }),
  };
}
