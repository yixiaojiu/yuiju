module.exports = {
  apps: [
    {
      name: "yuiju-world",
      script: "pnpm",
      args: "run start:world-simulator",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        NODE_USE_ENV_PROXY: "1",
      },
      autorestart: false,
      watch: false,
      max_memory_restart: "1024M",
    },
    {
      name: "yuiju-char",
      script: "pnpm",
      args: "run start:character-runtime",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        NODE_USE_ENV_PROXY: "1",
      },
      autorestart: false,
      watch: false,
      max_memory_restart: "1024M",
    },
    {
      name: "yuiju-web",
      script: "pnpm",
      args: "run start:dashboard",
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
