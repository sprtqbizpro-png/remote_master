import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { UsersTable } from "./users-table";

export default async function UsersPage() {
  const me = await requireOwner();
  const users = await db.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    include: { _count: { select: { applications: true } } },
  });
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Users</h1>
        <p className="text-sm text-slate-500">
          Job appliers sign in to the browser extension and this platform with these accounts. Give each applier
          their own Google Sheet to record their work; without one they use the default sheet from Settings.
        </p>
      </div>
      <UsersTable
        meId={me.id}
        users={users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role as "OWNER" | "APPLIER",
          active: u.active,
          sheetId: u.sheetId,
          applications: u._count.applications,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
