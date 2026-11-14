#!/bin/sh
# Runs every minute from /etc/cron.d/mealprep: pull the repo, restart the app only if something changed.
exec 9>/var/lock/mealprep-update.lock
flock -n 9 || exit 0
cd /opt/mealprep || exit 1
OLD=$(git rev-parse HEAD)
git pull -q --ff-only || exit 1
NEW=$(git rev-parse HEAD)
[ "$OLD" = "$NEW" ] && exit 0
echo "$(date '+%F %T') updated $OLD -> $NEW"
/opt/mealprep-venv/bin/pip install -q -r requirements.txt
systemctl restart mealprep
