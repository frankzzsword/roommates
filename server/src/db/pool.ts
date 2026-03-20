import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { config, hasDatabaseUrl } from "../config.js";

const TRANSIENT_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08003",
  "08006",
  "08001"
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  "server closed the connection unexpectedly",
  "terminating connection due to administrator command",
  "connection terminated unexpectedly",
  "Connection terminated unexpectedly"
];

const MAX_ATTEMPTS = 3;
const DATABASE_SCHEMA = process.env.DATABASE_SCHEMA?.trim() ?? "";

let pool: Pool | null = null;

function isValidSchemaName(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function getPool() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is required.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });
  }

  return pool;
}

function isTransientDatabaseError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const maybeCode = "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  if (maybeCode && TRANSIENT_CODES.has(maybeCode)) {
    return true;
  }

  return TRANSIENT_MESSAGE_PATTERNS.some((pattern) => error.message.includes(pattern));
}

async function runWithConfiguredClient<T>(client: PoolClient, run: (client: PoolClient) => Promise<T>) {
  if (DATABASE_SCHEMA) {
    if (!isValidSchemaName(DATABASE_SCHEMA)) {
      throw new Error("DATABASE_SCHEMA must be a simple schema name.");
    }

    await client.query(`SET search_path TO "${DATABASE_SCHEMA}"`);
  }

  return await run(client);
}

async function withClient<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();

  try {
    return await runWithConfiguredClient(client, run);
  } finally {
    client.release();
  }
}

export async function queryRows<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = []
) {
  let attempt = 0;

  while (true) {
    try {
      return await withClient(async (client) => {
        const result = await client.query<T>(sql, params);
        return result.rows;
      });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS - 1 || !isTransientDatabaseError(error)) {
        throw error;
      }

      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

export async function queryRow<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = []
) {
  const rows = await queryRows<T>(sql, params);
  return rows[0] ?? null;
}

export async function withPoolClient<T>(run: (client: PoolClient) => Promise<T>) {
  return await withClient(run);
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>) {
  let attempt = 0;

  while (true) {
    try {
      return await withClient(async (client) => {
        await client.query("BEGIN");

        try {
          const result = await run(client);
          await client.query("COMMIT");
          return result;
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {
            // Ignore rollback errors and surface the original failure.
          });
          throw error;
        }
      });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS - 1 || !isTransientDatabaseError(error)) {
        throw error;
      }

      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

export async function closePool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}
