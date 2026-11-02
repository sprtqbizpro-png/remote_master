"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button, ErrorText, Field, Input, Textarea } from "@/components/ui";
import { updateApplicationAction } from "../actions";

type Details = {
  title: string;
  company: string;
  location: string;
  jobType: string;
  salary: string;
  postedAt: string;
  jobUrl: string;
  applyUrl: string;
  description: string;
};

const FIELDS: { key: keyof Details; label: string }[] = [
  { key: "title", label: "Job title" },
  { key: "company", label: "Company" },
  { key: "location", label: "Location" },
  { key: "jobType", label: "Job type" },
  { key: "salary", label: "Salary" },
  { key: "postedAt", label: "Posted" },
  { key: "jobUrl", label: "Job posting URL" },
  { key: "applyUrl", label: "Apply URL" },
];

export function DetailsEditor({ id, initial }: { id: string; initial: Details }) {
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState(initial);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  if (!editing) {
    return (
      <div className="space-y-4">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {FIELDS.map(({ key, label }) => (
            <div key={key} className="min-w-0">
              <dt className="text-xs text-slate-500">{label}</dt>
              <dd className="truncate text-slate-800">{initial[key] || <span className="text-slate-400">—</span>}</dd>
            </div>
          ))}
        </dl>
        {initial.description && (
          <div>
            <div className="mb-1 text-xs text-slate-500">Description</div>
            <div className="max-h-[480px] overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">
              {initial.description}
            </div>
          </div>
        )}
        <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
          Edit details
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateApplicationAction(id, values);
          if (!res.ok) return setError(res.error);
          setError("");
          setEditing(false);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(({ key, label }) => (
          <Field key={key} label={label}>
            <Input
              value={values[key]}
              required={key === "title"}
              onChange={(e) => setValues({ ...values, [key]: e.target.value })}
            />
          </Field>
        ))}
      </div>
      <Field label="Description">
        <Textarea rows={10} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setValues(initial);
            setEditing(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function NotesEditor({ id, initial }: { id: string; initial: string }) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Interview dates, contacts, follow-ups…" />
      <Button
        size="sm"
        disabled={pending || notes === saved}
        onClick={() =>
          start(async () => {
            const res = await updateApplicationAction(id, { notes });
            if (!res.ok) return alert(res.error);
            setSaved(notes);
          })
        }
      >
        {pending ? "Saving…" : notes === saved ? "Saved" : "Save notes"}
      </Button>
    </div>
  );
}

type UploadState = { phase: "upload"; percent: number } | { phase: "processing" } | null;

/** Posts the file with progress (fetch can't report upload progress). */
function uploadWithProgress(url: string, body: FormData, onProgress: (s: UploadState) => void) {
  return new Promise<{ ok: boolean; data: { error?: string } }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress({ phase: "upload", percent: Math.min(100, Math.round((e.loaded / e.total) * 100)) });
    };
    xhr.upload.onload = () => onProgress({ phase: "processing" });
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        /* non-JSON error */
      }
      resolve({ ok: xhr.status >= 200 && xhr.status < 300, data });
    };
    xhr.onerror = () => reject(new Error("Network error: the upload didn't reach the platform."));
    xhr.send(body);
  });
}

export function ResumeUploader({ id, hasResume }: { id: string; hasResume: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>(null);
  const [error, setError] = useState("");
  const busy = state !== null;
  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept=".pdf,.doc,.docx,.txt,.rtf,.odt"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setError("");
          setState({ phase: "upload", percent: 0 });
          const body = new FormData();
          body.append("resume", file);
          try {
            const res = await uploadWithProgress(`/api/applications/${id}/resume`, body, setState);
            if (!res.ok) return setError(res.data.error ?? "Upload failed");
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Upload failed");
          } finally {
            setState(null);
          }
        }}
      />
      <Button variant="secondary" size="sm" disabled={busy} onClick={() => input.current?.click()} className="inline-flex items-center gap-2">
        {busy && <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" aria-hidden="true" />}
        {busy ? "Uploading…" : hasResume ? "Replace resume" : "Upload resume"}
      </Button>
      {state && (
        <div role="status" aria-live="polite" className="space-y-1">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-indigo-100">
            {state.phase === "upload" ? (
              <div className="h-full rounded-full bg-indigo-600 transition-[width] duration-200" style={{ width: `${state.percent}%` }} />
            ) : (
              <div className="absolute inset-y-0 w-1/3 animate-pulse rounded-full bg-indigo-600" />
            )}
          </div>
          <p className="text-xs text-indigo-700">
            {state.phase === "upload" ? `Uploading resume… ${state.percent}%` : "Saving resume to Google Drive…"}
          </p>
        </div>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
