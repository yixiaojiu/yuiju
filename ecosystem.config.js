module.exports = {
  apps: [
    {
      name: 'yuiju-message',
      script: 'pnpm',
      args: 'run start:message',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
      },
      autorestart: false,
      watch: false,
      max_memory_restart: '512M',
    },
  ],
};
