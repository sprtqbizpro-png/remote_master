import "server-only";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { memo } from "./memo";

export const SESSION_COOKIE = "rb_session";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 days
const EXTENSION_TTL = 60 * 60 * 24 * 30; // 30 days

export type Role = "OWNER" | "APPLIER";

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

type TokenPayload = { sub: string; tv: number; kind: "web" | "ext" };

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) throw new Error("AUTH_SECRET is missing or too short");
  return new TextEncoder().encode(value);
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: TokenPayload) {
  const ttl = payload.kind === "ext" ? EXTENSION_TTL : SESSION_TTL;
  return new SignJWT({ tv: payload.tv, kind: payload.kind })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secret());
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

async function userFromToken(token: string | undefined, kind: TokenPayload["kind"]) {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (payload.kind !== kind || typeof payload.sub !== "string") return null;
    const user = await authUser(payload.sub);
    if (!user || !user.active || user.tokenVersion !== payload.tv) return null;
    return { id: user.id, email: user.email, name: user.name, role: user.role as Role } satisfies SessionUser;
  } catch {
    return null;
  }
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
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL,
  });
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
export async function getBearerUser(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : undefined;
  return userFromToken(token, "ext");
}

/** Cookie session for browser fetches to route handlers, falling back to the extension bearer token. */
export async function getRequestUser(request: Request) {
  return (await getBearerUser(request)) ?? (await getSessionUser());
}
