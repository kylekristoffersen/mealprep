#!/bin/sh
# Passwords for Kyle and Annie, the nginx site and the HTTPS certificate. Does not touch other sites.
set -e
APP=/opt/mealprep
DOMAIN=mealprep.107-173-7-177.sslip.io
PORT=5020
HTPASS=/etc/nginx/.mealprep-htpasswd
SITE=/etc/nginx/sites-available/mealprep

echo "Checking that $DOMAIN points to this server..."
getent hosts "$DOMAIN" || { echo "PROBLEM: the address does not resolve."; exit 1; }

if [ ! -f "$HTPASS" ]; then
  echo
  echo "Choose Kyle's password. Type it twice; nothing shows while you type."
  htpasswd -B -c "$HTPASS" kyle
  echo "Choose Annie's password (she can change it later in Settings)."
  htpasswd -B "$HTPASS" annie
else
  echo "Password file already exists; keeping it."
fi
# the app (www-data) may rewrite this file so each person can change their own password in Settings
chown root:www-data "$HTPASS"
chmod 660 "$HTPASS"

sed "s/__DOMAIN__/$DOMAIN/g; s/__PORT__/$PORT/g" "$APP/deploy/nginx-site.conf.template" > "$SITE"
ln -sf "$SITE" /etc/nginx/sites-enabled/mealprep
nginx -t
systemctl reload nginx

echo "Requesting the HTTPS certificate..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect
nginx -t
systemctl reload nginx
echo
echo "DONE. Your site: https://$DOMAIN"
