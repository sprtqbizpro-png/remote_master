import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { databaseProblem, db } from "./db";
import { memo } from "./memo";
import { SESSION_COOKIE, readToken, renewedToken, sessionCookieOptions, signToken, type TokenPayload } from "./session-token";

export { SESSION_COOKIE, signToken };

export type Role = "OWNER" | "APPLIER";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

/**
 * The session could not be checked because the database is unreachable or timed out. This is not
 * "signed out": pages show a retry screen and the extension gets a 503, so nobody loses their session.
 */
export class AuthUnavailableError extends Error {
  constructor(cause: unknown) {
    super(databaseProblem(cause), { cause });
    this.name = "AuthUnavailableError";
  }
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

/**
 * The fields auth needs, cached briefly so most requests skip a database round trip. Every change
 * to a user (edit, disable, delete, password reset) calls `forgetUser()`, so revocation is
 * immediate in this process.
 */
const authUser = memo(30_000, (id: string) =>
  db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true, active: true, tokenVersion: true } }),
);

export function forgetUser(id?: string) {
  authUser.invalidate(id);
}

/** Loads the user, retrying once: a single dropped connection shouldn't fail the request. */
async function loadAuthUser(id: string) {
  try {
    return await authUser(id);
  } catch {
    await new Promise((r) => setTimeout(r, 400));
    try {
      return await authUser(id);
    } catch (error) {
      console.error("[auth] session check failed (database):", error);
      throw new AuthUnavailableError(error);
    }
  }
}

/**
 * The signed-in user, or null when the token is missing, invalid, expired or revoked (disabled
 * account, password reset). Throws AuthUnavailableError when the database can't be reached:
 * that must never look like a sign-out.
 */
async function userFromToken(token: string | undefined, kind: TokenPayload["kind"]) {
  const payload = await readToken(token, kind);
  if (!payload) return null;
  const user = await loadAuthUser(payload.sub);
  if (!user || !user.active || user.tokenVersion !== payload.tv) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role as Role } satisfies SessionUser;
}

/** Validates email + password and returns the user, or null. */
export async function authenticate(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!user || !user.active) return null;
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return user;
}

export async function startSession(user: { id: string; tokenVersion: number }) {
  const token = await signToken({ sub: user.id, tv: user.tokenVersion, kind: "web" });
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions);
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Memoised per request: the layout and the page both need the user, but it is looked up once. */
export const getSessionUser = cache(async () => userFromToken((await cookies()).get(SESSION_COOKIE)?.value, "web"));

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireOwner() {
  const user = await requireUser();
  if (user.role !== "OWNER") redirect("/applications");
  return user;
}

/** Resolves the extension user from an `Authorization: Bearer <token>` header. */
function bearerToken(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
}

export async function getBearerUser(request: Request) {
  return userFromToken(bearerToken(request), "ext");
}

/** A renewed extension token when the request's one is due (sent back in the X-RB-Token header), else null. */
export async function renewedBearerToken(request: Request) {
  const payload = await readToken(bearerToken(request), "ext").catch(() => null);
  return payload ? renewedToken(payload) : null;
}

/** Cookie session for browser fetches to route handlers, falling back to the extension bearer token. */
export async function getRequestUser(request: Request) {
  return (await getBearerUser(request)) ?? (await getSessionUser());
}
