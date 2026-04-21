```
# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.
```

## 项目概述

**ゆいじゅ（悠酱）** 是一个 LLM 驱动的「角色自主生活模拟」项目，可理解为 AI 驱动的模拟经营游戏。项目让一个角色在持续推进的世界里，基于自身状态与环境信息进行决策、执行行为，并留下可追溯的生活轨迹。

## 项目架构

项目采用 Monorepo 架构，使用 pnpm 作为包管理器，包含以下核心子包：

### 1. @yuiju/world (packages/world) - 世界模拟引擎

- **核心功能**：负责角色决策、行为执行、状态管理的主引擎
- **关键特性**：LLM 驱动决策、状态持久化（Redis + MongoDB）、参数化行为、动态时间系统
- **主要目录**：
  - `src/engine/`：引擎循环和决策流程
  - `src/action/`：行为系统（按场景划分：家中/学校/通用/商店/咖啡馆）
  - `src/state/`：角色和世界状态管理
  - `src/llm/`：LLM 决策和工具调用
- **开发命令**：`pnpm run dev:world`、`pnpm run start:world`、`pnpm run test:world`

### 2. @yuiju/message (packages/message) - 消息服务

- **核心功能**：提供与外部系统的消息通信功能
- **技术栈**：使用 node-napcat-ts 进行消息处理
- **开发命令**：`pnpm run dev:message`、`pnpm run start:message`

### 3. @yuiju/web (packages/web) - Web 界面

- **核心功能**：提供可视化界面，用于观察角色状态和世界运行
- **技术栈**：Next.js 15 + React 19 + Tailwind CSS 4
- **开发命令**：`pnpm run dev:web`、`pnpm run start:web`、`pnpm run build:web`

### 4. @yuiju/utils (packages/utils) - 工具库

- **核心功能**：通用工具函数、数据库 Schema、长期记忆系统 (Person Memory)
- **开发命令**：`pnpm run type-check:utils`

### 5. @yuiju/source (packages/source) - 数据源

- **核心功能**：提供项目的静态资源、Prompt 模板、微调数据集

### 6. packages/python [DEPRECATED] - Python 服务

- **核心功能**：提供 Graphiti 长期记忆服务，已废弃，由 `@yuiju/utils` 中的 Person Memory 系统取代
- **开发命令**：`pnpm run start:python`

## 常用开发命令

### 安装依赖

```bash
pnpm install
```

### 代码格式化与检查

```bash
pnpm run format:write     # 自动格式化所有代码
pnpm run lint             # 运行代码检查

# 使用 Biome 手动检查
pnpm dlx @biomejs/biome check .
pnpm dlx @biomejs/biome check --write .
```

### 类型检查

```bash
pnpm run type-check       # 检查所有包类型
pnpm run type-check:world # 只检查 world 包
```

### 运行开发服务器

```bash
# 推荐本地联调组合
pnpm run dev:world       # 启动世界模拟引擎
pnpm run dev:web         # 启动 Web 界面（端口 3010）
pnpm run dev:message     # 按需启动消息服务
# pnpm run start:python  # [DEPRECATED] 仅在需要旧版 Python 能力时启动
```

### 运行测试

```bash
pnpm run test:world      # 运行世界模拟引擎的所有测试
```

### 生产环境启动

```bash
pnpm run start           # 使用 PM2 启动 ecosystem.config.js 中的全部服务
pnpm run restart        # 使用 PM2 重启全部服务
pnpm run stop           # 使用 PM2 停止全部服务
```

## 代码规范

### 补充规则

- 涉及代码重构、抽象取舍、函数拆分、删除中间层、判断是否过度设计时，请同时参考 `docs/rules/refactor-style.md`
- 涉及日常实现风格、字段设计、配置显式性、单一真相源、注释取舍等问题时，请同时参考 `docs/rules/implementation-style.md`

### 格式化工具

使用 **Biome** 进行代码格式化和检查。配置文件：`biome.json`

- 缩进：2 个空格
- 行宽：100 字符
- 忽略目录：`**/dist`、`**/node_modules`、`**/.venv`、`**/logs`、`**/.next`、`packages/source/dataset/opensource`

### TypeScript 配置

- 路径别名：`@/` 指向 `src/` 目录
- 严格模式：开启
- 编译目标：ESNext

### 项目配置

当前项目的业务配置统一来自根目录 `yuiju.config.ts`，可基于 `yuiju.config.ts.example` 创建本地配置：

```bash
cp yuiju.config.ts.example yuiju.config.ts
```

关键配置项：

- `database.mongoUri`
- `database.redisUrl`
- `llm.deepseekApiKey`
- `message.napcat`
- `app.publicDeployment`

额外说明：

- `NODE_ENV` 仍然是运行时环境变量，不放在 `yuiju.config.ts` 中
- 根目录 `package.json` 未声明 `pm2` 依赖，执行 `pnpm run start` 前需要系统中已有可用 `pm2` 命令

## 关键架构概念

### 引擎循环（Engine Loop）

1. 获取当前状态（Redis）
2. 计算可用行为（基于角色状态和场景）
3. LLM 决策（选择行为）
4. 执行行为（修改状态）
5. 保存历史记录（MongoDB）
6. 推进时间
7. 等待下一个 tick

### 行为系统

- 行为按场景划分（Home/School/Anywhere/Shop/Cafe）
- 每个行为必须定义 `precondition`（前置条件）
- 支持参数化行为（如"吃"行为需要选择具体食物）
- 行为执行器通过 `actionExecutor` 定义

### 状态管理

- **Redis**：角色状态的实时缓存（唯一真相源）
- **MongoDB**：行为历史记录存储
- **内存状态**：Redis 数据的缓存，定期同步

## 开发工作流程

1. 确定要修改的子包
2. 在对应子包目录开发
3. 使用 `pnpm run type-check` 验证类型
4. 使用 `pnpm run format:write` 格式化代码
5. 运行相关测试
6. 提交代码

## 注意事项

1. **Redis 依赖**：开发过程中需要运行 Redis 服务器
2. **MongoDB 依赖**：需要运行 MongoDB 服务器
3. **LLM API 依赖**：需要配置有效的 DeepSeek API 密钥
4. 当前项目处于早期开发阶段，在进行技术方案设计时，请不用考虑历史逻辑的兼容性，按照最佳方案设计。
