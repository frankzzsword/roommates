"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type {
  DayAgendaBucket,
  HouseholdWeekEntry,
  HouseholdTimelineRow,
  NotificationFeedItem,
  RescueRequestItem,
  SharedDutyEntry,
  UiChore,
} from "@/lib/types";
import { ActivityFeed } from "./activity-feed";
import { HouseTimeline } from "./house-timeline";
import { RescueRequestList } from "./rescue-request-list";
import { TaskActions } from "./task-actions";

// ── Shared chip helpers (warm, muted — match app's sand/cream base) ───────────
const CHIP_COLORS = [
  { bg: "#e8f0e8", text: "#2d5a2d" },  // sage
  { bg: "#f0e8e0", text: "#6b3a1f" },  // terracotta
  { bg: "#e8e4f0", text: "#3d2d6b" },  // plum
  { bg: "#f0ebe0", text: "#5a4010" },  // amber
  { bg: "#f0e8ec", text: "#6b1f3a" },  // dusty rose
  { bg: "#e0ecf0", text: "#1f4a5a" },  // teal
  { bg: "#ece8e0", text: "#4a3520" },  // warm sand
  { bg: "#e8ece8", text: "#2d4a2d" },  // forest
];

function chipColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
}

// ── Day strip ─────────────────────────────────────────────────────────────────
export function DayStripClient({
  days,
  activeKey,
  onSelect,
}: {
  days: DayAgendaBucket[];
  activeKey: string;
  onSelect: (key: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {days.map((day) => {
        const active    = day.key === activeKey;
        const doneCount = day.tasks.filter((t) => t.status === "done").length;
        const total     = day.tasks.length;
        const allDone   = total > 0 && doneCount === total;
        const hasOverdue = day.tasks.some((t) => t.status === "overdue");

        return (
          <button
            key={day.key}
            onClick={() => onSelect(day.key)}
            type="button"
            className={[
              "flex flex-col items-center rounded-xl border px-3 py-2 transition-all",
              active
                ? "border-[var(--accent)] bg-[var(--accent)] text-white shadow-[0_2px_8px_rgba(51,92,255,0.25)]"
                : hasOverdue
                ? "border-[#fecaca] bg-[#fff5f5] text-[var(--ink)] hover:border-[#f87171]"
                : "border-[var(--line)] bg-[var(--card)] text-[var(--ink)] hover:border-[var(--accent)] hover:shadow-[var(--shadow-sm)]",
            ].join(" ")}
          >
            <span className={`text-[10px] font-bold uppercase tracking-widest ${active ? "text-white/70" : "text-[var(--muted)]"}`}>
              {day.label}
            </span>
            <span className="text-[20px] font-bold leading-tight tracking-tight">
              {day.date.getDate()}
            </span>
            <span className={`text-[10px] font-medium ${active ? "text-white/70" : allDone ? "text-[#16a34a]" : hasOverdue ? "text-[#dc2626]" : "text-[var(--muted)]"}`}>
              {total > 0 ? (allDone ? "✓ all" : `${doneCount}/${total}`) : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Task row ──────────────────────────────────────────────────────────────────
export function TaskRow({ task, showActions }: { task: UiChore; showActions: boolean }) {
  const isOverdue = task.status === "overdue";
  const isDone    = task.status === "done";
  const { bg, text: chipText } = chipColor(task.title);

  return (
    <div className={[
      "rounded-xl border transition-all",
      isOverdue
        ? "border-[#fecaca] bg-[#fff5f5]"
        : isDone
        ? "border-[var(--line)] bg-[var(--surface)] opacity-60"
        : "border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow-sm)]",
    ].join(" ")}>
      <div className="flex items-center gap-3 px-3.5 py-2.5">
        {/* Status dot */}
        <div className={[
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold",
          isDone    ? "bg-[#dcfce7] text-[#15803d]"
          : isOverdue ? "bg-[#fee2e2] text-[#dc2626]"
                      : "bg-[var(--surface)] text-[var(--muted)]",
        ].join(" ")}>
          {isDone ? "✓" : isOverdue ? "!" : "·"}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`text-[13px] font-semibold leading-tight ${isDone ? "line-through text-[var(--muted)]" : "text-[var(--ink)]"}`}>
              {task.title}
            </span>
            {/* Area chip */}
            <span
              className="rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none"
              style={{ backgroundColor: isDone ? "#F0FDF4" : bg, color: isDone ? "#15803D" : chipText }}
            >
              {task.area || (task.taskMode === "rolling_until_done" ? "Rolling" : "Weekly")}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-[var(--muted)]">
            {task.assignee} · {task.dueLabel} · <span className="font-bold text-[var(--accent)]">{task.points}pt</span>
          </div>
        </div>
      </div>
      {showActions && !isDone && (
        <div className="border-t border-[var(--line)] px-3.5 py-2">
          <TaskActions task={task} />
        </div>
      )}
    </div>
  );
}

// ── Weekly board client (future weeks) ───────────────────────────────────────
export function WeeklyBoardClient({
  board,
  sharedDuties,
}: {
  board: HouseholdWeekEntry[];
  sharedDuties: SharedDutyEntry[];
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_1fr]">
      {/* This week */}
      <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]">
        <div className="border-b border-[var(--line)] bg-[var(--surface)] px-3.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">This week</span>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {board.map((entry) => {
            const { bg, text } = chipColor(entry.roommateName);
            return (
              <div key={entry.roommateId} className="flex items-center gap-2.5 px-3.5 py-2.5">
                <div
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: bg, color: text }}
                >
                  {entry.roommateName[0]}
                </div>
                <span className="w-20 shrink-0 text-[13px] font-semibold text-[var(--ink)]">{entry.roommateName}</span>
                <div className="flex flex-wrap gap-1">
                  {entry.tasks.length ? (
                    entry.tasks.map((t) => {
                      const { bg: tbg, text: ttext } = chipColor(t.title);
                      return (
                        <span
                          key={t.id}
                          className="rounded-lg px-2 py-1 text-[12px] font-medium leading-none"
                          style={{ backgroundColor: tbg, color: ttext }}
                        >
                          {t.title}
                        </span>
                      );
                    })
                  ) : (
                    <span className="rounded-md bg-[#f0fdf4] px-1.5 py-0.5 text-[11px] font-semibold text-[#15803d]">
                      🌿 Free week
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Shared duties */}
      <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]">
        <div className="border-b border-[var(--line)] bg-[var(--surface)] px-3.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Shared duties</span>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {sharedDuties.map((task) => (
            <div key={task.choreId} className="flex items-center gap-2.5 px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[var(--ink)]">{task.title}</div>
                <div className="mt-1 flex items-center gap-1.5">
                  <span className="text-[11px] text-[var(--muted)]">{task.assignee}</span>
                  {task.dueLabel && (
                    <>
                      <span className="text-[var(--faint)]">·</span>
                      <span className="text-[11px] text-[var(--faint)]">{task.dueLabel}</span>
                    </>
                  )}
                </div>
              </div>
              <span className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                task.taskMode === "rolling_until_done"
                  ? "bg-[#f0ebe0] text-[#5a4010]"
                  : "bg-[#e8ece8] text-[#2d4a2d]"
              }`}>
                {task.taskMode === "rolling_until_done" ? "Rolling" : "Sched"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Week page — fully client-side tab/day switching ───────────────────────────
export function WeekPageClient({
  mineAgenda,
  houseAgenda,
  rolling,
  meId,
  rescues,
  feed,
  mineOpenThisWeekCount,
  mineCompletedThisWeekCount,
  future,
  initialView,
  initialDay,
  initialFuture,
  getProjectedBoard,
  getProjectedDuties,
}: {
  mineAgenda: DayAgendaBucket[];
  houseAgenda: DayAgendaBucket[];
  rolling: UiChore[];
  meId: string;
  rescues: RescueRequestItem[];
  feed: NotificationFeedItem[];
  mineOpenThisWeekCount: number;
  mineCompletedThisWeekCount: number;
  future: Array<{
    key: string; dayLabel: string; dateLabel: string; count: number; emptyLabel?: string;
    board: HouseholdWeekEntry[];
    duties: SharedDutyEntry[];
    timeline: HouseholdTimelineRow[];
  }>;
  initialView: "mine" | "house";
  initialDay: string;
  initialFuture: string;
  getProjectedBoard: never;
  getProjectedDuties: never;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const view      = (searchParams.get("view") as "mine" | "house") ?? initialView;
  const dayKey    = searchParams.get("day")    ?? initialDay;
  const futureKey = searchParams.get("future") ?? initialFuture;

  const agenda    = view === "house" ? houseAgenda : mineAgenda;
  const activeDay = agenda.find((d) => d.key === dayKey) ?? agenda[0];
  const activeFut = future.find((w) => w.key === futureKey) ?? future[0];
  const hasClearedThisWeek =
    view === "mine" && mineOpenThisWeekCount === 0 && mineCompletedThisWeekCount > 0;
  const hasProgressThisWeek =
    view === "mine" && mineOpenThisWeekCount > 0 && mineCompletedThisWeekCount > 0;

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(key, value);
    startTransition(() => {
      router.replace(`/week?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="space-y-3">

      {/* ── Day strip + view toggle ── */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] px-4 pt-3 pb-4 shadow-[var(--shadow-sm)]">
        {/* Header row */}
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold text-[var(--ink)]">This week</h2>
          <div className="flex items-center gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-0.5">
            {(["mine", "house"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setParam("view", v)}
                className={[
                  "rounded-md px-3 py-1 text-[11px] font-semibold transition-all",
                  view === v
                    ? "bg-[var(--ink)] text-white shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--ink)]",
                ].join(" ")}
              >
                {v === "mine" ? "Mine" : "House"}
              </button>
            ))}
          </div>
        </div>

        <DayStripClient
          days={agenda}
          activeKey={activeDay.key}
          onSelect={(key) => setParam("day", key)}
        />
      </div>

      {/* ── Task list for selected day + rolling sidebar ── */}
      <div className="grid gap-3 xl:grid-cols-[1fr_260px]">
        {/* Day tasks */}
        <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <h3 className="text-[14px] font-semibold text-[var(--ink)]">
              {activeDay.label}
            </h3>
            {activeDay.tasks.length > 0 && (
              <span className="text-[11px] text-[var(--muted)]">
                {activeDay.tasks.length} task{activeDay.tasks.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <div className="p-3">
            {activeDay.tasks.length ? (
              <div className="space-y-2">
                {activeDay.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} showActions={view === "mine"} />
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                {hasClearedThisWeek ? (
                  <>
                    <span className="mb-2 text-3xl">✅</span>
                    <p className="text-[13px] font-semibold text-[var(--ink)]">Great work, week completed</p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      You finished {mineCompletedThisWeekCount} task{mineCompletedThisWeekCount === 1 ? "" : "s"} this week.
                    </p>
                  </>
                ) : hasProgressThisWeek ? (
                  <>
                    <span className="mb-2 text-3xl">👏</span>
                    <p className="text-[13px] font-medium text-[var(--ink)]">No tasks on {activeDay.label}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      Nice progress, {mineCompletedThisWeekCount} completed so far this week.
                    </p>
                  </>
                ) : (
                  <>
                    <span className="mb-2 text-3xl">✦</span>
                    <p className="text-[13px] font-medium text-[var(--ink)]">Nothing on {activeDay.label}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">Enjoy the free time</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Rolling / always-on tasks */}
        <div className="space-y-3">
          {rolling.length > 0 && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
              <div className="border-b border-[var(--line)] px-4 py-3">
                <h3 className="text-[14px] font-semibold text-[var(--ink)]">Always on</h3>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">Rolling tasks, any time</p>
              </div>
              <div className="space-y-2 p-3">
                {rolling.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    showActions={view === "mine" && task.assigneeId === meId}
                  />
                ))}
              </div>
            </div>
          )}

          <RescueRequestList emptyLabel="Nothing needs cover right now." requests={rescues} />
          <ActivityFeed emptyLabel="No fresh week activity yet." items={feed} title="This week" />
        </div>
      </div>

      {/* ── Future weeks ── */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
        <div className="border-b border-[var(--line)] px-4 py-3">
          <h3 className="text-[14px] font-semibold text-[var(--ink)]">Calendar preview</h3>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Anything beyond this week moves here instead of cluttering your active list.
          </p>
        </div>

        {/* Week picker */}
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {future.map((week) => {
            const isActive = week.key === activeFut.key;
            return (
              <button
                key={week.key}
                type="button"
                onClick={() => setParam("future", week.key)}
                className={[
                  "rounded-xl border px-3 py-2 text-left transition-all",
                  isActive
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : "border-[var(--line)] bg-[var(--surface)] hover:border-[var(--line-strong)]",
                ].join(" ")}
              >
                <div className={`text-[10px] font-bold uppercase tracking-widest ${isActive ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>
                  {week.dayLabel}
                </div>
                <div className={`text-[15px] font-bold leading-tight tracking-tight ${isActive ? "text-[var(--accent)]" : "text-[var(--ink)]"}`}>
                  {week.dateLabel}
                </div>
                <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                  {week.count > 0 ? `${week.count} task${week.count === 1 ? "" : "s"}` : (week.emptyLabel ?? "Free")}
                </div>
              </button>
            );
          })}
        </div>

        {/* Board for selected future week */}
        <div className="border-t border-[var(--line)] p-4">
          <div className="mb-2.5 text-[11px] font-semibold text-[var(--muted)]">
            Assigned on {activeFut.dateLabel}
          </div>
          <div className="space-y-3">
            <WeeklyBoardClient board={activeFut.board} sharedDuties={activeFut.duties} />
            <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]">
              <div className="border-b border-[var(--line)] bg-[var(--surface)] px-3.5 py-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">Timeline</span>
              </div>
              <HouseTimeline rows={activeFut.timeline} />
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
