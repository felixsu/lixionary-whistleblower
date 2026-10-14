import { createHash } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { digest, mac, token, seal, unseal } from "@whistle/runtime";
import { safeStaffReturn } from "@whistle/shared";
import { csrf, sessionCookie, STAFF_COOKIE } from "../auth.js";
import { rows } from "../db/client.js";
import {
  createGoogleProvider,
  googleAuthorizationUrl,
} from "../google-oidc.js";
import { HttpError } from "../lib/errors.js";
import { audit } from "../service.js";

const browserCookie = "wb_staff_google";
const cookiePath = "/api/staff/google";
const invalid = () =>
  new HttpError(401, "Google login unavailable", "google_ineligible");

export const googleRoutes: FastifyPluginAsync = async (app) => {
  const { db, config, limiter } = app.deps;
  const googleConfig = config.google;
  const provider = googleConfig
    ? (app.deps.google ?? createGoogleProvider(googleConfig))
    : undefined;
  app.post("/start", async (req, reply) => {
    csrf(req);
    if (!googleConfig)
      throw new HttpError(503, "Google login disabled", "google_disabled");
    const { next } = z
      .object({ next: z.string().max(2048).nullable().optional() })
      .parse(req.body);
    if (
      !(await limiter.hit(
        mac(config.abuseKey, `google-start:${req.ip}`),
        10,
        900,
      ))
    )
      throw new HttpError(429, "Too many attempts", "rate_limit");
    const state = token(),
      browser = token(),
      nonce = token(),
      verifier = token();
    const expires = new Date(Date.now() + 5 * 60000);
    await rows(
      db,
      sql`insert into staff_google_transactions(state_hash,browser_hash,nonce,verifier_enc,return_path,expires_at) values(${digest(state)},${digest(browser)},${nonce},${seal(verifier, config.keys, "google:" + digest(state))},${safeStaffReturn(next ?? null)},${expires})`,
    );
    reply.setCookie(browserCookie, browser, {
      httpOnly: true,
      sameSite: "lax",
      secure: config.production,
      path: cookiePath,
      expires,
    });
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    return {
      authorizationUrl: googleAuthorizationUrl(
        googleConfig,
        state,
        nonce,
        challenge,
      ),
    };
  });
  app.get("/callback", async (req, reply) => {
    let next = "/staff";
    let error = "google_failed";
    reply.clearCookie(browserCookie, {
      path: cookiePath,
      httpOnly: true,
      sameSite: "lax",
      secure: config.production,
    });
    try {
      if (!provider)
        throw new HttpError(503, "Google login disabled", "google_disabled");
      const parsed = z
        .object({
          state: z.string().min(20).max(200),
          code: z.string().min(1).max(4096).optional(),
          error: z.string().max(200).optional(),
        })
        .safeParse(req.query);
      const browser = req.cookies[browserCookie];
      if (!parsed.success || !browser)
        throw new HttpError(401, "Invalid transaction", "google_expired");
      const { state, code, error: providerError } = parsed.data;
      // Consume before contacting Google, including cancellation. Only the initiating browser can do so.
      const [transaction] = await rows(
        db,
        sql`delete from staff_google_transactions where state_hash=${digest(state)} and browser_hash=${digest(browser)} and expires_at>now() returning *`,
      );
      if (!transaction)
        throw new HttpError(401, "Invalid transaction", "google_expired");
      next = safeStaffReturn(String(transaction.return_path));
      if (providerError === "access_denied")
        throw new HttpError(401, "Login cancelled", "google_cancelled");
      if (providerError || !code)
        throw new HttpError(
          401,
          "Google authentication failed",
          "google_failed",
        );
      const identity = await provider.exchange(
        code,
        unseal<string>(
          String(transaction.verifier_enc),
          config.keys,
          "google:" + digest(state),
        ),
        String(transaction.nonce),
      );
      if (!(await limiter.hit("auth:" + digest(identity.email), 10, 900)))
        throw new HttpError(429, "Too many attempts", "rate_limit");
      const raw = token(),
        expires = new Date(Date.now() + 5 * 60000);
      await db.transaction(async (tx) => {
        // Once linked, sub is authoritative. Email is used only for the first association.
        let [staff] = await rows(
          tx,
          sql`select * from staff where google_sub=${identity.sub} for update`,
        );
        if (!staff) {
          if (!identity.authoritativeEmail) throw invalid();
          [staff] = await rows(
            tx,
            sql`select * from staff where email=${identity.email} for update`,
          );
          if (staff?.google_sub) throw invalid();
        }
        if (!staff?.active || !staff.password_initialized) throw invalid();
        await rows(
          tx,
          sql`insert into staff_sessions(token_hash,staff_id,google_sub_pending,expires_at) values(${digest(raw)},${String(staff.id)},${identity.sub},${expires})`,
        );
        await audit(tx, String(staff.id), "staff_google_authenticated");
      });
      sessionCookie(req, reply, STAFF_COOKIE, raw, expires);
      return reply.redirect(
        `/staff/login?google=continue&next=${encodeURIComponent(next)}`,
      );
    } catch (e) {
      // Never log provider exceptions: they may contain token request/response data.
      if (e instanceof HttpError) error = e.code;
      await audit(db, "anonymous", "staff_google_login_failed", null, {
        reason: error,
      });
      return reply.redirect(
        `/staff/login?googleError=${encodeURIComponent(error)}&next=${encodeURIComponent(next)}`,
      );
    }
  });
};
