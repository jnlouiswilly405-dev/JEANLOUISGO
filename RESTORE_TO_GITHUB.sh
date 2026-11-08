#!/usr/bin/env bash
set -euo pipefail
REPO_URL="https://github.com/jnlouiswilly405-dev/JEANLOUISGO.git"
BASE_BRANCH="recovery-v45-api-perimeter"
BRANCH="recovery/v45-source-restore"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE="$HERE/jlgo_v3_check"
TARGET="$HERE/JEANLOUISGO-github"

command -v git >/dev/null 2>&1 || { echo "Git is required." >&2; exit 1; }
[[ -d "$SOURCE" ]] || { echo "Missing source folder: $SOURCE" >&2; exit 1; }
[[ ! -e "$TARGET" ]] || { echo "Target already exists: $TARGET. Move it before retrying." >&2; exit 1; }

git clone "$REPO_URL" "$TARGET"
git -C "$TARGET" fetch origin
if ! git -C "$TARGET" show-ref --verify --quiet "refs/remotes/origin/$BASE_BRANCH"; then
  echo "Required base branch origin/$BASE_BRANCH was not found; stopping without changes." >&2
  exit 1
fi
git -C "$TARGET" checkout -b "$BRANCH" "origin/$BASE_BRANCH"
# Add missing recovery files without overwriting the current branch's README/status/package files.
cp -an "$SOURCE/." "$TARGET/"
chmod +x "$TARGET/database/migrate.sh"
git -C "$TARGET" add -A
if git -C "$TARGET" diff --cached --quiet; then
  echo "No new files to commit; stopping safely."; exit 0
fi
git -C "$TARGET" commit -m "Restore JEANLOUISGO backend source and PostgreSQL CI v45"
git -C "$TARGET" push -u origin "$BRANCH"
echo "Pushed branch: $BRANCH"
echo "Review: https://github.com/jnlouiswilly405-dev/JEANLOUISGO/tree/$BRANCH"
echo "Do not merge until PostgreSQL CI, backend build and tests pass."
