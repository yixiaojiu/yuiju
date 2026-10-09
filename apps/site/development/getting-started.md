# 本地开发

本页保留旧版 World、Message 的开发说明。旧 Web 已删除，页面入口改为新版 Dashboard。

## 准备环境

- Node.js 24
- pnpm 10.14.x
- MongoDB
- Redis

Node.js 和 pnpm 版本分别记录在根目录 `.node-version` 和 `package.json`。请自行安装并启动 MongoDB 和 Redis。

## 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

## 创建本地配置

复制配置示例：

```bash
cp yuiju.config.json.example yuiju.config.json
```

示例使用本机服务地址。将 `app.memoryDir` 改为当前机器上的绝对路径，并确认连接地址：

```jsonc
{
  "app": {
    "memoryDir": "/当前机器上的绝对路径/data/memory"
  },
  "database": {
    "mongoUri": "mongodb://localhost:27017/yuiju?authSource=admin",
    "redisUrl": "redis://localhost:6379"
  },
  "message": {
    "onebot": {
      "endpoint": "ws://localhost:3001"
    }
  }
}
```

然后填写 `llm.models`。如果需要连接 QQ 或飞书，再填写对应平台的账号、密钥和白名单。

`yuiju.config.json` 会包含 API Key 和平台密钥，不要提交到 Git。

## 启动项目

建议分别打开终端运行各服务。

启动世界引擎：

```bash
pnpm run dev:world
```

启动 Dashboard：

```bash
pnpm run dev:dashboard
```

启动后访问 `http://localhost:5179`。Dashboard 使用 `data/config/config.json`，读取新版 `world-simulator` 和 `character-runtime` 产生的数据；上面的旧版配置和世界服务不能为它提供数据。

配置好 OneBot 或飞书后，再启动消息服务：

```bash
pnpm run dev:message
```

需要调试长期记忆图谱时，另外启动 Python 服务：

```bash
pnpm run start:python
```

## 提交前检查

```bash
pnpm run format:write
pnpm run lint
pnpm run type-check
```

修改 World 后，还应运行：

```bash
pnpm run test:world
```

## 常见问题

### MongoDB 或 Redis 连接失败

先检查服务是否正在运行，再确认 `database.mongoUri` 和 `database.redisUrl` 与实际服务地址一致。

### 消息服务启动失败

确认 OneBot 或飞书服务本身可访问，并检查平台连接信息和白名单。暂时不开发消息能力时，不需要启动 `dev:message`。

### Dashboard 中部分内容加载失败

检查 `data/config/config.json` 中的数据库连接与部署模式，并确认新版世界、角色服务已产生相应数据。
