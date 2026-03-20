import { redirect } from "next/navigation";
import { ActivityFeed } from "@/components/activity-feed";
import { HouseTimeline } from "@/components/house-timeline";
import { MetricCard } from "@/components/metric-card";
import { RescueRequestList } from "@/components/rescue-request-list";
import { SectionCard } from "@/components/section-card";
import { WeeklyBoard } from "@/components/weekly-board";
import {
  getHouseholdWeekBoard,
  getNotificationFeed,
  getOpenRescueRequests,
  getProjectedWeeklyTimeline,
  getSharedDutyOverview,
  getSharedHouseSnapshot,
} from "@/lib/dashboard";
import { getHouseholdSnapshotCached } from "@/lib/household";
import { getServerSession } from "@/lib/session";

export default async function HousePage() {
  const session = await getServerSession();
  if (!session?.roommateId) redirect("/login");
  const snapshot = await getHouseholdSnapshotCached();
  const shared   = getSharedHouseSnapshot(snapshot);
  const rescues  = getOpenRescueRequests(snapshot, session.roommateId);
  const feed     = getNotificationFeed(snapshot, session.roommateId, 50, {
    includeTransportLogs: true
  });
  const timeline = getProjectedWeeklyTimeline(snapshot, 0);

  return (
    <div className="space-y-3">
      {/* Top stat row — 2 cols on mobile, 3 on wider */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MetricCard
          accent="mint"
          label="Free week"
          value={shared.freeWeekRoommateName ?? "—"}
          detail={shared.freeWeekRoommateName ? "Has a break this week" : "No free week"}
        />
        <MetricCard
          accent={shared.houseOverdueCount > 0 ? "rose" : "default"}
          label="Overdue"
          value={shared.houseOverdueCount}
          detail={shared.houseOverdueCount > 0 ? "Needs attention" : "All on track"}
        />
        <MetricCard
          accent="sand"
          label="Next turn"
          value={shared.nextTurnLabel}
          detail="In rotation"
        />
      </div>

      {/* Main 2-col */}
      <div className="grid gap-3 lg:grid-cols-[1fr_280px]">
        {/* Left */}
        <div className="space-y-3">
          <SectionCard title="Weekly board">
            <WeeklyBoard board={getHouseholdWeekBoard(snapshot)} sharedDuties={getSharedDutyOverview(snapshot)} />
          </SectionCard>
          <SectionCard title="Tue to Fri load">
            <HouseTimeline rows={timeline} />
          </SectionCard>
        </div>

        {/* Right sidebar */}
        <div className="space-y-3">
          <RescueRequestList emptyLabel="If someone needs cover this week, it shows up here first." requests={rescues} />
          <ActivityFeed emptyLabel="All quiet in the house." items={feed} title="House activity" />
        </div>
      </div>
    </div>
  );
}
