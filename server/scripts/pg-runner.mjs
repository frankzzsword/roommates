import process from "node:process";
import pg from "pg";

const { Client } = pg;

async function readInput() {
  let body = "";

  for await (const chunk of process.stdin) {
    body += chunk;
  }

  return body;
}

function toSerializableRows(rows) {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => {
        if (value instanceof Date) {
          return [key, value.toISOString()];
        }

        if (typeof value === "string" && /^-?\d+$/.test(value)) {
          const parsed = Number(value);
          if (Number.isSafeInteger(parsed)) {
            return [key, parsed];
          }
        }

        return [key, value];
      })
    )
  );
}

async function main() {
  const raw = await readInput();
  const input = JSON.parse(raw || "{}");

  const client = new Client({
    connectionString: input.databaseUrl
  });

  await client.connect();

  try {
    const result =
      input.params && input.params.length > 0
        ? await client.query(input.sql, input.params)
        : await client.query(input.sql);
    const rows = toSerializableRows(result.rows ?? []);

    if (input.mode === "get") {
      process.stdout.write(JSON.stringify({ row: rows[0] ?? null }));
      return;
    }

    if (input.mode === "all") {
      process.stdout.write(JSON.stringify({ rows }));
      return;
    }

    if (input.mode === "run") {
      process.stdout.write(
        JSON.stringify({
          changes: result.rowCount ?? 0,
          lastInsertRowid:
            rows.length > 0 && typeof rows[rows.length - 1]?.id === "number"
              ? rows[rows.length - 1].id
              : 0
        })
      );
      return;
    }

    process.stdout.write(JSON.stringify({ ok: true }));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown Neon runner error";
  process.stderr.write(message);
  process.exit(1);
});
