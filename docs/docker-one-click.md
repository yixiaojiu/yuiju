# 一键部署（单镜像）

目标：把项目内的 `world + web + message` 作为**一个应用镜像**发布，并通过 `docker compose` 一键拉起。

## 方案

- 应用层：`Dockerfile` 构建 `yuiju:latest`，容器内用 `pm2-runtime` 同时拉起 3 个服务。
- 基础设施层：`docker-compose.yml` 同时编排 `mongodb` 和 `redis`。
- 配置层：统一使用挂载到容器内的 `yuiju.config.ts`。当前配置读取器不会自动读取 `YUIJU_*` 环境变量，只有当你的 `yuiju.config.ts` 显式读取这些环境变量时，它们才会生效。

## 1) 准备统一配置文件

在仓库根目录执行：

```bash
cp yuiju.config.ts.example yuiju.config.ts
```

然后编辑 `yuiju.config.ts`，至少确认：

- `database.mongoUri`：容器内推荐使用 `mongodb://mongodb:27017/yuiju?authSource=admin`
- `database.redisUrl`：容器内推荐使用 `redis://redis:6379`
- `llm.models`：至少补齐实际会调用的模型来源
- `message.onebot.endpoint` / `message.onebot.token`：需要 OneBot 时补齐
- `message.lark.appId` / `message.lark.appSecret`：需要飞书时补齐

## 2) 一键启动

```bash
pnpm run docker:up
```

如果你在国内网络环境下遇到 Docker Hub 拉取超时（例如 `TLS handshake timeout`），可直接使用镜像源版本：

```bash
pnpm run docker:up:mirror
```

等价（手动指定镜像）：

```bash
NODE_BASE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim docker compose up -d --build
```

等价：

```bash
docker compose up -d --build
```

## 3) 查看日志

```bash
pnpm run docker:logs
```

## 4) 停止服务

```bash
pnpm run docker:down
```

## 常见问题

- `world` 报数据库连接失败：
  - 检查挂载进容器的 `yuiju.config.ts` 是否使用了容器网络地址：
    - `mongodb://mongodb:27017/yuiju?authSource=admin`
    - `redis://redis:6379`
- `message` 连不上 OneBot：
  - 若 OneBot 服务在宿主机，确保 `message.onebot.endpoint` 可从容器访问。
  - Linux 下通常不能直接用 `host.docker.internal`，可改成宿主机网关 IP。
- 想只重启应用容器：
  - `docker compose restart app`
- 构建阶段报错 `failed to fetch oauth token` 或 `TLS handshake timeout`：
  - 这通常是 Docker Hub 网络链路问题，不是项目代码问题。
  - 先尝试：`pnpm run docker:up:mirror`，从镜像站来拉取node内容。
  - 如果仍失败，再考虑配置 Docker Daemon 镜像加速或挂tun代理。

## 补充

- `Dockerfile` 提供 `NODE_BASE_IMAGE` 构建参数，默认仍然是官方 `node:22-bookworm-slim`。
- 在 `docker-compose.yml` 透传该参数，确保 CI、本地、不同地区网络都能复用同一份编排文件。
- 这是一种常见的“可移植容灾”手法：业务逻辑不变，只替换拉取源，降低环境耦合。
- 构建阶段和运行阶段都会传入若干 `YUIJU_*` 变量，但当前 TS 配置读取器不会自动使用它们。
- 运行阶段会挂载仓库根目录的 `yuiju.config.ts`。容器连接 MongoDB / Redis 时，必须确保该文件中的地址适合容器网络。
