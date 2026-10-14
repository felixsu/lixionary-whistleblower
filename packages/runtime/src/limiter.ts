import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

type Execute = (query: SQL) => Promise<Iterable<Record<string, unknown>>>;
export function postgresLimiter(execute: Execute) {
  return {
    async hit(key: string, max: number, seconds: number) {
      const result = Array.from(
        await execute(sql`
        insert into rate_limits(key,hits,expires_at)
        values(${"limit:" + key},1,now()+${seconds}*interval '1 second')
        on conflict(key) do update set
          hits=case when rate_limits.expires_at<=now() then 1 else rate_limits.hits+1 end,
          expires_at=case when rate_limits.expires_at<=now() then excluded.expires_at else rate_limits.expires_at end
        returning hits
      `),
      );
      return Number(result[0]?.hits) <= max;
    },
  };
}

// Imported keys are already opaque Redis bucket names. Never log this payload.
const counters = z.array(
  z.object({
    key: z.string().startsWith("limit:").max(1024),
    hits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    expires_at: z.iso.datetime({ offset: true }),
  }),
);
export async function importRateLimits(execute: Execute, input: unknown) {
  const parsed = counters.parse(input);
  if (new Set(parsed.map((c) => c.key)).size !== parsed.length)
    throw new Error("Duplicate rate limit counter");
  await execute(sql`
    insert into rate_limits(key,hits,expires_at)
    select key,hits,expires_at from jsonb_to_recordset(${JSON.stringify(parsed)}::jsonb)
      as c(key text,hits bigint,expires_at timestamptz)
    where expires_at>now()
    on conflict(key) do update set
      hits=case when rate_limits.expires_at<=now() then excluded.hits else greatest(rate_limits.hits,excluded.hits) end,
      expires_at=greatest(rate_limits.expires_at,excluded.expires_at)
  `);
}
