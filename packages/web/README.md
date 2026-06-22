# Web 应用 (@yuiju/web)

`@yuiju/web` 是可视化和状态查询入口，负责展示角色状态、世界状态、行为历史、日记、记忆和日志。

## 当前职责

- 首页展示角色实时状态、世界信息和地图概览。
- Activity 页面展示行为轨迹和事件时间线。
- Diary 页面展示日记列表和筛选。
- Memory / File Browser 页面辅助查看记忆相关文件。
- Node API 读取 Redis / MongoDB，并按公开部署配置选择主库或同步库。

## 主要目录

```text
app/
├── home/          # 首页模块
├── activity/      # 行为历史
├── diary/         # 日记
├── memory/        # 记忆查看
├── file-browser/  # 文件浏览
└── api/           # Next Route / Hono API

components/ui/     # 通用 UI 组件
lib/               # Web 侧查询与展示转换
```

## 配置与依赖

- 配置来自根目录 `yuiju.config.ts`。
- Redis 用于读取实时状态。
- MongoDB 用于读取行为历史、日记和记忆记录。
- `app.publicDeployment` 为 true 时，部分接口读取 `syncMongoUri` / `syncRedisUrl`。
- `@yuiju/source` 只作为图片等静态资源来源，不提供 Prompt。

## 运行命令

```bash
pnpm run dev:web
pnpm run build:web
pnpm run start:web
```

## 修改注意事项

- Web/API 不应成为新的领域真相源。
- 命令型 API 需要明确权限、入参、状态写入和是否写入 Episode。
- 只读接口应清楚区分实时状态和历史记录来源。
