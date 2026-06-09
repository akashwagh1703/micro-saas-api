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
      max_memory_restart: '768M',
      env: {
        NODE_ENV: 'production',
      },
      // All secrets (DATABASE_URL, APP_ENCRYPTION_KEY, QUEUE_DRIVER=pgboss, job API keys)
      // must live in .env in cwd — Nest ConfigModule loads it on boot.
      // After editing .env: pm2 restart autowave-api --update-env
    },
  ],
};
