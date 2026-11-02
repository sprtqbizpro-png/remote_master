import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Opening a connection to Supabase over a long-distance or VPN link can take 5-10 s, past Prisma's
 * defaults (5 s to connect, 10 s to wait for a pooled connection), which turns a slow page into a
 * failed one. Allow more time unless DATABASE_URL already says otherwise.
 */
function datasourceUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
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
