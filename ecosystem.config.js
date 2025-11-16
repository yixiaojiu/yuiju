module.exports = {
  apps: [
    {
      name: "yuiju-message",
      script: "pnpm",
      args: "run start:message",
      cwd: __dirname,
      env: {
        NODE_ENV: "production"
      },
      autorestart: true,
      watch: false,
      max_memory_restart: "512M"
    }
  ]
}