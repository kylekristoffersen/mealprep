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

Recipe/data changes without a browser: put a file in data-updates/ (format at apply_updates() in app.py) and push to main.
The app applies each file once on its next start (a push restarts it), takes a backup first, and skips any doc that was
changed in the app since the update was written. Results show in Settings > Server status. Current data can be read
through the Cook link's /api/cook/<secret> (meals, ingredients, plan).

Prices tab (v0.5): pinned shop products are docs `products/<id>` ({shop, ing, name, url, packG, perKg, usual}).
"Check Rohlík + Košík" makes the server read their public product data (about 2 minutes for everything, less for one week's list) and saves `state/prices`.
Tesco blocks server requests, so its prices come from the "Meal Prep: Tesco prices" bookmark run in your own signed-in Tesco tab; it returns to /#prices&tesco=… and the app saves them.
Data updates can now remove docs: {"delete": true} instead of "data".
Data updates can add missing keys inside a doc without replacing it: {"add": {"items": {...}}} instead of "data" (used for new ingredients in lib/ingredients; existing ones are never overwritten).
