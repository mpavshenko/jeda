# PM2 Production Setup Guide

## Installation

```bash
# Install PM2 globally
npm install -g pm2

# Install PM2 log rotation module
pm2 install pm2-logrotate
```

## Configure Log Rotation

```bash
# Set maximum log file size before rotation (10MB)
pm2 set pm2-logrotate:max_size 10M

# Keep logs for 30 days
pm2 set pm2-logrotate:retain 30

# Compress rotated logs
pm2 set pm2-logrotate:compress true

# Date format for rotated files
pm2 set pm2-logrotate:dateFormat YYYY-MM-DD

# Enable rotation for PM2 modules
pm2 set pm2-logrotate:rotateModule true

# Rotation interval (daily)
pm2 set pm2-logrotate:rotateInterval '0 0 * * *'
```

## Start Application

```bash
# Start with ecosystem config
pm2 start ecosystem.config.js

# Or start directly with options
pm2 start index.js --name jeda-seller --log ./logs/combined.log --time

# Save PM2 process list for auto-restart on reboot
pm2 save

# Setup PM2 to start on system boot
pm2 startup
# Follow the command output instructions
```

## Management Commands

```bash
# Monitor logs in real-time
pm2 logs jeda-seller

# Show only error logs
pm2 logs jeda-seller --err

# Show only output logs
pm2 logs jeda-seller --out

# Clear all logs
pm2 flush

# Monitor CPU/Memory
pm2 monit

# Show process status
pm2 status

# Restart application
pm2 restart jeda-seller

# Reload (zero-downtime restart)
pm2 reload jeda-seller

# Stop application
pm2 stop jeda-seller

# Delete from PM2
pm2 delete jeda-seller

# Show detailed process info
pm2 show jeda-seller
```

## Log Management

Logs are stored in `./logs/` directory:
- `out.log` - Standard output
- `error.log` - Error output
- `combined.log` - Both combined

Rotated logs will be in format:
- `out-2025-10-10.log`
- `error-2025-10-10.log.gz` (compressed)

## Environment Variables

Edit `ecosystem.config.js` to add/modify environment variables:

```javascript
env: {
  NODE_ENV: 'production',
  PORT: 3000,
  TEST_MODE: 'false'
}
```

## Monitoring

```bash
# Install PM2 web interface (optional)
pm2 install pm2-server-monit

# View at http://localhost:9615
```

## Backup PM2 Configuration

```bash
# Dump current PM2 processes
pm2 save

# Restore from dump
pm2 resurrect
```

## Troubleshooting

```bash
# If app crashes, check logs
pm2 logs jeda-seller --lines 100

# Check if cron is running
pm2 logs jeda-seller | grep "Scheduled report generation"

# Restart if needed
pm2 restart jeda-seller

# Clear logs if they're too large
pm2 flush jeda-seller
```

## Production Checklist

- [ ] PM2 installed globally
- [ ] pm2-logrotate module installed and configured
- [ ] Application started with `pm2 start ecosystem.config.js`
- [ ] PM2 process list saved with `pm2 save`
- [ ] PM2 startup configured for auto-restart on reboot
- [ ] Logs directory created: `mkdir -p logs`
- [ ] Test cron schedule is working: check logs after scheduled time
- [ ] Monitor memory usage with `pm2 monit`
- [ ] Configure firewall to allow port 3000 (if needed)
