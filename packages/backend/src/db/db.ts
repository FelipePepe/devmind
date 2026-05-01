import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { config } from '../config.js';
import { logger } from '../logger.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  // Ensure the data directory exists before opening the file
  const dbDir = dirname(resolve(config.DB_PATH));
  mkdirSync(dbDir, { recursive: true });

  _db = new Database(config.DB_PATH);
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  _db.pragma('journal_mode = WAL');

  runMigrations(_db);
  return _db;
}

function runMigrations(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = (
    db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>
  ).map((r) => r.version);

  if (!applied.includes('001_initial')) {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(join(__dir, 'migrations', '001_initial.sql'), 'utf8');
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations (version) VALUES ('001_initial')").run();
    logger.info('Applied migration 001_initial');
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
