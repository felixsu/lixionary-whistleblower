import { sql } from "drizzle-orm";
import { digest, seal, token } from "@whistle/runtime";
import type { Limiter } from "./app.js";
import type { Config } from "./config.js";
import { rows, type Tx } from "./db/client.js";
import { audit, enqueue } from "./service.js";
import { HttpError } from "./lib/errors.js";

export async function limitPasswordReset(limiter: Limiter, email: string) {
  if (
    !(await limiter.hit(
      "auth:" + digest("reset:" + email.toLowerCase()),
      10,
      900,
    ))
  )
    throw new HttpError(429, "Too many attempts", "rate_limit");
}

export async function queuePasswordReset(
  tx: Tx,
  config: Config,
  staffId: string,
  administrator?: string,
) {
  const [staff] = await rows(
    tx,
    sql`select id from staff where id=${staffId} and active for update`,
  );
  if (!staff) return false;
  const raw = token();
  await rows(
    tx,
    sql`delete from jobs where staff_id=${staffId} and kind='staff_token'`,
  );
  await rows(
    tx,
    sql`update staff_tokens set used_at=now() where staff_id=${staffId} and purpose='password_reset' and used_at is null`,
  );
  await rows(
    tx,
    sql`insert into staff_tokens(staff_id,token_hash,purpose,expires_at) values(${staffId},${digest(raw)},'password_reset',now()+interval '30 minutes')`,
  );
  await enqueue(
    tx,
    "staff_token",
    null,
    {
      tokenEnc: seal(raw, config.keys, "staff-token"),
      purpose: "password_reset",
    },
    staffId,
  );
  await audit(
    tx,
    administrator ?? staffId,
    administrator
      ? "staff_password_reset_requested"
      : "password_reset_requested",
    null,
    administrator ? { staffId } : {},
  );
  return true;
}
