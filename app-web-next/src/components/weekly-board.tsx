import type { HouseholdWeekEntry, SharedDutyEntry } from "@/lib/types";

// Warm, muted chip palette — harmonises with the app's sand/cream base (#f4f3f0)
const CHIP_COLORS = [
  { bg: "#e8f0e8", text: "#2d5a2d" },  // sage green
  { bg: "#f0e8e0", text: "#6b3a1f" },  // warm terracotta
  { bg: "#e8e4f0", text: "#3d2d6b" },  // muted plum
  { bg: "#f0ebe0", text: "#5a4010" },  // warm amber
  { bg: "#f0e8ec", text: "#6b1f3a" },  // dusty rose
  { bg: "#e0ecf0", text: "#1f4a5a" },  // muted teal
  { bg: "#ece8e0", text: "#4a3520" },  // warm sand
  { bg: "#e8ece8", text: "#2d4a2d" },  // forest
];

function chipColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CHIP_COLORS[h % CHIP_COLORS.length];
}

type TaskStatus = "done" | "overdue" | "skipped" | "pending" | "rescued" | "template";

function shortDueLabel(value: string | null | undefined) {
  if (!value) return null;
  if (!value.startsWith("Due ")) return null;
  return value.replace(/^Due\s+/, "").replace(/,\s*\d{2}:\d{2}$/, "");
}

function TaskChip({
  label,
  status,
  dueLabel
}: {
  label: string;
  status: TaskStatus;
  dueLabel?: string | null;
}) {
  const { bg, text } = chipColor(label);
  const isDone    = status === "done" || status === "rescued";
  const isOverdue = status === "overdue";
  const dueMeta = shortDueLabel(dueLabel);

  return (
    <span
      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[12px] font-medium leading-none"
      style={{
        backgroundColor: isDone ? "#edf7ed" : isOverdue ? "#fdf0f0" : bg,
        color: isDone ? "#2d6a2d" : isOverdue ? "#a52a2a" : text,
        opacity: isDone ? 0.7 : 1,
      }}
    >
      {isDone    && <span className="text-[10px] leading-none">✓</span>}
      {isOverdue && <span className="text-[10px] font-bold leading-none">!</span>}
      <span className={isDone ? "line-through" : ""}>{label}</span>
      {dueMeta && !isDone && (
        <span className="text-[10px] font-semibold opacity-70">{dueMeta}</span>
      )}
    </span>
  );
}

export function WeeklyBoard({
  board,
  sharedDuties,
}: {
  board: HouseholdWeekEntry[];
  sharedDuties: SharedDutyEntry[];
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* Weekly schedule */}
      <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)]">
        <div className="border-b border-[var(--line)] bg-[var(--surface)] px-3.5 py-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">This week</span>
        </div>
        <div className="divide-y divide-[var(--line)]">
          {board.map((entry) => {
            const { bg, text } = chipColor(entry.roommateName);
            return (
              <div key={entry.roommateId} className="flex items-start gap-3 px-3.5 py-3">
                {/* Avatar */}
                <div
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: bg, color: text }}
                >
                  {entry.roommateName[0]}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="mb-1.5 text-[12px] font-semibold text-[var(--ink)]">{entry.roommateName}</div>
                  <div className="flex flex-wrap gap-1">
                    {entry.tasks.length ? (
                      entry.tasks.map((t) => (
                        <TaskChip
                          key={t.id}
                          label={t.title}
                          status={t.status as TaskStatus}
                          dueLabel={t.dueLabel}
                        />
                      ))
                    ) : (
                      <span className="rounded-md bg-[#f0fdf4] px-2 py-0.5 text-[11px] font-semibold text-[#15803d]">
                        🌿 Free week
                      </span>
                    )}
                  </div>
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
        {sharedDuties.length ? (
          <div className="divide-y divide-[var(--line)]">
            {sharedDuties.map((task) => (
              <div key={task.choreId} className="flex items-center gap-3 px-3.5 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[var(--ink)]">{task.title}</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[11px] text-[var(--muted)]">{task.assignee}</span>
                    {task.dueLabel && (
                      <>
                        <span className="text-[var(--faint)]">·</span>
                        <span className="text-[11px] text-[var(--faint)]">{task.dueLabel}</span>
                      </>
                    )}
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                    task.taskMode === "rolling_until_done"
                      ? "bg-[#f0ebe0] text-[#5a4010]"
                      : "bg-[#e8ece8] text-[#2d4a2d]"
                  }`}
                >
                  {task.taskMode === "rolling_until_done" ? "Rolling" : "Sched"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-3.5 py-6 text-center">
            <p className="text-[12px] text-[var(--muted)]">No shared duties this week.</p>
          </div>
        )}
      </div>
    </div>
  );
}
