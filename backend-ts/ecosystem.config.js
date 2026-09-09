const path = require('path');

module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'dist/index.js',
      cwd: path.resolve(__dirname),
      instances: 1,
      exec_mode: 'cluster',
      error: './logs/err.log',
      out: './logs/out.log',
      log: './logs/combined.log',
      cron: '0 5 * * * pm2 flush && pm2 save',
    }
  ]
};
