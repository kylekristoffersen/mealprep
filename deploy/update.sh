#!/bin/sh
# Runs every minute from /etc/cron.d/mealprep: pull the repo, restart the app only if something changed.
exec 9>/var/lock/mealprep-update.lock
flock -n 9 || exit 0
cd /opt/mealprep || exit 1
sh deploy/apply-nginx.sh   # no-op once nginx no longer asks for a password
OLD=$(git rev-parse HEAD)
if ! OUT=$(git pull -q --ff-only 2>&1); then
  LAST=/var/lib/mealprep/update-last-error
  [ "$(cat "$LAST" 2>/dev/null)" = "$OUT" ] || { echo "$(date '+%F %T') update failed: $OUT"; printf '%s' "$OUT" > "$LAST"; }
  exit 1
fi
rm -f /var/lib/mealprep/update-last-error
NEW=$(git rev-parse HEAD)
[ "$OLD" = "$NEW" ] && exit 0
echo "$(date '+%F %T') updated $OLD -> $NEW"
/opt/mealprep-venv/bin/pip install -q -r requirements.txt || echo "$(date '+%F %T') pip install failed; the app may not start"
systemctl restart mealprep
