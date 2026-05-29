#!/bin/sh
# Incremental rsync backup for workspace/, storage/, and vectors/ volumes.
# These are complementary to the SQLite WAL-safe backup (backup-sqlite.sh).
set -eu

SRC_WORKSPACE="${1:-${WORKSPACE_ROOT:-/app/workspace}}"
SRC_STORAGE="${2:-${STORAGE_BASE_PATH:-/app/storage}}"
SRC_VECTORS="${3:-${VECTOR_DB_PATH:-/app/vectors}}"
BACKUP_DIR="${4:-${BACKUP_DIR:-./backups/files}}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$BACKUP_DIR/$STAMP"

mkdir -p "$DEST"

rsync -a --delete "$SRC_WORKSPACE/" "$DEST/workspace/"
rsync -a --delete "$SRC_STORAGE/"   "$DEST/storage/"
rsync -a --delete "$SRC_VECTORS/"   "$DEST/vectors/"

# Prune older than RETENTION_DAYS (each backup is a dated directory)
find "$BACKUP_DIR" -maxdepth 1 -type d -name '????????????????????Z' \
  -mtime "+$RETENTION_DAYS" -exec rm -rf {} +

echo "$DEST"
