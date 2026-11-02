"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createApplicationAction,
  deleteApplicationAction,
  moveApplicationAction,
} from "@/app/(app)/applications/actions";
import { Button, ErrorText, Field, Input, Modal, Select, Textarea, cn } from "./ui";

export type StageOption = { id: string; name: string; color: string };

const JOB_TYPES = ["", "Full-time", "Part-time", "Contract", "Freelance", "Internship", "Temporary"];

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

/** "New application" button + modal; `stageId` pre-selects the column when used on the board. */
export function NewApplicationButton({
  stages,
  stageId,
  compact,
}: {
  stages: StageOption[];
  stageId?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          className="w-full rounded-md border border-dashed border-slate-300 py-1.5 text-xs font-medium text-slate-500 hover:border-indigo-400 hover:bg-white hover:text-indigo-600"
        >
          + Add job
        </button>
      ) : (
        <Button onClick={() => setOpen(true)}>+ New application</Button>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Add job application" wide>
        <NewApplicationForm stages={stages} stageId={stageId} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function NewApplicationForm({ stages, stageId, onDone }: { stages: StageOption[]; stageId?: string; onDone: () => void }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const get = (k: string) => String(f.get(k) ?? "");
        start(async () => {
          const res = await createApplicationAction({
            title: get("title"),
            company: get("company"),
            location: get("location"),
            jobType: get("jobType"),
            salary: get("salary"),
            jobUrl: get("jobUrl"),
            applyUrl: get("applyUrl"),
            description: get("description"),
            notes: get("notes"),
            stageId: get("stageId"),
          });
          if (!res.ok) return setError(res.error);
          if (res.warnings?.length) console.info(res.warnings.join("\n"));
          onDone();
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job title *">
          <Input name="title" required autoFocus />
        </Field>
        <Field label="Company">
          <Input name="company" />
        </Field>
        <Field label="Location">
          <Input name="location" placeholder="Remote" />
        </Field>
        <Field label="Job type">
          <Select name="jobType" defaultValue="">
            {JOB_TYPES.map((t) => (
              <option key={t} value={t}>
                {t || "—"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Salary">
          <Input name="salary" />
        </Field>
        <Field label="Status">
          <Select name="stageId" defaultValue={stageId ?? stages[0]?.id}>
            {stages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Job posting URL">
          <Input name="jobUrl" type="url" placeholder="https://" />
        </Field>
        <Field label="Apply URL">
          <Input name="applyUrl" type="url" placeholder="https://" />
        </Field>
      </div>
      <Field label="Description">
        <Textarea name="description" rows={3} />
      </Field>
      <Field label="Notes">
        <Textarea name="notes" rows={2} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
