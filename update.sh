#!/bin/bash

set -e  # Exit on error

echo "🔄 Updating jeda-seller without restart..."

# Update code on server
ssh -p 2022 mike@bo.jedatools.ru << 'EOF'
  set -e

  cd /home/mike/jeda-seller

  echo "🔄 Pulling latest changes..."
  git fetch origin
  git reset --hard origin/main

  echo "📦 Installing dependencies..."
  npm install --production

  echo "✅ Update completed (no restart)"
EOF

echo ""
echo "🎉 Update finished! Application NOT restarted."
echo "⚠️  Changes will take effect on next restart or reload."
echo "To restart now: ssh -p 2022 mike@bo.jedatools.ru 'pm2 restart jeda-seller'"
