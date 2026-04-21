module.exports = {
  apps: [
    {
      name: "yuiju-message",
      script: "pnpm",
      args: "run start:message",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      autorestart: false,
      watch: false,
      max_memory_restart: "1024M",
    },
    {
      name: "yuiju-world",
      script: "pnpm",
      args: "run start:world",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      autorestart: false,
      watch: false,
      max_memory_restart: "1024M",
    },
    {
      name: "yuiju-web",
      script: "pnpm run build:web && pnpm run start:web",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
      },
      autorestart: false,
      watch: false,
      max_memory_restart: "1024M",
    },
  ],
};
