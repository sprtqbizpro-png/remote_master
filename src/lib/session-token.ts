// Signing and verifying session tokens. Kept free of the database and of "server-only" so the
// proxy (which runs before every page) can renew cookies with it too.
import { SignJWT, errors, jwtVerify, type JWTPayload } from "jose";

export const SESSION_COOKIE = "rb_session";
export const SESSION_TTL = 60 * 60 * 24 * 14; // web: 14 days since last use
export const EXTENSION_TTL = 60 * 60 * 24 * 60; // extension: 60 days since last use
/** Tokens older than this are re-issued with a fresh expiry, so active users are never signed out. */
export const RENEW_AFTER = 60 * 60 * 24; // 1 day

export type TokenPayload = { sub: string; tv: number; kind: "web" | "ext" };

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 16) throw new Error("AUTH_SECRET is missing or too short");
  return new TextEncoder().encode(value);
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
 * The token's claims, or null when it is invalid, tampered with or expired. A missing or bad
 * AUTH_SECRET is a server misconfiguration and throws instead of quietly signing everyone out.
 */
export async function readToken(token: string | undefined, kind: TokenPayload["kind"]) {
  if (!token) return null;
  const key = secret();
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
    if (payload.kind !== kind || typeof payload.sub !== "string" || typeof payload.tv !== "number") return null;
    return payload as JWTPayload & TokenPayload;
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
}

/** A fresh token for the same user and session version when `payload` is due for renewal, else null. */
export async function renewedToken(payload: JWTPayload & TokenPayload) {
  const age = Math.floor(Date.now() / 1000) - (payload.iat ?? 0);
  if (age < RENEW_AFTER) return null;
  return signToken({ sub: payload.sub, tv: payload.tv, kind: payload.kind });
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_TTL,
};
