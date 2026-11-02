import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'

export interface Row {
  [key: string]: unknown
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'unknown',
    source_url TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_opened_at TEXT,
    status TEXT NOT NULL DEFAULT 'ready',
    entry_file TEXT,
    file_count INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
  CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);

  CREATE TABLE IF NOT EXISTS extraction_runs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    mode TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    pages INTEGER NOT NULL DEFAULT 0,
    assets INTEGER NOT NULL DEFAULT 0,
    bytes INTEGER NOT NULL DEFAULT 0,
    skipped INTEGER NOT NULL DEFAULT 0,
    warnings TEXT NOT NULL DEFAULT '[]',
    error TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL,
    entry TEXT NOT NULL UNIQUE,
    runtime TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    requires_network INTEGER NOT NULL DEFAULT 0,
    requires_project_write INTEGER NOT NULL DEFAULT 0,
    manifest TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_run_at TEXT,
    last_status TEXT
  );

  CREATE TABLE IF NOT EXISTS plugin_runs (
    id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    project_id TEXT,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    exit_code INTEGER,
    log_path TEXT NOT NULL,
    output_paths TEXT NOT NULL DEFAULT '[]',
    duration_ms INTEGER,
    FOREIGN KEY(plugin_id) REFERENCES plugins(id)
  );
  CREATE INDEX IF NOT EXISTS idx_plugin_runs_plugin ON plugin_runs(plugin_id, started_at);

  CREATE TABLE IF NOT EXISTS edit_events (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    kind TEXT NOT NULL,
    before TEXT NOT NULL,
    after TEXT NOT NULL,
    created_at TEXT NOT NULL,
    reverted INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_edit_events_project ON edit_events(project_id, created_at);

  CREATE TABLE IF NOT EXISTS ai_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    status TEXT NOT NULL,
    brief TEXT NOT NULL,
    plan TEXT NOT NULL,
    generated_files TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    error TEXT
  );
  `
]

export class Database {
  readonly db: DatabaseSync
  readonly file: string

  constructor(file: string) {
    this.file = file
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    this.migrate()
  }

  private migrate(): void {
    const current = Number(
      (this.get<{ user_version: number }>('PRAGMA user_version')?.user_version as number) ?? 0
    )
    for (let i = current; i < MIGRATIONS.length; i += 1) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
        this.db.exec(MIGRATIONS[i])
        this.db.exec(`PRAGMA user_version = ${i + 1}`)
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
    }
  }

  get<T = Row>(sql: string, ...params: Array<string | number | null>): T | undefined {
    const stmt = this.db.prepare(sql)
    const row = stmt.get(...params) as Row | undefined
    return row ? (plain<T>(row) as T) : undefined
  }

  all<T = Row>(sql: string, ...params: Array<string | number | null>): T[] {
    const stmt = this.db.prepare(sql)
    return (stmt.all(...params) as Row[]).map((row) => plain<T>(row) as T)
  }

  run(sql: string, ...params: Array<string | number | null>): { changes: number; lastInsertRowid: number } {
    const stmt = this.db.prepare(sql)
    const result = stmt.run(...params)
    return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid) }
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.db.close()
  }
}

function plain<T>(row: Row): T {
  return JSON.parse(JSON.stringify(row)) as T
}
