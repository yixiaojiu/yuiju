// 复制为 ecosystem.config.js 后按部署环境修改；实际配置不提交到 Git。
// 替换为 config.characters 中的角色 ID，同一环境中的同一角色只启动一个实例。
const characterId = "your-character-id";

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
      name: `yuiju-${characterId}`,
      script: "pnpm",
      args: `run start:character-runtime --character ${characterId}`,
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
