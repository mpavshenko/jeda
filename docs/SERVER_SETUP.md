# Server Setup Resume - Ubuntu Production Server

## 1. Node.js Upgrade
```bash
# Upgraded from Node 20 to Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v  # Verified v22.x.x
```

## 2. PM2 Installation & Configuration
```bash
# Installed PM2 process manager
sudo npm install -g pm2

# Installed log rotation module
pm2 install pm2-logrotate

# Configured log rotation
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
pm2 set pm2-logrotate:compress true
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD

# Setup PM2 to start on boot
pm2 startup
# (followed the command output instructions)
```

## 3. SSH Configuration
```bash
# Configured SSH to access GitHub over port 443
nano ~/.ssh/config
# Added:
# Host github.com
#     Hostname ssh.github.com
#     Port 443

# Added local machine's SSH key to server
echo "PUBLIC_KEY" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
chmod 700 ~/.ssh
```

## 4. Apache Removal
```bash
# Removed Apache to free port 80
sudo systemctl stop apache2
sudo systemctl disable apache2
sudo apt-get purge apache2 apache2-utils apache2-bin -y
sudo apt-get autoremove -y
sudo rm -rf /etc/apache2
```

## 5. Application Deployment
```bash
# Created project directory
mkdir -p /home/mike/jeda-seller
cd /home/mike/jeda-seller

# Cloned repository
git clone git@github.com:mpavshenko/jeda.git .

# Created .env file with Ozon credentials
nano .env
# (added OZON_CLIENT_ID, OZON_API_KEY, etc.)

# Installed dependencies
npm install --production
```

## 6. Port 80 Permissions
```bash
# Gave Node.js permission to bind to port 80
sudo setcap cap_net_bind_service=+ep $(which node)

# Started application with PM2
pm2 start ecosystem.config.js --env production
pm2 save
```

## 7. Verification
```bash
# Checked status
pm2 status
pm2 logs jeda-seller

# Tested application
curl http://localhost
curl http://bo.jedatools.ru

# Application now running at:
# http://bo.jedatools.ru
# http://bo.jedatools.ru/reports/
# http://bo.jedatools.ru/logs/
```

## Result

Node.js application running on port 80 with PM2, auto-restart on boot, daily log rotation, scheduled cron reports every 5 minutes.

## Daily Operations

```bash
# Deploy updates
npm run deploy

# View logs
pm2 logs jeda-seller

# Restart application
pm2 restart jeda-seller

# Monitor performance
pm2 monit
```
