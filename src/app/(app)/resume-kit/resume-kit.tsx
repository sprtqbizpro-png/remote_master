"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Button, ErrorText, Field, Input, Modal, Textarea, cn } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { PROMPT_PLACEHOLDERS, STARTER_PROMPT, fillPrompt } from "@/lib/resume-prompts";
import {
  deletePromptAction,
  deleteTemplateAction,
  duplicatePromptAction,
  duplicateTemplateAction,
  savePromptAction,
  type KitResult,
} from "./actions";

type Template = {
  id: string;
  name: string;
  description: string;
  fileName: string;
  size: number;
  shared: boolean;
  isDefault: boolean;
  mine: boolean;
  owner: string;
  updatedAt: string;
};

type Prompt = {
  id: string;
  name: string;
  body: string;
  shared: boolean;
  isDefault: boolean;
  mine: boolean;
  owner: string;
  updatedAt: string;
};

type Dialog =
  | { kind: "template"; item?: Template }
  | { kind: "prompt"; item?: Prompt; body?: string }
  | { kind: "preview"; item: Prompt }
  | null;

const SAMPLE_JOB = {
  jobTitle: "Senior Frontend Engineer",
  company: "Acme",
  jobType: "Full-time, Remote",
  salary: "USD 150k–180k",
  location: "United States",
  jobUrl: "https://example.com/jobs/123",
  jobDescription: "We are looking for a Senior Frontend Engineer with 5+ years of React and TypeScript…",
  templateName: "My base resume",
};

function Badges({ item }: { item: { shared: boolean; isDefault: boolean; mine: boolean; owner: string } }) {
  return (
    <span className="flex flex-wrap gap-1">
      {item.isDefault && item.mine && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Default</span>}
      {item.shared && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Shared</span>}
      {!item.mine && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">by {item.owner}</span>}
    </span>
  );
}

export function ResumeKit({ templates, prompts, canShare }: { templates: Template[]; prompts: Prompt[]; canShare: boolean }) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, start] = useTransition();
  const [copied, setCopied] = useState("");
  const close = () => setDialog(null);

  const act = (fn: () => Promise<KitResult>) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) alert(res.error);
    });

  const copy = async (id: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied((c) => (c === id ? "" : c)), 1500);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      {/* ---------------- templates ---------------- */}
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Resume templates</h2>
            <p className="text-xs text-slate-500">Your base resumes as .docx files (max 5 MB).</p>
          </div>
          <Button size="sm" onClick={() => setDialog({ kind: "template" })}>
            + Upload template
          </Button>
        </div>
        <ul className="divide-y divide-slate-100">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="flex h-10 w-9 shrink-0 items-center justify-center rounded bg-blue-50 text-[10px] font-bold text-blue-700">
                DOCX
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{t.name}</span>
                  <Badges item={t} />
                </div>
                <div className="truncate text-xs text-slate-500">
                  {t.fileName} · {Math.max(1, Math.round(t.size / 1024))} KB · updated {formatDate(t.updatedAt)}
                </div>
                {t.description && <p className="mt-1 text-sm text-slate-600">{t.description}</p>}
              </div>
              <div className="flex flex-wrap gap-1">
                <a
                  href={`/api/resume-kit/templates/${t.id}/file`}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                >
                  Download
                </a>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => act(() => duplicateTemplateAction(t.id))}>
                  Copy
                </Button>
                {t.mine && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "template", item: t })}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50"
                      disabled={pending}
                      onClick={() => confirm(`Delete template "${t.name}"?`) && act(() => deleteTemplateAction(t.id))}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
          {templates.length === 0 && (
            <li className="py-8 text-center text-sm text-slate-500">No templates yet. Upload your base resume (.docx).</li>
          )}
        </ul>
      </section>

      {/* ---------------- prompts ---------------- */}
      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Generation prompts</h2>
            <p className="text-xs text-slate-500">
              Use placeholders like <code className="rounded bg-slate-100 px-1">{"{{jobTitle}}"}</code> and{" "}
              <code className="rounded bg-slate-100 px-1">{"{{jobDescription}}"}</code>.
            </p>
          </div>
          <Button size="sm" onClick={() => setDialog({ kind: "prompt", body: prompts.length ? "" : STARTER_PROMPT })}>
            + New prompt
          </Button>
        </div>
        <ul className="divide-y divide-slate-100">
          {prompts.map((p) => (
            <li key={p.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.name}</span>
                <Badges item={p} />
                <span className="ml-auto text-xs text-slate-400">updated {formatDate(p.updatedAt)}</span>
              </div>
              <pre className="max-h-28 overflow-hidden whitespace-pre-wrap rounded-md bg-slate-50 p-2 font-sans text-xs leading-relaxed text-slate-600">
                {p.body}
              </pre>
              <div className="flex flex-wrap gap-1">
                <Button variant="secondary" size="sm" onClick={() => copy(p.id, p.body)}>
                  {copied === p.id ? "Copied ✓" : "Copy prompt"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "preview", item: p })}>
                  Preview
                </Button>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => act(() => duplicatePromptAction(p.id))}>
                  Duplicate
                </Button>
                {p.mine && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: "prompt", item: p })}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50"
                      disabled={pending}
                      onClick={() => confirm(`Delete prompt "${p.name}"?`) && act(() => deletePromptAction(p.id))}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </li>
          ))}
          {prompts.length === 0 && (
            <li className="py-8 text-center text-sm text-slate-500">No prompts yet. Create one — a starter prompt is filled in for you.</li>
          )}
        </ul>
      </section>

      <Modal open={dialog?.kind === "template"} onClose={close} title={dialog?.kind === "template" && dialog.item ? "Edit template" : "Upload template"}>
        {dialog?.kind === "template" && <TemplateForm item={dialog.item} canShare={canShare} onDone={close} />}
      </Modal>
      <Modal open={dialog?.kind === "prompt"} onClose={close} title={dialog?.kind === "prompt" && dialog.item ? "Edit prompt" : "New prompt"} wide>
        {dialog?.kind === "prompt" && <PromptForm item={dialog.item} initialBody={dialog.body} canShare={canShare} onDone={close} />}
      </Modal>
      <Modal open={dialog?.kind === "preview"} onClose={close} title="Preview with a sample job" wide>
        {dialog?.kind === "preview" && (
          <pre className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-sm leading-relaxed">
            {fillPrompt(dialog.item.body, SAMPLE_JOB)}
          </pre>
        )}
      </Modal>
    </div>
  );
}

