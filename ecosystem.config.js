module.exports = {
  apps: [{
    name: 'jeda-seller',
    script: './index.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',

    // Environment variables
    env: {
      NODE_ENV: 'production',
      PORT: 80
    },

    // Logging configuration
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,

    // Log rotation (requires pm2-logrotate module)
    // Install with: pm2 install pm2-logrotate
    // Configure with:
    //   pm2 set pm2-logrotate:max_size 10M
    //   pm2 set pm2-logrotate:retain 30
    //   pm2 set pm2-logrotate:compress true
    //   pm2 set pm2-logrotate:dateFormat YYYY-MM-DD
    //   pm2 set pm2-logrotate:rotateModule true

    // Process management
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 10000,

    // Error handling
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 4000,

    // Advanced features
    instance_var: 'INSTANCE_ID',
    combine_logs: true
  }],

  deploy: {
    production: {
      user: 'mike',
      host: 'bo.jedatools.ru',
      port: 2022,
      ref: 'origin/master',
      repo: 'git@github.com:mpavshenko/jeda.git',
      path: '/home/mike/jeda-seller',
      'post-deploy': 'npm install --production && pm2 reload ecosystem.config.js --env production && pm2 save',
      'pre-setup': 'mkdir -p /home/mike/jeda-seller'
    }
  }
};
