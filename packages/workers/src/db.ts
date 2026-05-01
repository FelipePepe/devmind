import Database from 'better-sqlite3';

// Workers opens the same DB file as backend in WAL mode (concurrent access safe).
// Schema is owned by backend — workers does NOT run migrations.

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const dbPath = process.env['DB_PATH'] ?? './data/devmind.db';
  _db = new Database(dbPath);
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  return _db;
}

export function getDbInstance(): Database.Database {
  return getDb();
}
