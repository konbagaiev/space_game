#!/usr/bin/env bash
# Roll the running app container back to a previous image version (zero-downtime, no rebuild).
#
#   ./rollback.sh            roll back to the previous deployed version
#   ./rollback.sh <tag>      roll back to a specific version (git sha tag)
#   ./rollback.sh --list     list available image versions (newest first)
#
# NOTE: this rolls back the CODE only, not DB migrations. Migrations are forward-only and
# kept backward-compatible (expand/contract), so rolling the container back is safe. If a
# migration was destructive, restore the DB from a backup instead.
set -euo pipefail
cd "$(dirname "$0")"

versions() { docker images spacegame --format '{{.Tag}}' | grep -v '^latest$'; }

if [ "${1:-}" = "--list" ]; then
  echo "Available versions (newest first; 1st = current):"
  versions
  exit 0
fi

# default target = second-newest tag (the previous deploy)
target="${1:-$(versions | sed -n '2p')}"
if [ -z "$target" ]; then
  echo "No previous version to roll back to." >&2
  exit 1
fi
if ! docker image inspect "spacegame:$target" >/dev/null 2>&1; then
  echo "No such image: spacegame:$target  (run with --list)" >&2
  exit 1
fi

echo "Rolling back to spacegame:$target ..."
docker tag "spacegame:$target" spacegame:latest
docker rollout -w 10 app
echo "Done. Now running spacegame:$target."
echo "Reminder: DB migrations were NOT rolled back (forward-only by design)."
