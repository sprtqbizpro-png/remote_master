import { Prisma, PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Vercel, Netlify, AWS Lambda: many short-lived instances instead of one long-running server. */
export const serverless = Boolean(process.env.VERCEL || process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME);

/**
 * The runtime connection string, adjusted for where the app runs:
 * - Opening a connection over a long-distance or VPN link can take 5-10 s, past Prisma's defaults
 *   (5 s to connect, 10 s for a pooled connection), so allow more time.
 * - Serverless: every instance holds its own connections, and Supabase's session pooler (port
 *   5432) admits only a few clients in total, so a handful of instances exhaust it and new ones are
 *   refused ("max clients reached"). Use the transaction pooler (port 6543) with one connection
 *   per instance there, as Supabase recommends for serverless.
 * Values already set in DATABASE_URL win.
 */
function datasourceUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (serverless && url.hostname.endsWith(".pooler.supabase.com") && url.port === "5432") {
      url.port = "6543";
      url.searchParams.set("pgbouncer", "true");
      url.searchParams.set("connection_limit", "1");
    }
    if (serverless && !url.searchParams.has("connection_limit")) url.searchParams.set("connection_limit", "1");
    if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "30");
    if (!url.searchParams.has("pool_timeout")) url.searchParams.set("pool_timeout", "30");
    return url.toString();
  } catch {
    return raw;
  }
}

/** Connections Prisma keeps open (`connection_limit` in DATABASE_URL); the warm-up keeps them all open. */
export const poolSize = (() => {
  try {
    return Number(new URL(process.env.DATABASE_URL ?? "").searchParams.get("connection_limit")) || 5;
  } catch {
    return 5;
  }
})();

export const db = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: datasourceUrl() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** A database failure (unreachable, misconfigured, overloaded), as opposed to a bug or bad input. */
export function isDatabaseError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError ||
    (error instanceof Prisma.PrismaClientKnownRequestError && /^P1|^P2024$/.test(error.code)) ||
    (error instanceof Prisma.PrismaClientUnknownRequestError && /max clients|connection|timed out/i.test(error.message))
  );
}

/** A plain-language reason for a database failure, safe to show (no connection string or password). */
export function databaseProblem(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Environment variable not found: DATABASE_URL|DATABASE_URL/i.test(message) && !process.env.DATABASE_URL)
    return "The platform isn't connected to its database (DATABASE_URL is not set on the server).";
  if (/max clients|too many (clients|connections)|remaining connection slots/i.test(message))
    return "The database has too many open connections right now. Try again in a moment.";
  if (/Authentication failed|password authentication failed|P1000|Tenant or user not found/i.test(message))
    return "The platform's database login was rejected (check the DATABASE_URL user and password).";
  return "The platform can't reach its database right now. Try again in a moment.";
}
