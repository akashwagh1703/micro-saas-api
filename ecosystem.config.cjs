/** PM2 process file — start with: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'autowave-api',
      script: 'dist/main.js',
      cwd: '/var/www/autowave/micro-saas-api',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
