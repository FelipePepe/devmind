import type Database from 'better-sqlite3';

export interface FeatureFlag {
  key: string;
  value: string;
  description: string | null;
  updated_at: string;
}

export class FlagsRepo {
  constructor(private db: Database.Database) {}

  get(key: string): FeatureFlag | undefined {
    return this.db
      .prepare('SELECT * FROM feature_flags WHERE key = ?')
      .get(key) as FeatureFlag | undefined;
  }

  set(key: string, value: string, description?: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO feature_flags (key, value, description, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value,
           description = COALESCE(excluded.description, description),
           updated_at = excluded.updated_at`
      )
      .run(key, value, description ?? null, now);
  }

  list(): FeatureFlag[] {
    return this.db
      .prepare('SELECT * FROM feature_flags ORDER BY key ASC')
      .all() as FeatureFlag[];
  }
}
