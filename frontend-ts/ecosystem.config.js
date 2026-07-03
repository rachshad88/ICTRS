module.exports = {
  apps: [
    {
      name: 'frontend',
      script: 'node_modules/.bin/vite',
      cwd: './',
      args: 'dev',
      instances: 1,
      exec_mode: 'cluster',
      error: './logs/err.log',
      out: './logs/out.log',
      log: './logs/combined.log',
    }
  ]
};
