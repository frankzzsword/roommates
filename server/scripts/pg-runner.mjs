import process from "node:process";
import pg from "pg";

const { Client } = pg;
const TRANSIENT_DB_ATTEMPTS = 4;
const TRANSIENT_DB_BACKOFF_MS = [250, 700, 1500];

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

function isTransientDatabaseError(message) {
  return (
    message.includes("EAI_AGAIN") ||
    message.includes("ENOTFOUND") ||
    message.includes("ETIMEDOUT") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("server closed the connection unexpectedly")
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const raw = await readInput();
  const input = JSON.parse(raw || "{}");
  let lastError = null;

  for (let attempt = 0; attempt < TRANSIENT_DB_ATTEMPTS; attempt += 1) {
    const client = new Client({
      connectionString: input.databaseUrl,
      connectionTimeoutMillis: 8000,
      keepAlive: true
    });

    try {
      await client.connect();

      if (input.schema) {
        await client.query(`SET search_path TO "${String(input.schema).replace(/"/g, '""')}"`);
      }

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
      return;
    } catch (error) {
      lastError = error;
      const message =
        error instanceof Error ? error.message : "Unknown Neon runner error";

      if (
        attempt < TRANSIENT_DB_ATTEMPTS - 1 &&
        isTransientDatabaseError(message)
      ) {
        await sleep(
          TRANSIENT_DB_BACKOFF_MS[attempt] ??
            TRANSIENT_DB_BACKOFF_MS[TRANSIENT_DB_BACKOFF_MS.length - 1] ??
            1500
        );
        continue;
      }

      throw error;
    } finally {
      await client.end().catch(() => {});
    }
  }

  throw lastError ?? new Error("Unknown Neon runner error");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown Neon runner error";
  process.stderr.write(message);
  process.exit(1);
});
