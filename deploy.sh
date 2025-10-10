#!/bin/bash

set -e  # Exit on error

echo "🚀 Deploying jeda-seller to production..."

# Deploy to server
ssh -p 2022 mike@bo.jedatools.ru << 'EOF'
  set -e

  echo "📁 Setting up project directory..."

  # Create project directory if doesn't exist
  if [ ! -d "/home/mike/jeda-seller" ]; then
    mkdir -p /home/mike/jeda-seller
    cd /home/mike/jeda-seller
    echo "📦 Cloning repository..."
    git clone git@github.com:mpavshenko/jeda.git .
  else
    cd /home/mike/jeda-seller
  fi

  echo "🔄 Pulling latest changes..."
  git fetch origin
  git reset --hard origin/master

  echo "📦 Installing dependencies..."
  npm install --production

  echo "🔄 Restarting application with PM2..."
  if pm2 describe jeda-seller > /dev/null 2>&1; then
    pm2 reload ecosystem.config.js --env production
  else
    pm2 start ecosystem.config.js --env production
  fi

  pm2 save

  echo "✅ Deployment completed!"
  echo ""
  pm2 status
EOF

echo ""
echo "🎉 Deploy finished successfully!"
echo "🌐 Application running at http://bo.jedatools.ru"
echo "📊 View logs: ssh -p 2022 mike@bo.jedatools.ru 'pm2 logs jeda-seller'"
