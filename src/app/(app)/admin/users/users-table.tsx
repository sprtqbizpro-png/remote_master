"use client";

import { useState, useTransition } from "react";
import { Button, ErrorText, Field, Input, Modal, Select, cn } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { LocalTime } from "@/components/local-time";
import { createUserAction, deleteUserAction, liftSuspensionAction, resetPasswordAction, suspendUserAction, updateUserAction } from "../actions";

type Row = {
  id: string;
  name: string;
  email: string;
  role: "OWNER" | "APPLIER";
  active: boolean;
  suspendedAt: string | null;
  suspendedReason: string;
  sheetId: string;
  applications: number;
  lastLoginAt: string | null;
  createdAt: string;
};

type Dialog = { kind: "create" } | { kind: "edit"; user: Row } | { kind: "password"; user: Row } | { kind: "suspend"; user: Row } | null;

export function UsersTable({ users, meId }: { users: Row[]; meId: string }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, start] = useTransition();
  const close = () => setDialog(null);

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setDialog({ kind: "create" })}>+ Add user</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[800px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">User</th>
              <th className="px-3 py-2.5">Role</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Google Sheet</th>
              <th className="px-3 py-2.5">Applications</th>
              <th className="px-3 py-2.5">Last sign-in</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.id} className={cn(!u.active && "bg-slate-50 text-slate-400")}>
                <td className="px-4 py-2.5">
                  <div className="font-medium text-slate-900">
                    {u.name} {u.id === meId && <span className="text-xs font-normal text-slate-400">(you)</span>}
                  </div>
                  <div className="text-xs text-slate-500">{u.email}</div>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      u.role === "OWNER" ? "bg-amber-100 text-amber-800" : "bg-sky-100 text-sky-800",
                    )}
                  >
                    {u.role === "OWNER" ? "Owner" : "Job applier"}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {!u.active ? (
                    <span className="text-slate-400">Disabled</span>
                  ) : u.suspendedAt ? (
                    <div>
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">Suspended</span>
                      <div className="mt-0.5 max-w-56 text-xs text-slate-500">
                        since <LocalTime value={u.suspendedAt} />
                        {u.suspendedReason && <span className="block truncate" title={u.suspendedReason}>“{u.suspendedReason}”</span>}
                      </div>
                    </div>
                  ) : (
                    <span className="text-emerald-600">Active</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {u.sheetId ? (
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${u.sheetId}/edit`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-600 hover:underline"
                    >
                      Own sheet ↗
                    </a>
                  ) : (
                    <span className="text-slate-400">Default</span>
                  )}
                </td>
                <td className="px-3 py-2.5">{u.applications}</td>
                <td className="px-3 py-2.5 text-slate-500">{u.lastLoginAt ? formatDate(u.lastLoginAt, true) : "Never"}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "edit", user: u })}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "password", user: u })}>
                    Reset password
                  </Button>
                  {u.role === "APPLIER" && u.id !== meId && u.active &&
                    (u.suspendedAt ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-emerald-700 hover:bg-emerald-50"
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(`Lift ${u.name}'s suspension? They will be able to apply again right away.`)) return;
                          start(async () => {
                            const res = await liftSuspensionAction(u.id);
                            if (!res.ok) alert(res.error);
                          });
                        }}
                      >
                        Lift suspension
                      </Button>
                    ) : (
                      <Button variant="ghost" size="sm" className="text-amber-700 hover:bg-amber-50" onClick={() => setDialog({ kind: "suspend", user: u })}>
                        Suspend
                      </Button>
                    ))}
                  {u.id !== meId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50"
                      disabled={pending}
                      onClick={() => {
                        const warning = u.applications
                          ? `\n\nThis also permanently deletes their ${u.applications} application(s). To keep them, edit the user and disable the account instead.`
                          : "";
                        if (!confirm(`Delete ${u.name}?${warning}`)) return;
                        start(async () => {
                          const res = await deleteUserAction(u.id);
                          if (!res.ok) alert(res.error);
                        });
                      }}
                    >
                      Delete
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={dialog?.kind === "create"} onClose={close} title="Add user">
        <UserForm onDone={close} />
      </Modal>
      <Modal open={dialog?.kind === "edit"} onClose={close} title="Edit user">
        {dialog?.kind === "edit" && <UserForm user={dialog.user} isMe={dialog.user.id === meId} onDone={close} />}
      </Modal>
      <Modal open={dialog?.kind === "password"} onClose={close} title="Reset password">
        {dialog?.kind === "password" && <PasswordForm user={dialog.user} onDone={close} />}
      </Modal>
      <Modal open={dialog?.kind === "suspend"} onClose={close} title="Suspend applier">
        {dialog?.kind === "suspend" && <SuspendForm user={dialog.user} onDone={close} />}
      </Modal>
    </>
  );
}

