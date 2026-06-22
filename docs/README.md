# 开发文档索引

本目录只维护当前仍可作为开发依据的文档。历史方案、调研笔记和未落地设计需要放到 `docs/archive/`，不能直接作为当前实现事实引用。

## 开始开发

- [新人上手指南](./onboarding.md)：本地开发、配置和启动流程。
- [本地基础依赖 Docker](./local-infra-docker.md)：只启动 MongoDB / Redis。
- [Docker 一键部署](./docker-one-click.md)：用单镜像运行 `world + web + message`。

## 架构与边界

- [技术实现介绍](./introduction/tech-introduction/index.md)：项目整体结构和核心流程。
- [LLM 协定](./llm-contract.md)：LLM 决策、Prompt、schema 和消息生成边界。
- [第三方依赖](./third-party-dependencies.md)：外部服务、运行时依赖和配置来源。

## 代码规则

- [代码规范](./rules/implementation-style.md)
- [重构风格规则](./rules/refactor-style.md)
- [领域设计规范](./rules/domain-design-style.md)
- [Prompt 规范](./rules/prompt-style.md)

## 历史资料

`docs/archive/` 中的内容只代表当时的草稿、调研或阶段性设计。引用这些内容前，必须先对照当前代码和活跃文档确认是否仍然成立。
