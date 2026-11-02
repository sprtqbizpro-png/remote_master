"use server";

import { redirect } from "next/navigation";
import { authenticate, endSession, startSession } from "@/lib/auth";
import { databaseProblem, isDatabaseError } from "@/lib/db";

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  try {
    const user = await authenticate(email, password);
    if (!user) return { error: "Invalid email or password, or the account is disabled." };
    await startSession(user);
  } catch (error) {
    // Show why signing in failed instead of crashing the page; the full error goes to the server log.
    console.error("[login] sign-in failed:", error);
    return { error: isDatabaseError(error) ? databaseProblem(error) : "Signing in failed because of a server error. Try again in a moment." };
  }
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/applications");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
