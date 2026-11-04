"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteApplicationAction,
  moveApplicationAction,
} from "@/app/(app)/applications/actions";
import { Button, cn } from "./ui";

export type StageOption = { id: string; name: string; color: string };

/** Inline stage switcher used in the applications table and detail page. */
export function StageSelect({ id, stageId, stages, className }: { id: string; stageId: string; stages: StageOption[]; className?: string }) {
  const [value, setValue] = useState(stageId);
  const [pending, start] = useTransition();
  const current = stages.find((s) => s.id === value);
  return (
    <select
      value={value}
      disabled={pending}
      onChange={(e) => {
        const next = e.target.value;
        const previous = value;
        setValue(next);
        start(async () => {
          const res = await moveApplicationAction(id, next);
          if (!res.ok) {
            setValue(previous);
            alert(res.error);
          }
        });
      }}
      className={cn("h-8 rounded-md border px-2 text-xs font-medium outline-none disabled:opacity-60", className)}
      style={{ borderColor: `${current?.color}55`, color: current?.color, backgroundColor: `${current?.color}12` }}
    >
      {stages.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

export function DeleteApplicationButton({ id, redirectTo, label = "Delete" }: { id: string; redirectTo?: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="text-red-600 hover:bg-red-50"
      disabled={pending}
      onClick={() => {
        if (!confirm("Delete this application? This cannot be undone.")) return;
        start(async () => {
          const res = await deleteApplicationAction(id);
          if (!res.ok) return alert(res.error);
          if (redirectTo) router.push(redirectTo);
        });
      }}
    >
      {pending ? "Deleting…" : label}
    </Button>
  );
}
