import { redirect } from "next/navigation";
import { ActivityFeed } from "@/components/activity-feed";
import { MetricCard } from "@/components/metric-card";
import { RescueRequestList } from "@/components/rescue-request-list";
import { SectionCard } from "@/components/section-card";
import { SummaryStrip } from "@/components/summary-strip";
import { TaskCard } from "@/components/task-card";
import { WeeklyBoard } from "@/components/weekly-board";
import {
  getDueNowTasks,
  getMoneySummary,
  getNotificationFeed,
  getOpenRescueRequests,
  getSharedDutyOverview,
  getSharedHouseSnapshot,
  getTomorrowTasks,
  getHouseholdWeekBoard,
} from "@/lib/dashboard";
import { getHouseholdSnapshotCached } from "@/lib/household";
import { getServerSession } from "@/lib/session";

export default async function OverviewPage() {
  const session = await getServerSession();
  if (!session?.roommateId) redirect("/login");
  const snapshot = await getHouseholdSnapshotCached();
  const me = snapshot.roommates.find((r) => r.id === session.roommateId);
  if (!me) redirect("/login");

  const dueNow   = getDueNowTasks(snapshot, me.id);
  const tomorrow = getTomorrowTasks(snapshot, me.id);
  const money    = getMoneySummary(snapshot, me.id);
  const shared   = getSharedHouseSnapshot(snapshot);
  const feed     = getNotificationFeed(snapshot, me.id, 20);
  const rescues  = getOpenRescueRequests(snapshot, me.id);

  const moneyAccent = money.youOwe > 0 ? "rose" : money.owedToYou > 0 ? "mint" : "default";
  const moneyValue  = money.youOwe > 0
    ? `-€${money.youOwe.toFixed(2)}`
    : money.owedToYou > 0
    ? `+€${money.owedToYou.toFixed(2)}`
    : "Clear";

  return (
    <div className="space-y-3">
      {/* Stat bar */}
      <SummaryStrip dueNow={dueNow.length} money={money} shared={shared} tomorrow={tomorrow.length} />

      <div className="grid gap-3 xl:grid-cols-[1fr_340px]">
        {/* ── Left column ── */}
        <div className="space-y-3">
          {/* Due now */}
          <SectionCard
            title={dueNow.length ? `${dueNow.length} task${dueNow.length === 1 ? "" : "s"} need action` : "All clear today"}
            action={
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                dueNow.length > 0
                  ? "bg-[#ef4444] text-white"
                  : "bg-[#dcfce7] text-[#16a34a]"
              }`}>
                {dueNow.length > 0 ? "Today" : "✓ Done"}
              </span>
            }
          >
            {dueNow.length ? (
              <div className="space-y-2">
                {dueNow.map((task) => <TaskCard key={task.id} task={task} />)}
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] p-4">
                <span className="text-2xl">🎉</span>
                <div>
                  <p className="text-[13px] font-semibold text-[#15803d]">Nothing due right now</p>
                  <p className="mt-0.5 text-[11px] text-[#86efac]">Tomorrow and the house board are below.</p>
                </div>
              </div>
            )}
          </SectionCard>

          {/* Tomorrow */}
          {tomorrow.length > 0 && (
            <SectionCard
              title="Tomorrow"
              action={
                <span className="rounded-full border border-[var(--line)] bg-[var(--surface)] px-2.5 py-1 text-[10px] font-bold text-[var(--muted)]">
                  {tomorrow.length} task{tomorrow.length === 1 ? "" : "s"}
                </span>
              }
            >
              <div className="space-y-2">
                {tomorrow.map((task) => <TaskCard key={task.id} task={task} showActions={false} />)}
              </div>
            </SectionCard>
          )}

          {/* House board */}
          <SectionCard title="House this week">
            <WeeklyBoard board={getHouseholdWeekBoard(snapshot)} sharedDuties={getSharedDutyOverview(snapshot)} />
          </SectionCard>
        </div>

        {/* ── Right sidebar ── */}
        <div className="space-y-3">
          {/* Personal stats */}
          <div className="grid grid-cols-2 gap-2">
            <MetricCard
              accent={me.reliability !== null && me.reliability < 80 ? "rose" : "mint"}
              label="Reliability"
              value={me.reliability === null ? "—" : `${me.reliability}%`}
              detail={
                me.reliability === null ? "No data yet" :
                me.reliability >= 90 ? "Excellent" :
                me.reliability >= 70 ? "Room to improve" :
                "Needs attention"
              }
            />
            <MetricCard
              accent={moneyAccent}
              label="Balance"
              value={moneyValue}
              detail={money.youOwe > 0 ? "You owe" : money.owedToYou > 0 ? "Owed to you" : "All settled"}
            />
          </div>

          {/* House snapshot — stacked rows, no truncation */}
          <div className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--card)] shadow-[var(--shadow-sm)]">
            <div className="border-b border-[var(--line)] bg-[var(--surface)] px-4 py-2.5">
              <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">House</span>
            </div>
            <div className="divide-y divide-[var(--line)]">
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[12px] text-[var(--muted)]">Overdue tasks</span>
                <span className={`text-[14px] font-bold tabular-nums ${shared.houseOverdueCount > 0 ? "text-[#c0392b]" : "text-[var(--ink)]"}`}>
                  {shared.houseOverdueCount === 0 ? "None" : shared.houseOverdueCount}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[12px] text-[var(--muted)]">Free week</span>
                <span className="text-[14px] font-bold text-[#2d6a2d]">
                  {shared.freeWeekRoommateName ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between px-4 py-3">
                <span className="text-[12px] text-[var(--muted)]">Next turn</span>
                <span className="text-[14px] font-bold text-[var(--ink)]">
                  {shared.nextTurnLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Activity feed */}
          <RescueRequestList emptyLabel="If someone needs cover this week, it will show up here." requests={rescues} />
          <ActivityFeed items={feed} />
        </div>
      </div>
    </div>
  );
}
