#!/bin/sh
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"  # cron starts with a short PATH that has no nginx
# Switches the live nginx site from the browser password popup to the app's own sign-in page.
# Safe by design: edits the live file in place (keeps the HTTPS settings certbot added), only does it
# once the app itself refuses unsigned requests, and puts the old file back if nginx rejects the change.
# Every run writes its outcome to $STATUS, which Settings > Server status shows.
SITE=/etc/nginx/sites-available/mealprep
BAK=/var/lib/mealprep/nginx-site.before-app-login
STATUS=/var/lib/mealprep/nginx-switch-status
say(){ printf '%s %s\n' "$(date '+%F %T')" "$1" > "$STATUS"; chmod 644 "$STATUS" 2>/dev/null; }
if [ ! -f "$SITE" ]; then
  say "Not switched: $SITE not found. Other nginx sites using this address: $(grep -lr 'mealprep.107-173-7-177' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | tr '\n' ' ')"; exit 0; fi
# the popup can come from the site file or from a file it includes
FILES="$SITE $(grep -hE '^[[:space:]]*include' "$SITE" | sed -E 's/^[[:space:]]*include[[:space:]]+([^;]+);.*/\1/' | tr '\n' ' ')"
HAS=""; for f in $FILES; do [ -f "$f" ] && grep -qE '^[[:space:]]*auth_basic' "$f" && HAS="$HAS $f"; done
if [ -z "$HAS" ]; then
  OTHER=$(grep -lrE '^[[:space:]]*auth_basic' /etc/nginx/nginx.conf /etc/nginx/conf.d /etc/nginx/sites-enabled 2>/dev/null | tr '\n' ' ')
  if [ -n "$OTHER" ]; then say "Not switched: the mealprep site has no password lines, but these nginx files do: $OTHER"; else say "Switched: nginx has no password popup."; fi
  exit 0; fi
# the app must be up and must ask for a sign-in by itself, otherwise taking nginx's check away would open the site
if command -v curl >/dev/null 2>&1; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:5020/api/all)
else
  CODE=$(/opt/mealprep-venv/bin/python -c "import urllib.request as u,urllib.error as e
try: print(u.urlopen('http://127.0.0.1:5020/api/all',timeout=5).status)
except e.HTTPError as x: print(x.code)
except Exception: print('000')" 2>/dev/null)
fi
if [ "$CODE" != "401" ]; then say "Waiting: the app answered $CODE to an unsigned request, expected 401 (the popup stays on until it does)."; exit 0; fi
mkdir -p /var/lib/mealprep
for f in $HAS; do cp -p "$f" "$f.mealprep-before-app-login" 2>/dev/null; done
cp -p "$SITE" "$BAK"
for f in $HAS; do sed -i -E '/^[[:space:]]*auth_basic/d; s|^([[:space:]]*)proxy_set_header X-Remote-User .*$|\1proxy_set_header X-Real-IP $remote_addr;|' "$f"; done
if T=$(nginx -t 2>&1); then
  if R=$(systemctl reload nginx 2>&1); then say "Switched: password lines removed from$HAS and nginx reloaded."
  else say "Edited$HAS but nginx did not reload: $R"; fi
else
  for f in $HAS; do [ -f "$f.mealprep-before-app-login" ] && cp -p "$f.mealprep-before-app-login" "$f"; done
  nginx -t >/dev/null 2>&1 && systemctl reload nginx
  say "Not switched: nginx rejected the edit, old files restored. nginx said: $(echo "$T" | tr '\n' ' ' | cut -c1-400)"
fi
