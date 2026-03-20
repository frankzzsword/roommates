import { queryRow } from "./pool.js";
import { initializeDatabase } from "./init.js";

async function main() {
  await initializeDatabase();

  const counts = await Promise.all([
    queryRow<{ count: number | string }>(`SELECT COUNT(*)::int AS count FROM roommates`),
    queryRow<{ count: number | string }>(`SELECT COUNT(*)::int AS count FROM chores`),
    queryRow<{ count: number | string }>(`SELECT COUNT(*)::int AS count FROM assignments`)
  ]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        initialized: true,
        roommates: Number(counts[0]?.count ?? 0),
        chores: Number(counts[1]?.count ?? 0),
        assignments: Number(counts[2]?.count ?? 0)
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
