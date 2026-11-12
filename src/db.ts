// A small async database interface. In production it's backed by
// Cloudflare D1; in tests and local development by Node's built-in SQLite.
//
// D1 has no interactive transactions, only atomic batches, so the app
// computes what to write first and then writes it all with batch().

export interface RunResult {
  changes: number;
  lastId: number;
}

export interface Stmt {
  sql: string;
  params: unknown[];
}

export interface Db {
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
  /** Runs every statement in one transaction: all succeed or none do. */
  batch(stmts: Stmt[]): Promise<RunResult[]>;
}

export const stmt = (sql: string, ...params: unknown[]): Stmt => ({ sql, params });

/** SQLite drivers reject undefined and booleans; normalize them. */
export function clean(params: unknown[]): unknown[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

// ---- Cloudflare D1 -------------------------------------------------------

interface D1Result {
  results?: unknown[];
  meta: { changes?: number; last_row_id?: number };
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all(): Promise<D1Result>;
  first(): Promise<unknown>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export function d1(db: D1Database): Db {
  const meta = (r: D1Result): RunResult => ({ changes: r.meta.changes ?? 0, lastId: r.meta.last_row_id ?? 0 });
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      return ((await db.prepare(sql).bind(...clean(params)).all()).results ?? []) as T[];
    },
    async get<T>(sql: string, ...params: unknown[]) {
      return ((await db.prepare(sql).bind(...clean(params)).first()) ?? undefined) as T | undefined;
    },
    async run(sql: string, ...params: unknown[]) {
      return meta(await db.prepare(sql).bind(...clean(params)).run());
    },
    async batch(stmts: Stmt[]) {
      if (stmts.length === 0) return [];
      return (await db.batch(stmts.map((s) => db.prepare(s.sql).bind(...clean(s.params))))).map(meta);
    },
  };
}
