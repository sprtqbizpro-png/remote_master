import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readToken, renewedToken, sessionCookieOptions } from "./lib/session-token";

/**
 * Sends visitors without a valid session cookie to /login, and renews the cookie of anyone who is
 * using the platform (once a day), so a session only ends after two weeks without a visit. Pages
 * still check the session against the database (revoked accounts, password resets).
 */
export async function proxy(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const payload = await readToken(token, "web");
  if (!payload) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    const response = NextResponse.redirect(url);
    if (token) response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  const response = NextResponse.next();
  const renewed = await renewedToken(payload);
  if (renewed) response.cookies.set(SESSION_COOKIE, renewed, sessionCookieOptions);
  return response;
}

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
