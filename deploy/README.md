# Hosting notes (Meal Prep Planner on the VPS)

- Address: https://mealprep.107-173-7-177.sslip.io (two logins: `kyle`, `annie`; each can change their own password in Settings).
- Code: /opt/mealprep (clone of this repo, pulled every minute by /etc/cron.d/mealprep -> deploy/update.sh).
- Python libraries: /opt/mealprep-venv. Service: `mealprep` (systemd), port 5020 on the server only.
- Data (NOT in the repo): /var/lib/mealprep/mealprep.db, nightly backups in /var/lib/mealprep/backups (Settings tab has Download / Restore).
- nginx site: /etc/nginx/sites-available/mealprep, built from deploy/nginx-site.conf.template. Password file: /etc/nginx/.mealprep-htpasswd (separate from the other tools).
- Passwordless page: /cook/<secret> (read-only cooking steps). The secret is made in the app; Settings/Cook tab has "New link" to switch the old one off.

To update: change the code, bump `APP_VERSION` in app.py, push to main. The server picks it up within about a minute and restarts the app.
If requirements.txt changes the update script installs the new libraries automatically.
If deploy/mealprep.service changes it must be re-installed once: `sudo sh /opt/mealprep/deploy/install-app.sh`.
