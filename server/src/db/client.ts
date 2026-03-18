import { spawnSync } from "node:child_process";
import path from "node:path";
import { config, hasDatabaseUrl } from "../config.js";

type QueryMode = "get" | "all" | "run" | "exec";

function normalizeValue(value: unknown) {
  return value === undefined ? null : value;
}

function quoteAliases(sql: string) {
  return sql.replace(/\bas\s+([A-Za-z_][A-Za-z0-9_]*)\b/gi, (_match, alias) => {
    return `AS "${alias}"`;
  });
}

function normalizeSql(sql: string) {
  return quoteAliases(
    sql
      .replace(/\bBEGIN\s+IMMEDIATE\s+TRANSACTION\b/gi, "BEGIN")
      .replace(/\bCURRENT_TIMESTAMP\b(?!::text)/g, "CURRENT_TIMESTAMP::text")
  );
}

function compileStatement(
  sql: string,
  args: unknown[],
  mode: QueryMode
) {
  let text = normalizeSql(sql).trim();
  let values: unknown[] = [];

  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === "object" &&
    !Array.isArray(args[0]) &&
    !(args[0] instanceof Date)
  ) {
    const namedArgs = args[0] as Record<string, unknown>;
    const indexByName = new Map<string, number>();
    text = text.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_match, name) => {
      if (!indexByName.has(name)) {
        indexByName.set(name, values.length + 1);
        values.push(normalizeValue(namedArgs[name]));
      }

      return `$${indexByName.get(name)}`;
    });
  } else if (args.length > 0) {
    let index = 0;
    values = args.map(normalizeValue);
    text = text.replace(/\?/g, () => {
      index += 1;
      return `$${index}`;
    });
  }

  if (mode === "run" && /^\s*INSERT\b/i.test(text) && !/\bRETURNING\b/i.test(text)) {
    text = `${text.replace(/;\s*$/, "")} RETURNING id`;
  }

  return {
    sql: text,
    params: values
  };
}

function executeSync(mode: QueryMode, sql: string, args: unknown[]) {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is required.");
  }

  const compiled = compileStatement(sql, args, mode);
  const runnerPath = path.resolve(process.cwd(), "scripts/pg-runner.mjs");
  const result = spawnSync(process.execPath, [runnerPath], {
    input: JSON.stringify({
      mode,
      sql: compiled.sql,
      params: compiled.params,
      databaseUrl: config.databaseUrl
    }),
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 20
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr || "Neon query failed.");
  }

  const stdout = result.stdout?.trim();
  if (!stdout) {
    return null;
  }

  return JSON.parse(stdout) as {
    row?: Record<string, unknown> | null;
    rows?: Array<Record<string, unknown>>;
    changes?: number;
    lastInsertRowid?: number;
  };
}

class PreparedStatement {
  constructor(private readonly sql: string) {}

  get(...args: unknown[]): any {
    const payload = executeSync("get", this.sql, args);
    return payload?.row ?? undefined;
  }

  all(...args: unknown[]): any[] {
    const payload = executeSync("all", this.sql, args);
    return payload?.rows ?? [];
  }

  run(...args: unknown[]): { changes: number; lastInsertRowid: number } {
    const payload = executeSync("run", this.sql, args);
    return {
      changes: payload?.changes ?? 0,
      lastInsertRowid: payload?.lastInsertRowid ?? 0
    };
  }
}

export const db = {
  prepare(sql: string) {
    return new PreparedStatement(sql);
  },
  exec(sql: string) {
    executeSync("exec", sql, []);
  }
};
