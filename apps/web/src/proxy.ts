import { NextResponse, type NextRequest } from "next/server";

/**
 * Fast redirect for signed-out admins. This only checks that a session cookie exists;
 * the API validates the session on every request.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("wb_admin")) {
    const login = new URL("/admin/login", request.url);
    login.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  // Admin pages only (never /api, so large evidence uploads aren't buffered here).
  matcher: ["/admin", "/admin/((?!login).*)"],
};
