#!/bin/bash
#
# MongoDB backup for the `avis` database.
#
# WHAT IS IN HERE, AND WHAT IS REPRODUCIBLE:
#
#   ds, bc, cp, parc      ~343k docs / 93 MB — atomic-reload targets of the
#                         ~/import ETL (ds.py, bc.py, cp.py, parc.py), sourced
#                         from Excel in Google Drive. Reproducible by re-running
#                         the pipeline — but a re-import reproduces TODAY's
#                         source file, not the state as of this backup. If a bad
#                         transform or a changed spreadsheet is what you are
#                         recovering from, only this archive has the old state.
#
#   pipeline_runs,        ETL run history and cursor state. Generated, not
#   pipeline_state        derived. NOT reproducible.
#
#   sheetFieldOptions,    App data. NOT reproducible.
#   ja, jal, api_rate_limit
#
# The whole database is backed up regardless: ~9 MB compressed, so excluding
# the reproducible 99% would save little and risk missing something.
#
# Takes ~3 minutes — network-bound to Atlas, not CPU-bound.
#
# ─── RESTORE ─────────────────────────────────────────────────────────────────
#
# Full restore, overwriting the live database (DESTRUCTIVE — --drop replaces
# each collection in the archive as it is restored):
#
#   MONGODB_URI=$(sed -n 's/^MONGODB_URI=//p' .env.local | head -1 | tr -d '"')
#   mongorestore --uri="$MONGODB_URI" --gzip --drop \
#     --archive=~/backups/avis-db-YYYYMMDD-HHMMSS.archive.gz
#
# Safer: restore into a scratch database, then copy out only what you need.
# This never touches the live `avis` database:
#
#   mongorestore --uri="$MONGODB_URI" --gzip \
#     --archive=~/backups/avis-db-YYYYMMDD-HHMMSS.archive.gz \
#     --nsFrom='avis.*' --nsTo='avis_restore.*'
#
#   # restore a single collection back over the live one:
#   mongosh "$MONGODB_URI" --eval '
#     const src = db.getSiblingDB("avis_restore").parc.find().toArray();
#     const dst = db.getSiblingDB("avis").parc;
#     dst.drop(); dst.insertMany(src);
#   '
#
#   # clean up when done:
#   mongosh "$MONGODB_URI" --eval 'db.getSiblingDB("avis_restore").dropDatabase()'
#
# Inspect an archive without restoring anything:
#
#   mongorestore --gzip --archive=<file> --dryRun -v 2>&1 | grep 'restoring'
#
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$REPO_DIR/.env.local"
DEST_DIR="$HOME/backups"
PREFIX="avis-db"
KEEP=14

# Read the two vars we need without sourcing .env.local — sourcing would execute
# whatever is in that file, and it is not a shell script.
read_env() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | head -1 | sed 's/^["'\'']//; s/["'\'']$//'
}

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found — cannot read the connection string." >&2
  exit 1
fi

if ! command -v mongodump >/dev/null 2>&1; then
  echo "✗ mongodump not found. Install the MongoDB Database Tools:" >&2
  echo "    https://www.mongodb.com/docs/database-tools/installation/" >&2
  exit 1
fi

MONGODB_URI="$(read_env MONGODB_URI)"
MONGODB_DB="$(read_env MONGODB_DB)"

if [ -z "$MONGODB_URI" ] || [ -z "$MONGODB_DB" ]; then
  echo "✗ MONGODB_URI or MONGODB_DB missing from $ENV_FILE — refusing to run." >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="$DEST_DIR/$PREFIX-$STAMP.archive.gz"

echo "→ [$(date '+%Y-%m-%d %H:%M:%S')] Dumping database '$MONGODB_DB' …"

# mongodump's progress/error output is deliberately NOT suppressed with
# --quiet: when a run fails, the reason has to reach the log, or the log is
# useless. The extra progress lines are worth it.
#
# Note: the URI carries inline credentials and mongodump only accepts it as an
# argument, so it is briefly visible in `ps` output to other users on this
# machine. Accepted tradeoff on a single-user desktop.
if ! mongodump \
  --uri="$MONGODB_URI" \
  --db="$MONGODB_DB" \
  --archive="$ARCHIVE" \
  --gzip; then
  echo "✗ mongodump failed — no usable backup was written." >&2
  rm -f "$ARCHIVE"
  exit 1
fi

# A mongodump that exits 0 but leaves a truncated or empty file is the classic
# silent backup failure. Verify the archive is real before trusting it.
if [ ! -s "$ARCHIVE" ]; then
  echo "✗ Archive is empty — treating as a failed backup." >&2
  rm -f "$ARCHIVE"
  exit 1
fi

if ! gzip -t "$ARCHIVE" 2>/dev/null; then
  echo "✗ Archive failed a gzip integrity check — treating as a failed backup." >&2
  rm -f "$ARCHIVE"
  exit 1
fi

echo "✓ Backup: $ARCHIVE"
ls -lh "$ARCHIVE" | awk '{print "  size: " $5}'

# ─── Prune, keeping the newest $KEEP archives ────────────────────────────────
mapfile -t OLD < <(ls -1t "$DEST_DIR/$PREFIX-"*.archive.gz 2>/dev/null | tail -n +$((KEEP + 1)))
if [ ${#OLD[@]} -gt 0 ]; then
  for f in "${OLD[@]}"; do
    rm -f "$f"
    echo "  pruned: $(basename "$f")"
  done
fi

COUNT="$(ls -1 "$DEST_DIR/$PREFIX-"*.archive.gz 2>/dev/null | wc -l)"
echo "  $COUNT snapshot(s) retained (keeping newest $KEEP)"
