import { config } from "./config.js";
import { initializeDatabase } from "./db/init.js";
import { primeHouseholdSnapshotCacheAsync } from "./services/household-service.js";
import { startScheduler } from "./services/scheduler.js";

async function main() {
  await initializeDatabase();
  console.log("Starting scheduler worker");
  console.log(`Reminders enabled: ${config.enableOutboundReminders ? "yes" : "no"}`);

  primeHouseholdSnapshotCacheAsync();
  startScheduler();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
