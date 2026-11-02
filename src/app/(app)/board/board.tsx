"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StageOption } from "@/components/application-controls";
import { cn } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { moveApplicationAction } from "../applications/actions";
import { AddFromAppliedButton } from "./add-from-applied";

export type BoardCard = {
  id: string;
  stageId: string;
  position: number;
  title: string;
  company: string;
  location: string;
  jobType: string;
  source: string;
  applier: string;
  appliedAt: string;
  hasResume: boolean;
};

type Columns = Record<string, BoardCard[]>;

function group(stages: StageOption[], cards: BoardCard[]): Columns {
  const columns: Columns = Object.fromEntries(stages.map((s) => [s.id, []]));
  for (const card of cards) (columns[card.stageId] ??= []).push(card);
  return columns;
}

function positionAt(list: BoardCard[], index: number) {
  const prev = list[index - 1];
  const next = list[index + 1];
  if (prev && next) return (prev.position + next.position) / 2;
  if (prev) return prev.position + 1;
  if (next) return next.position - 1;
  return 0;
}

/** `addStageId`: the one column (Screening Interview) whose "+ Add job" pulls in jobs from the Applied status. */
export function Board({
  stages,
  cards,
  showApplier,
  addStageId,
  applier,
}: {
  stages: StageOption[];
  cards: BoardCard[];
  showApplier: boolean;
  addStageId?: string;
  applier: string;
}) {
  const [columns, setColumns] = useState(() => group(stages, cards));
  const [activeId, setActiveId] = useState<string | null>(null);
  const snapshot = useRef<Columns | null>(null);
  const filter = (useSearchParams().get("q") ?? "").trim().toLowerCase();

  // Pick up server changes (revalidation, new cards) when nothing is being dragged.
  useEffect(() => {
    if (!snapshot.current) setColumns(group(stages, cards));
  }, [stages, cards]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // On touch screens a short press starts a drag, so swiping still scrolls the page.
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const containerOf = (id: string) => (id in columns ? id : Object.keys(columns).find((k) => columns[k].some((c) => c.id === id)));
  const activeCard = useMemo(
    () => (activeId ? Object.values(columns).flat().find((c) => c.id === activeId) : undefined),
    [activeId, columns],
  );
  const matches = (c: BoardCard) =>
    !filter || [c.title, c.company, c.applier, c.location, c.source].some((v) => v.toLowerCase().includes(filter));

  function onDragStart(e: DragStartEvent) {
    snapshot.current = columns;
    setActiveId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const from = containerOf(String(e.active.id));
    const to = containerOf(overId);
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const source = prev[from];
      const target = prev[to];
      const card = source.find((c) => c.id === e.active.id);
      if (!card) return prev;
      const overIndex = target.findIndex((c) => c.id === overId);
      const index = overIndex >= 0 ? overIndex : target.length;
      return {
        ...prev,
        [from]: source.filter((c) => c.id !== card.id),
        [to]: [...target.slice(0, index), { ...card, stageId: to }, ...target.slice(index)],
      };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id);
    const before = snapshot.current;
    setActiveId(null);
    const overId = e.over?.id ? String(e.over.id) : null;
    const to = overId ? containerOf(overId) : undefined;
    if (!to || !before) {
      if (before) setColumns(before);
      snapshot.current = null;
      return;
    }

    let list = columns[to];
    const oldIndex = list.findIndex((c) => c.id === id);
    const overIndex = list.findIndex((c) => c.id === overId);
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) list = arrayMove(list, oldIndex, overIndex);
    const index = list.findIndex((c) => c.id === id);
    const original = Object.values(before).flat().find((c) => c.id === id);
    const unchanged = original?.stageId === to && before[to].findIndex((c) => c.id === id) === index;
    if (unchanged) {
      setColumns(before);
      snapshot.current = null;
      return;
    }

    const position = positionAt(list, index);
    list = list.map((c) => (c.id === id ? { ...c, position, stageId: to } : c));
    setColumns((prev) => ({ ...prev, [to]: list }));
    const res = await moveApplicationAction(id, to, position);
    snapshot.current = null;
    if (!res.ok) {
      setColumns(before);
      alert(res.error);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        if (snapshot.current) setColumns(snapshot.current);
        snapshot.current = null;
        setActiveId(null);
      }}
    >
      {/* Columns share the full width: stacked on phones, 2 per row on tablets, 3 on laptops, and one
          row on wide screens (scrolling sideways only when there are too many to fit). */}
      <div
        className="grid grid-cols-1 gap-3 pb-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-flow-col xl:grid-cols-none xl:auto-cols-[minmax(13rem,1fr)] xl:overflow-x-auto"
      >
        {stages.map((stage) => (
          <Column
            key={stage.id}
            stage={stage}
            cards={(columns[stage.id] ?? []).filter(matches)}
            showApplier={showApplier}
            canAdd={stage.id === addStageId}
            applier={applier}
          />
        ))}
      </div>
      <DragOverlay>{activeCard ? <CardView card={activeCard} showApplier={showApplier} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  stage,
  cards,
  showApplier,
  canAdd,
  applier,
}: {
  stage: StageOption;
  cards: BoardCard[];
  showApplier: boolean;
  canAdd: boolean;
  applier: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section className="flex min-w-0 flex-col rounded-xl bg-slate-100/80 xl:max-h-[calc(100vh-190px)]">
      <header className="flex items-center gap-2 border-t-[3px] px-3 pb-2 pt-2.5" style={{ borderColor: stage.color, borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
        <h2 className="truncate text-sm font-semibold text-slate-800">{stage.name}</h2>
        <span className="rounded-full bg-white px-2 text-xs font-medium text-slate-500">{cards.length}</span>
      </header>
      {canAdd && (
        <div className="px-2 pb-2">
          <AddFromAppliedButton stageId={stage.id} stageName={stage.name} applier={applier} showApplier={showApplier} />
        </div>
      )}
      <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn("min-h-24 flex-1 space-y-2 px-2 pb-3 transition-colors xl:overflow-y-auto", isOver && "bg-indigo-50/70")}
        >
          {cards.map((card) => (
            <SortableCard key={card.id} card={card} showApplier={showApplier} />
          ))}
          {cards.length === 0 && <p className="py-6 text-center text-xs text-slate-400">Drop cards here</p>}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ card, showApplier }: { card: BoardCard; showApplier: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
    >
      <CardView card={card} showApplier={showApplier} />
    </div>
  );
}

function CardView({ card, showApplier, dragging }: { card: BoardCard; showApplier: boolean; dragging?: boolean }) {
  return (
    <article
      className={cn(
        "cursor-grab rounded-lg border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing",
        dragging && "rotate-1 shadow-lg ring-2 ring-indigo-400",
      )}
    >
      <Link href={`/applications/${card.id}`} className="block text-sm font-medium leading-snug text-slate-900 hover:text-indigo-600" draggable={false}>
        {card.title}
      </Link>
      <div className="mt-0.5 truncate text-xs text-slate-600">{card.company || "—"}</div>
      {(card.jobType || card.location) && (
        <div className="mt-1 truncate text-xs text-slate-400">{[card.jobType, card.location].filter(Boolean).join(" · ")}</div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-500">
        {card.source && <span className="rounded bg-slate-100 px-1.5 py-0.5">{card.source}</span>}
        {card.hasResume && <span title="Resume attached">📄</span>}
        <span className="ml-auto">{formatDate(card.appliedAt)}</span>
      </div>
      {showApplier && <div className="mt-1.5 border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">👤 {card.applier}</div>}
    </article>
  );
}
