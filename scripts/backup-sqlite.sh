#!/bin/sh
set -eu

DB_PATH="${1:-${DB_PATH:-/app/data/devmind.db}}"
BACKUP_DIR="${2:-${BACKUP_DIR:-./backups}}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if [ ! -f "$DB_PATH" ]; then
  echo "SQLite DB not found: $DB_PATH" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/devmind-$STAMP.db"
TMP="$OUT.tmp"

sqlite3 "$DB_PATH" "VACUUM INTO '$TMP';"
mv "$TMP" "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
find "$BACKUP_DIR" -name 'devmind-*.db' -mtime "+$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -name 'devmind-*.db.sha256' -mtime "+$RETENTION_DAYS" -delete

echo "$OUT"
