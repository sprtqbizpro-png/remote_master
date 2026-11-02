"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Input, Modal, ErrorText } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { moveApplicationAction } from "../applications/actions";
import { searchAppliedAction, type AppliedMatch } from "./actions";

/** "+ Add job" for the Screening Interview column: pick an application in "Applied" status to move here. */
export function AddFromAppliedButton({ stageId, stageName, applier, showApplier }: { stageId: string; stageName: string; applier: string; showApplier: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-dashed border-slate-300 py-1.5 text-xs font-medium text-slate-500 hover:border-indigo-400 hover:bg-white hover:text-indigo-600"
      >
        + Add job
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Add an applied job to ${stageName}`} wide>
        <AppliedSearch stageId={stageId} applier={applier} showApplier={showApplier} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}

function AppliedSearch({ stageId, applier, showApplier, onDone }: { stageId: string; applier: string; showApplier: boolean; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [matches, setMatches] = useState<AppliedMatch[] | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [movingId, setMovingId] = useState("");
  const [, start] = useTransition();
  const latest = useRef(0);

  // Search as the user types (debounced); only the newest request's answer is shown.
  useEffect(() => {
    const ticket = ++latest.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await searchAppliedAction(q, applier);
      if (ticket !== latest.current) return;
      setSearching(false);
      if (res.ok) {
        setMatches(res.matches);
        setError("");
      } else setError(res.error);
    }, 250);
    return () => clearTimeout(timer);
  }, [q, applier]);

  const add = (id: string) => {
    setMovingId(id);
    start(async () => {
      const res = await moveApplicationAction(id, stageId);
      setMovingId("");
      if (!res.ok) return setError(res.error);
      onDone();
    });
  };

  return (
    <div className="space-y-3">
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by company or job title…" />
      <ErrorText>{error}</ErrorText>
      <div className="max-h-[50vh] overflow-y-auto rounded-md border border-slate-200">
        {matches === null ? (
          <p className="p-4 text-center text-sm text-slate-400">Searching…</p>
        ) : matches.length === 0 ? (
          <p className="p-4 text-center text-sm text-slate-400">
            {searching ? "Searching…" : q.trim() ? "No applied jobs match." : "No jobs in Applied status."}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {matches.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{m.title}</div>
                  <div className="truncate text-xs text-slate-500">
                    {[m.company || "—", showApplier && m.applier, `applied ${formatDate(m.appliedAt)}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <button
                  onClick={() => add(m.id)}
                  disabled={!!movingId}
                  className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {movingId === m.id ? "Adding…" : "Add"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {matches && matches.length > 0 && searching && <p className="text-xs text-slate-400">Updating results…</p>}
    </div>
  );
}
