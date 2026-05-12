import type Database from 'better-sqlite3';

export interface Setting {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export class SettingsRepo {
  constructor(private db: Database.Database) {}

  get(key: string): string | undefined {
    const row = this.db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string, description?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO settings (key, value, description, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           description = COALESCE(excluded.description, description),
           updated_at = excluded.updated_at`
      )
      .run(key, value, description ?? null, now);
  }

  list(): Setting[] {
    return this.db
      .prepare('SELECT * FROM settings ORDER BY key ASC')
      .all() as Setting[];
  }

  seed(key: string, value: string, description?: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO settings (key, value, description, updated_at)
         VALUES (?, ?, ?, datetime('now'))`
      )
      .run(key, value, description ?? null);
  }
}
