const path = require('path');

module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'dist/index.js',
      cwd: path.resolve(__dirname),
      // One process per core, less two left for MongoDB and nginx (10 on the 12-core server).
      // They share sockets, the login throttle and caches through Redis (src/config/database.ts);
      // timed jobs run in instance 0 only. Deploy with `pm2 reload backend` for no downtime.
      instances: -2,
      exec_mode: 'cluster',
      // A process that leaks past this is replaced; the others keep serving meanwhile.
      max_memory_restart: '400M',
      // Matches the 10 s graceful shutdown in src/index.ts.
      kill_timeout: 11000,
      error: './logs/err.log',
      out: './logs/out.log',
      log: './logs/combined.log',
      cron: '0 5 * * * pm2 flush && pm2 save',
    }
  ]
};
