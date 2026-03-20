import { redirect } from "next/navigation";
import {
  getCompletedThisWeekTasks,
  getHouseWeekAgenda,
  getNotificationFeed,
  getOpenRescueRequests,
  getProjectedHouseholdWeekBoard,
  getProjectedSharedDutyOverview,
  getProjectedWeeklyTimeline,
  getRollingTasks,
  getThisWeekTasks,
  getUpcomingCalendar,
  getWeekAgenda,
} from "@/lib/dashboard";
import { getHouseholdSnapshotCached } from "@/lib/household";
import { getServerSession } from "@/lib/session";
import { WeekPageClient } from "@/components/week-client";

export default async function WeekPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; view?: string; future?: string }>;
}) {
  const session = await getServerSession();
  if (!session?.roommateId) redirect("/login");
  const params   = await searchParams;
  const snapshot = await getHouseholdSnapshotCached();
  const me       = snapshot.roommates.find((r) => r.id === session.roommateId);
  if (!me) redirect("/login");

  const initialView = params.view === "house" ? "house" : "mine";
  const mineAgenda  = getWeekAgenda(snapshot, me.id);
  const houseAgenda = getHouseWeekAgenda(snapshot);
  const future      = getUpcomingCalendar(snapshot, me.id);
  const rolling     = getRollingTasks(snapshot);
  const rescues     = getOpenRescueRequests(snapshot, me.id);
  const feed        = getNotificationFeed(snapshot, me.id, 6);
  const mineOpenThisWeekCount = getThisWeekTasks(snapshot, me.id).length;
  const mineCompletedThisWeekCount = getCompletedThisWeekTasks(snapshot, me.id).length;

  const initialDay    = params.day    ?? mineAgenda[0]?.key ?? "";
  const initialFuture = params.future ?? future[0]?.key    ?? "";

  // Pre-compute all future week boards so client doesn't need server calls
  const futureWithBoards = future.map((week, i) => ({
    ...week,
    board:   getProjectedHouseholdWeekBoard(snapshot, i + 1),
    duties:  getProjectedSharedDutyOverview(snapshot, i + 1),
    timeline: getProjectedWeeklyTimeline(snapshot, i + 1),
  }));

  return (
    <WeekPageClient
      mineAgenda={mineAgenda}
      houseAgenda={houseAgenda}
      rolling={rolling}
      meId={me.id}
      rescues={rescues}
      feed={feed}
      mineOpenThisWeekCount={mineOpenThisWeekCount}
      mineCompletedThisWeekCount={mineCompletedThisWeekCount}
      future={futureWithBoards}
      initialView={initialView}
      initialDay={initialDay}
      initialFuture={initialFuture}
      getProjectedBoard={null as never}
      getProjectedDuties={null as never}
    />
  );
}
