/** PM2 process file — start with: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'autowave-api',
      script: 'scripts/api-entry.cjs',
      cwd: '/var/www/autowave/micro-saas-api',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '1024M',
      max_restarts: 20,
      min_uptime: '10s',
      restart_delay: 5000,
    },
  ],
};