function Flags({ shared, isDefault, canShare }: { shared?: boolean; isDefault?: boolean; canShare: boolean }) {
  return (
    <div className="space-y-1.5 text-sm text-slate-700">
      <label className="flex items-center gap-2">
        <input type="checkbox" name="isDefault" defaultChecked={isDefault} className="h-4 w-4" />
        Use as my default in the extension
      </label>
      {canShare && (
        <label className="flex items-center gap-2">
          <input type="checkbox" name="shared" defaultChecked={shared} className="h-4 w-4" />
          Share with all users
        </label>
      )}
    </div>
  );
}

function TemplateForm({ item, canShare, onDone }: { item?: Template; canShare: boolean; onDone: () => void }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const body = new FormData();
        body.append("name", String(f.get("name")));
        body.append("description", String(f.get("description")));
        body.append("isDefault", String(f.get("isDefault") === "on"));
        body.append("shared", String(f.get("shared") === "on"));
        const file = fileRef.current?.files?.[0];
        if (file) body.append("file", file);
        setBusy(true);
        const res = await fetch(item ? `/api/resume-kit/templates/${item.id}` : "/api/resume-kit/templates", { method: "POST", body });
        const data = await res.json().catch(() => ({}));
        setBusy(false);
        if (!res.ok) return setError(data.error ?? "Upload failed");
        router.refresh();
        onDone();
      }}
    >
      <Field label="Name">
        <Input name="name" defaultValue={item?.name} required autoFocus placeholder="e.g. Frontend — 2 pages" />
      </Field>
      <Field label="Notes (optional)">
        <Input name="description" defaultValue={item?.description} placeholder="When to use this template" />
      </Field>
      <Field label={item ? "Replace file (optional)" : "Template file (.docx)"} hint={item ? `Current: ${item.fileName}` : undefined}>
        <input
          ref={fileRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          required={!item}
          className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200"
        />
      </Field>
      <Flags shared={item?.shared} isDefault={item?.isDefault} canShare={canShare} />
      <ErrorText>{error}</ErrorText>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function PromptForm({ item, initialBody, canShare, onDone }: { item?: Prompt; initialBody?: string; canShare: boolean; onDone: () => void }) {
  const [body, setBody] = useState(item?.body ?? initialBody ?? "");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  const insert = (key: string) => {
    const el = ref.current;
    const token = `{{${key}}}`;
    if (!el) return setBody((b) => b + token);
    const { selectionStart: s, selectionEnd: e } = el;
    setBody(body.slice(0, s) + token + body.slice(e));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const res = await savePromptAction(
            { name: String(f.get("name")), body, isDefault: f.get("isDefault") === "on", shared: f.get("shared") === "on" },
            item?.id,
          );
          if (!res.ok) return setError(res.error);
          onDone();
        });
      }}
    >
      <Field label="Name">
        <Input name="name" defaultValue={item?.name} required autoFocus placeholder="e.g. Tailor for ATS" />
      </Field>
      <div>
        <div className="mb-1 text-sm font-medium text-slate-700">Prompt</div>
        <div className="mb-1.5 flex flex-wrap gap-1">
          {PROMPT_PLACEHOLDERS.map((p) => (
            <button
              key={p.key}
              type="button"
              title={`Insert ${p.label}`}
              onClick={() => insert(p.key)}
              className={cn("rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 hover:border-indigo-300 hover:bg-indigo-50")}
            >
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>
        <Textarea ref={ref} rows={16} value={body} onChange={(e) => setBody(e.target.value)} required className="font-mono text-xs" />
      </div>
      <Flags shared={item?.shared} isDefault={item?.isDefault} canShare={canShare} />
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