function UserForm({ user, isMe, onDone }: { user?: Row; isMe?: boolean; onDone: () => void }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const base = {
          name: String(f.get("name")),
          email: String(f.get("email")),
          role: String(f.get("role")),
          sheet: String(f.get("sheet") ?? ""),
        };
        start(async () => {
          const res = user
            ? await updateUserAction(user.id, { ...base, active: f.get("active") === "on" })
            : await createUserAction({ ...base, password: String(f.get("password")) });
          if (!res.ok) return setError(res.error);
          if (res.message) alert(res.message);
          onDone();
        });
      }}
    >
      <Field label="Full name">
        <Input name="name" defaultValue={user?.name} required autoFocus />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" defaultValue={user?.email} required />
      </Field>
      <Field label="Role">
        <Select name="role" defaultValue={user?.role ?? "APPLIER"}>
          <option value="APPLIER">Job applier — uses the extension, sees own applications</option>
          <option value="OWNER">Owner — manages users and sees all applications</option>
        </Select>
      </Field>
      <Field
        label="Google Sheet (optional)"
        hint="The applier's own sheet for scraped jobs and applications. Paste its URL; leave empty to use the default sheet. The sheet must be shared (Editor) with the platform's Google account."
      >
        <Input
          name="sheet"
          defaultValue={user?.sheetId ? `https://docs.google.com/spreadsheets/d/${user.sheetId}/edit` : ""}
          placeholder="https://docs.google.com/spreadsheets/d/…"
        />
      </Field>
      {!user && (
        <Field label="Initial password" hint="At least 8 characters. Share it with the user securely.">
          <Input name="password" type="text" minLength={8} required autoComplete="new-password" />
        </Field>
      )}
      {user && (
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="active" defaultChecked={user.active} disabled={isMe} className="h-4 w-4" />
          Account active (disabled accounts are signed out and cannot sign in)
        </label>
      )}
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : user ? "Save changes" : "Create user"}
        </Button>
      </div>
    </form>
  );
}

function PasswordForm({ user, onDone }: { user: Row; onDone: () => void }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const pw = String(new FormData(e.currentTarget).get("password"));
        start(async () => {
          const res = await resetPasswordAction(user.id, pw);
          if (!res.ok) return setError(res.error);
          if (res.message) alert(res.message);
          onDone();
        });
      }}
    >
      <p className="text-sm text-slate-600">
        Set a new password for <strong>{user.name}</strong>. They will be signed out everywhere.
      </p>
      <Field label="New password">
        <Input name="password" type="text" minLength={8} required autoFocus autoComplete="new-password" />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Update password"}
        </Button>
      </div>
    </form>
  );
}

function SuspendForm({ user, onDone }: { user: Row; onDone: () => void }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
        start(async () => {
          const res = await suspendUserAction(user.id, reason);
          if (!res.ok) return setError(res.error);
          onDone();
        });
      }}
    >
      <p className="text-sm text-slate-600">
        <strong>{user.name}</strong> stays signed in and can see their applications, but can&apos;t apply: saving, autofill and
        scraping are refused in the extension and on the platform, with a message asking them to contact you. Lift the
        suspension at any time.
      </p>
      <Field label="Reason (shown to the applier, optional)">
        <Input name="reason" maxLength={300} placeholder="e.g. Please check in with me about your recent applications" />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending} className="bg-amber-600 hover:bg-amber-700">
          {pending ? "Suspending…" : "Suspend"}
        </Button>
      </div>
    </form>
  );
}
