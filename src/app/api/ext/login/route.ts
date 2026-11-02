import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, signToken } from "@/lib/auth";
import { apiError } from "@/lib/api";
import { databaseProblem, isDatabaseError } from "@/lib/db";

const body = z.object({ email: z.string().trim().min(1), password: z.string().min(1) });

export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Email and password are required.");
  let user;
  try {
    user = await authenticate(parsed.data.email, parsed.data.password);
  } catch (error) {
    console.error("[ext login] sign-in failed:", error);
    if (isDatabaseError(error)) return apiError(databaseProblem(error), 503);
    throw error;
  }
  if (!user) return apiError("Invalid email or password, or the account is disabled.", 401);
  const token = await signToken({ sub: user.id, tv: user.tokenVersion, kind: "ext" });
  return NextResponse.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
}
