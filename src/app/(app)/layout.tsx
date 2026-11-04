import { requireUser, suspensionMessage, withCurrentSuspension } from "@/lib/auth";
import { logout } from "../login/actions";
import { NavLinks } from "./nav-links";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await withCurrentSuspension(await requireUser());
  const suspension = user.suspended ? await suspensionMessage(user.suspendedReason) : "";
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4 sm:gap-6">
          <div className="flex shrink-0 items-center gap-2 font-semibold">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-xs font-bold text-white">RB</span>
            <span className="hidden sm:inline">Remote Bidder</span>
          </div>
          <NavLinks isOwner={user.role === "OWNER"} />
          <div className="ml-auto flex shrink-0 items-center gap-3 text-sm">
            <div className="hidden text-right leading-tight sm:block">
              <div className="font-medium text-slate-800">{user.name}</div>
              <div className="text-xs text-slate-500">{user.role === "OWNER" ? "Platform owner" : "Job applier"}</div>
            </div>
            <form action={logout}>
              <button className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-slate-600 hover:bg-slate-100">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {suspension && (
        <div role="alert" className="border-b border-red-200 bg-red-50">
          <div className="mx-auto max-w-[1600px] px-4 py-2.5 text-sm text-red-800">
            <strong className="font-semibold">Account suspended.</strong> {suspension} You can still view your applications.
          </div>
        </div>
      )}
      <main className="mx-auto max-w-[1600px] px-4 py-6">{children}</main>
    </div>
  );
}
