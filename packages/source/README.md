# 资源包 (@yuiju/source)

`@yuiju/source` 目前只保留图片、音频、数据集、技能和辅助脚本资源。

## 当前职责

- 保存角色头像、表情包等图片资源。
- 保存参考音频等素材。
- 保存数据集和数据转换脚本。
- 保存外部工具 skill 资源。

Prompt 文案不在本包维护。当前 Prompt 真相源是 `@yuiju/utils/src/prompt/`。

## 主要目录

```text
audio/      # 音频素材
dataset/    # 数据集和数据构造说明
picture/    # 图片与表情包资源
scripts/    # 数据转换脚本
skills/     # 外部工具 skill 资源
index.ts    # 空导出，仅保留 workspace 包入口
```

## 使用方式

业务包通常通过配置中的资源路径引用本包文件，例如 `message.stickers.*.uri`。

如需运行数据脚本，可在根目录执行：

```bash
pnpm tsx packages/source/scripts/jsonl-transfer.ts
```

## 修改注意事项

- 不要把新的 Prompt 文案放回 `@yuiju/source`。
- 新增素材时，优先通过 `yuiju.config.ts` 或明确代码路径引用。
- 数据集字段结构变化需要确认下游脚本是否依赖。
