export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }

  /** Field-level validation messages keyed by dotted path (e.g. "contact.email"). */
  fieldErrors(): Record<string, string> {
    return Object.fromEntries(this.issues.map((i) => [i.path, i.message]));
  }
}

type Options = Omit<RequestInit, "body"> & { body?: unknown };

export async function api<T>(path: string, { body, headers, ...init }: Options = {}): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      // Admin API requires this custom header on mutations (CSRF defence); harmless elsewhere.
      "x-csrf": "1",
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data.error ?? "error",
      data.message ?? "Something went wrong. Please try again.",
      data.issues ?? [],
    );
  }
  return data as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return "Can't reach the server. Check your connection and try again.";
  return "Something went wrong. Please try again.";
}
