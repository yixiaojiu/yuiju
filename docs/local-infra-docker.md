# 数据库本地基础依赖（Docker）

如果本机没有安装 MongoDB / Redis，推荐用本仓库根目录的 `docker-compose.infra.yml` 先启动基础依赖。

## 1. 启动基础依赖

在仓库根目录执行：

```bash
pnpm run infra:up
```

或：

```bash
docker compose -f docker-compose.infra.yml up -d
```

查看状态：

```bash
pnpm run infra:ps
```

查看日志：

```bash
pnpm run infra:logs
```

停止并删除容器：

```bash
pnpm run infra:down
```

## 2. 配置项目连接地址

确保根目录存在 `yuiju.config.ts`

```bash
cp yuiju.config.ts.example yuiju.config.ts
```

确认以下配置项：

- `database.mongoUri`: `mongodb://localhost:27017/yuiju?authSource=admin`
- `database.redisUrl`: `redis://localhost:6379`

## 3. 启动项目服务（开发）

```bash
pnpm run dev:world
pnpm run dev:web
pnpm run dev:message
pnpm run start:python
```

## 4. 常见问题

- `world` / `message` 无法启动并提示 Mongo 配置错误：
  - `connectDB` 会强制要求 `yuiju.config.ts` 中 `database.mongoUri` 非空且可连接。
- `message` 启动失败：
  - 除 MongoDB 外，还依赖 OneBot / Lark 连接信息可用与 `message.onebot` / `message.lark` 配置正确。
- `web` 部分接口不可用：
  - 依赖数据库数据的接口（如 activity/diary）在 Mongo 异常时会失败。
