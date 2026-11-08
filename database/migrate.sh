#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/database/migrations"

command -v psql >/dev/null 2>&1 || {
  echo "ERROR: psql (PostgreSQL client) is required." >&2
  exit 1
}
[[ -d "$MIGRATIONS_DIR" ]] || {
  echo "ERROR: migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
}

shopt -s nullglob
migration_files=("$MIGRATIONS_DIR"/*.sql)
((${#migration_files[@]} > 0)) || {
  echo "ERROR: no migration SQL files found in $MIGRATIONS_DIR" >&2
  exit 1
}

psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
SQL

for file in "${migration_files[@]}"; do
  name="$(basename "$file")"
  # Filenames are repository-controlled; escape single quotes defensively.
  sql_name="${name//\'/\'\'}"
  applied="$(psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -Atqc \
    "SELECT 1 FROM schema_migrations WHERE filename = '$sql_name'")"

  if [[ "$applied" == "1" ]]; then
    echo "Skipping already applied migration: $name"
    continue
  fi

  echo "Applying $name"
  {
    printf 'BEGIN;\n'
    cat "$file"
    printf '\nINSERT INTO schema_migrations(filename) VALUES ('
    printf "'%s');\n" "$sql_name"
    printf 'COMMIT;\n'
  } | psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1
done

echo "DATABASE_MIGRATIONS_APPLIED"
