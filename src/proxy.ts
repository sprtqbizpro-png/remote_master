import { NextResponse, type NextRequest } from "next/server";

/** Sends visitors without a session cookie to /login. Pages still verify the session server-side. */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("rb_session")) {
    const url = new URL("/login", request.url);
    if (request.nextUrl.pathname !== "/") url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
