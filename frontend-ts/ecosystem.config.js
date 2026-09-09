const path = require('path');

module.exports = {
  apps: [
    {
      name: 'frontend',
      script: 'node_modules/.bin/vite',
      cwd: path.resolve(__dirname),
      args: 'dev',
      instances: 1,
      exec_mode: 'cluster',
      error: './logs/err.log',
      out: './logs/out.log',
      log: './logs/combined.log',
    }
  ]
};
