export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code = "error",
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what, "not_found");
export const badRequest = (msg: string, code = "bad_request") => new HttpError(400, msg, code);
export const unauthorized = (msg = "Not signed in") => new HttpError(401, msg, "unauthorized");
export const conflict = (msg: string, code = "conflict") => new HttpError(409, msg, code);
export const unavailable = (msg: string, code = "unavailable") => new HttpError(503, msg, code);

/**
 * A log-safe description of an error. Drizzle's "Failed query" errors embed the
 * query parameters (reporter text, contact details), so only the underlying
 * driver error's code and message are kept.
 */
export function logSafeError(err: unknown): { message: string; code?: string } {
  const e = err as { message?: string; code?: string; cause?: { message?: string; code?: string } };
  if (e?.message?.startsWith("Failed query")) {
    return { message: e.cause?.message ?? "database query failed", code: e.cause?.code };
  }
  return { message: e?.message ?? String(err), code: e?.code };
}
