module.exports = {
  apps: [
    {
      name: 'imgnest-api',
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '450M',
      env: { NODE_ENV: 'production' }
    },
    {
      name: 'imgnest-worker',
      script: 'dist/workers/scheduler.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '350M',
      env: { NODE_ENV: 'production', ENABLE_SCHEDULER: 'true' }
    }
  ]
};
