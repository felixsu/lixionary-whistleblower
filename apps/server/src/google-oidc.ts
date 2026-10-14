import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { z } from "zod";
import type { Config } from "./config.js";

const authorizationEndpoint = "https://accounts.google.com/o/oauth2/v2/auth";
const tokenEndpoint = "https://oauth2.googleapis.com/token";
const jwks = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
  {
    timeoutDuration: 10000,
  },
);
export interface GoogleIdentity {
  sub: string;
  email: string;
  authoritativeEmail: boolean;
}
export interface GoogleProvider {
  exchange(
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<GoogleIdentity>;
}
export function googleAuthorizationUrl(
  config: NonNullable<Config["google"]>,
  state: string,
  nonce: string,
  challenge: string,
) {
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "openid email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.href;
}
export function createGoogleProvider(
  config: NonNullable<Config["google"]>,
  dependencies: { fetch?: typeof fetch; jwks?: JWTVerifyGetKey } = {},
): GoogleProvider {
  return {
    async exchange(code, verifier, nonce) {
      const response = await (dependencies.fetch ?? fetch)(tokenEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
        }),
        signal: AbortSignal.timeout(10000),
        redirect: "error",
      });
      if (!response.ok) throw new Error("Google authentication unavailable");
      const body = z
        .object({ id_token: z.string().max(16384) })
        .parse(await response.json());
      const { payload } = await jwtVerify(
        body.id_token,
        dependencies.jwks ?? jwks,
        {
          issuer: ["https://accounts.google.com", "accounts.google.com"],
          audience: config.clientId,
          algorithms: ["RS256"],
          requiredClaims: [
            "sub",
            "exp",
            "iat",
            "nonce",
            "email",
            "email_verified",
          ],
          maxTokenAge: "10m",
        },
      );
      const claims = z
        .object({
          sub: z.string().min(1).max(255),
          nonce: z.literal(nonce),
          email: z.email().max(254),
          email_verified: z.literal(true),
          hd: z.string().min(1).max(253).optional(),
          azp: z.string().optional(),
        })
        .parse(payload);
      if (claims.azp !== undefined && claims.azp !== config.clientId)
        throw new Error("Invalid Google audience");
      const email = claims.email.toLowerCase();
      return {
        sub: claims.sub,
        email,
        authoritativeEmail: email.endsWith("@gmail.com") || !!claims.hd,
      };
    },
  };
}
