# ゆいじゅ（悠酱）

<p align="center">
  <img src="packages/source/picture/repo_avatar.webp" alt="ゆいじゅ（悠酱）" width="150" />
</p>

幻想打造一个 ゆいじゅ 生活的世界。

# 项目介绍

这是一个 LLM 驱动的「角色自主生活模拟」项目，可以理解为 AI 驱动的模拟经营游戏，让一个角色在持续推进的世界里，基于自身状态与环境信息进行决策、执行行为，并留下可追溯的生活轨迹。目标是把“悠酱的一天”从脚本驱动变成“自己行动”的模拟系统。

> philosophy: 不做 AI 智能助手，做有自己生活的“人”

## 特性

- **LLM 驱动决策**：每个 tick 从可用行为中做选择，并可细化到参数选择（比如吃什么、行动多久）。
- **状态驱动循环**：角色状态既是输入也是结果，让世界随着行动持续演进。
- **可观测/可复盘**：行为、参数与持续时间等信息可被记录，便于分析与回放。
- **行为易扩展**：通过行为定义与前置条件机制，能逐步丰富“能做什么”。
- **多入口交互**：可通过消息服务与 Web 界面观察世界运行并进行互动。

# Get Started


- [部署文档](./docs/get-started.md)
- [新同学上手](./docs/onboarding.md)
- [本地基础设施（Docker）](./docs/local-infra-docker.md)

# Architecture

> 项目还处于早期开发阶段，部分功能尚未完全按架构图实现。

![](./docs/architecture.png)

# 相关文档

项目目前处于早期开发阶段，文档在持续补充中。下面是当前可用文档入口：

## 项目文档（`docs/`）

- [需求草案](./docs/spec/requirement.md)
- [规划草案](./docs/spec/plan.md)
- [开发笔记](./docs/note.md)
- [想法记录](./docs/idea.md)
- [待办事项](./docs/todo.md)
- [问题记录：Graphiti](./docs/problem/graphiti.md)

## 开发规范

- [实现风格](./docs/rules/implementation-style.md)
- [重构风格](./docs/rules/refactor-style.md)

## 子包文档

- [world](./packages/world/README.md)
- [web](./packages/web/README.md)
- [message](./packages/message/README.md)
- [utils](./packages/utils/README.md)
- [python](./packages/python/README.md)
- [source](./packages/source/README.md)
