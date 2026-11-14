#!/bin/sh
# Switches the live nginx site from the browser password popup to the app's own sign-in page.
# Safe by design: edits the live file in place (keeps the HTTPS settings certbot added), only does it
# once the app itself refuses unsigned requests, and puts the old file back if nginx rejects the change.
SITE=/etc/nginx/sites-available/mealprep
BAK=/var/lib/mealprep/nginx-site.before-app-login
[ -f "$SITE" ] || exit 0
grep -qE '^[[:space:]]*auth_basic' "$SITE" || exit 0          # already switched
# the app must be up and must ask for a sign-in by itself, otherwise taking nginx's check away would open the site
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:5020/api/all)
[ "$CODE" = "401" ] || { echo "$(date '+%F %T') nginx login switch postponed: app answered $CODE, expected 401"; exit 0; }
mkdir -p /var/lib/mealprep && cp -p "$SITE" "$BAK"
sed -i -E '/^[[:space:]]*auth_basic/d; s|^([[:space:]]*)proxy_set_header X-Remote-User .*$|\1proxy_set_header X-Real-IP $remote_addr;|' "$SITE"
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx && echo "$(date '+%F %T') nginx switched to the in-page sign-in"
else
  cp -p "$BAK" "$SITE"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  echo "$(date '+%F %T') nginx rejected the change; old config restored"
fi
