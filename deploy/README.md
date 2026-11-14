# Hosting notes (Meal Prep Planner on the VPS)

- Address: https://mealprep.107-173-7-177.sslip.io (two logins: `kyle`, `annie`; each can change their own password in Settings).
- Code: /opt/mealprep (clone of this repo, pulled every minute by /etc/cron.d/mealprep -> deploy/update.sh).
- Python libraries: /opt/mealprep-venv. Service: `mealprep` (systemd), port 5020 on the server only.
- Data (NOT in the repo): /var/lib/mealprep/mealprep.db, nightly backups in /var/lib/mealprep/backups (Settings tab has Download / Restore).
- Sign-in: the app's own /login page (no browser popup). It checks the password file /etc/nginx/.mealprep-htpasswd (separate from the other tools) and sets a 30-day session cookie; Settings has Sign out. Changing a password signs that person out on their other devices.
- nginx site: /etc/nginx/sites-available/mealprep, built from deploy/nginx-site.conf.template. It only passes traffic to the app. On an older install, deploy/apply-nginx.sh (run by update.sh) removes the old basic-auth lines once the app itself answers 401, and restores the old file if nginx rejects the edit (copy kept at /var/lib/mealprep/nginx-site.before-app-login).
- Passwordless page: /cook/<secret> (read-only cooking steps). The secret is made in the app; Settings/Cook tab has "New link" to switch the old one off.

To update: change the code, bump `APP_VERSION` in app.py, push to main. The server picks it up within about a minute and restarts the app.
If requirements.txt changes the update script installs the new libraries automatically.
If deploy/mealprep.service changes it must be re-installed once: `sudo sh /opt/mealprep/deploy/install-app.sh`.
