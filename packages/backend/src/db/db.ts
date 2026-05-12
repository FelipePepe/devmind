import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, readdirSync } from 'node:fs';
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

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map(
      (r) => r.version
    )
  );

  const __dir = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = join(__dir, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const version = file.replace('.sql', '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(version);
    logger.info({ version }, 'Applied migration');
  }
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
