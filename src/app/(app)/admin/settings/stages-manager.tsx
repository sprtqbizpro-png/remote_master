"use client";

import { useState, useTransition } from "react";
import { Button, ErrorText, Input, Modal, Select } from "@/components/ui";
import {
  createStageAction,
  deleteStageAction,
  reorderStagesAction,
  setDefaultStageAction,
  updateStageAction,
  type AdminResult,
} from "../actions";

type Stage = { id: string; name: string; color: string; isDefault: boolean; count: number };

export function StagesManager({ stages }: { stages: Stage[] }) {
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const [deleting, setDeleting] = useState<Stage | null>(null);

  const act = (fn: () => Promise<AdminResult>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? "" : res.error);
    });

  const move = (index: number, delta: number) => {
    const ids = stages.map((s) => s.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    act(() => reorderStagesAction(ids));
  };

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {stages.map((s, i) => (
          <StageRow
            key={`${s.id}-${s.name}-${s.color}`}
            stage={s}
            first={i === 0}
            last={i === stages.length - 1}
            pending={pending}
            onMove={(d) => move(i, d)}
            onSave={(name, color) => act(() => updateStageAction(s.id, { name, color }))}
            onDefault={() => act(() => setDefaultStageAction(s.id))}
            onDelete={() => setDeleting(s)}
          />
        ))}
      </ul>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const f = new FormData(form);
          act(async () => {
            const res = await createStageAction({ name: String(f.get("name")), color: String(f.get("color")) });
            if (res.ok) form.reset();
            return res;
          });
        }}
      >
        <input type="color" name="color" defaultValue="#0ea5e9" className="h-9 w-10 cursor-pointer rounded border border-slate-300" />
        <Input name="name" placeholder="New status, e.g. HR Interview" className="max-w-xs" required />
        <Button type="submit" disabled={pending}>
          Add status
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)} title="Delete status">
        {deleting && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              const target = String(new FormData(e.currentTarget).get("target"));
              act(async () => {
                const res = await deleteStageAction(deleting.id, target);
                if (res.ok) setDeleting(null);
                return res;
              });
            }}
          >
            <p className="text-sm text-slate-600">
              Delete <strong>{deleting.name}</strong>? Its {deleting.count} application(s) will be moved to:
            </p>
            <Select name="target" defaultValue={stages.find((s) => s.id !== deleting.id)?.id}>
              {stages
                .filter((s) => s.id !== deleting.id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" disabled={pending}>
                Delete
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

function StageRow({
  stage,
  first,
  last,
  pending,
  onMove,
  onSave,
  onDefault,
  onDelete,
}: {
  stage: Stage;
  first: boolean;
  last: boolean;
  pending: boolean;
  onMove: (delta: number) => void;
  onSave: (name: string, color: string) => void;
  onDefault: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color);
  const dirty = name !== stage.name || color !== stage.color;
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <div className="flex flex-col">
        <button type="button" disabled={first || pending} onClick={() => onMove(-1)} className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move up">
          ▲
        </button>
        <button type="button" disabled={last || pending} onClick={() => onMove(1)} className="text-xs text-slate-400 hover:text-slate-700 disabled:opacity-30" aria-label="Move down">
          ▼
        </button>
      </div>
      <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-8 w-9 cursor-pointer rounded border border-slate-300" />
      <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 max-w-56" />
      <span className="text-xs text-slate-500">{stage.count} apps</span>
      {stage.isDefault ? (
        <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Default</span>
      ) : (
        <Button variant="ghost" size="sm" disabled={pending} onClick={onDefault}>
          Make default
        </Button>
      )}
      <div className="ml-auto flex gap-1">
        {dirty && (
          <Button size="sm" disabled={pending} onClick={() => onSave(name, color)}>
            Save
          </Button>
        )}
        <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" disabled={pending} onClick={onDelete}>
          Delete
        </Button>
      </div>
    </li>
  );
}
