import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage(props: PageProps<"/login">) {
  if (await getSessionUser()) redirect("/applications");
  const { next } = await props.searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-lg font-bold text-white">
            RB
          </div>
          <h1 className="text-xl font-semibold">Remote Bidder</h1>
          <p className="text-sm text-slate-500">Sign in to manage your job applications</p>
        </div>
        <LoginForm next={typeof next === "string" ? next : ""} />
      </div>
    </main>
  );
}
