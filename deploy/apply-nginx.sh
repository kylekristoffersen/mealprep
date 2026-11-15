#!/bin/sh
# Switches the live nginx site from the browser password popup to the app's own sign-in page.
# Safe by design: edits the live file in place (keeps the HTTPS settings certbot added), only does it
# once the app itself refuses unsigned requests, and puts the old file back if nginx rejects the change.
SITE=/etc/nginx/sites-available/mealprep
BAK=/var/lib/mealprep/nginx-site.before-app-login
[ -f "$SITE" ] || exit 0
grep -qE '^[[:space:]]*auth_basic' "$SITE" || exit 0          # already switched
# the app must be up and must ask for a sign-in by itself, otherwise taking nginx's check away would open the site
if command -v curl >/dev/null 2>&1; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:5020/api/all)
else  # no curl on the server: ask with the app's own Python instead
  CODE=$(/opt/mealprep-venv/bin/python -c "import urllib.request as u,urllib.error as e
try: print(u.urlopen('http://127.0.0.1:5020/api/all',timeout=5).status)
except e.HTTPError as x: print(x.code)
except Exception: print('000')" 2>/dev/null)
fi
if [ "$CODE" != "401" ]; then
  LAST=/var/lib/mealprep/nginx-switch-last-reason
  [ "$(cat "$LAST" 2>/dev/null)" = "$CODE" ] || { echo "$(date '+%F %T') nginx login switch postponed: app answered $CODE, expected 401"; echo "$CODE" > "$LAST"; }
  exit 0
fi
mkdir -p /var/lib/mealprep && cp -p "$SITE" "$BAK"
sed -i -E '/^[[:space:]]*auth_basic/d; s|^([[:space:]]*)proxy_set_header X-Remote-User .*$|\1proxy_set_header X-Real-IP $remote_addr;|' "$SITE"
if nginx -t >/dev/null 2>&1; then
  systemctl reload nginx && echo "$(date '+%F %T') nginx switched to the in-page sign-in"
else
  cp -p "$BAK" "$SITE"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  echo "$(date '+%F %T') nginx rejected the change; old config restored"
fi
