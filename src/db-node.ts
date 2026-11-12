// Node's built-in SQLite behind the same interface as D1, for tests and
// for running the app locally without Cloudflare.

import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clean, type Db, type Stmt } from './db.ts';

export function nodeDb(path: string, migrationsDir: string): Db {
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)');
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    if (sqlite.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(file)) continue;
    sqlite.exec(readFileSync(join(migrationsDir, file), 'utf8'));
    sqlite.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
  }
  const p = (params: unknown[]) => clean(params) as never[];
  const exec = (s: Stmt) => {
    const r = sqlite.prepare(s.sql).run(...p(s.params));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  };
  return {
    async all<T>(sql: string, ...params: unknown[]) {
      return sqlite.prepare(sql).all(...p(params)) as T[];
    },
    async get<T>(sql: string, ...params: unknown[]) {
      return sqlite.prepare(sql).get(...p(params)) as T | undefined;
    },
    async run(sql: string, ...params: unknown[]) {
      return exec({ sql, params });
    },
    async batch(stmts: Stmt[]) {
      sqlite.exec('BEGIN');
      try {
        const out = stmts.map(exec);
        sqlite.exec('COMMIT');
        return out;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
