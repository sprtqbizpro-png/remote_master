"use server";

import { redirect } from "next/navigation";
import { authenticate, endSession, startSession } from "@/lib/auth";

export async function login(_prev: { error?: string } | undefined, form: FormData) {
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const user = await authenticate(email, password);
  if (!user) return { error: "Invalid email or password, or the account is disabled." };
  await startSession(user);
  const next = String(form.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/applications");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
