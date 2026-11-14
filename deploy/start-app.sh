#!/bin/sh
# Switch on the every-minute auto-update and start the app.
set -e
chmod +x /opt/mealprep/deploy/update.sh
printf '* * * * * root /opt/mealprep/deploy/update.sh >> /var/log/mealprep-update.log 2>&1\n' > /etc/cron.d/mealprep
chmod 644 /etc/cron.d/mealprep
systemctl restart mealprep
sleep 3
echo "Service: $(systemctl is-active mealprep)"
curl -s -o /dev/null -w "App answers on the server: HTTP %{http_code}\n" http://127.0.0.1:5020/api/health
