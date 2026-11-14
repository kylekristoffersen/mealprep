#!/bin/sh
# Install Python, the app's libraries, the data folder and the service. Does NOT start the app.
set -e
APP=/opt/mealprep
VENV=/opt/mealprep-venv
DATA=/var/lib/mealprep
PORT=5020
echo "1/5 Installing system packages..."
apt-get update -qq
apt-get install -y -qq python3-venv python3-pip apache2-utils > /dev/null
echo "2/5 Creating the Python environment..."
[ -d "$VENV" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --upgrade pip
"$VENV/bin/pip" install -q -r "$APP/requirements.txt"
echo "3/5 Creating the data folder (outside the repo)..."
mkdir -p "$DATA"
chown www-data:www-data "$DATA"
chmod 700 "$DATA"
echo "4/5 Checking that port $PORT is free..."
if ! systemctl is-active --quiet mealprep && ss -ltn | grep -q ":$PORT "; then
  echo "PROBLEM: port $PORT is already used by something else. Stop here and tell Kyle's assistant."
  exit 1
fi
echo "5/5 Installing the service..."
cp "$APP/deploy/mealprep.service" /etc/systemd/system/mealprep.service
systemctl daemon-reload
systemctl enable mealprep > /dev/null 2>&1
echo
echo "DONE. Meal Prep is installed but not started yet."
