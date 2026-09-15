# DeepSeek Harness 学习笔记

这里记录个人对 DeepSeek Harness 源码的阅读结果。内容服务于学习和复习，不是项目正式文档；正式架构、API 和设计决策仍以 [`docs/`](../docs/)、各 package 的 README 和 [`.agents/notes/`](../.agents/notes/) 为准。

## 如何使用

- 先阅读[阅读路线](reading-route.md)，按阶段推进，不按文件数量推进。
- 每个分组先写一页地图，再为真正读过的 package 建立笔记。
- 使用 [`package-template.md`](package-template.md) 保持每篇笔记结构一致。
- 在 [`glossary.md`](glossary.md) 记录跨 package 反复出现的术语。
- 在 [`questions.md`](questions.md) 保留未解决的问题，并在找到答案后补上源码或文档链接。

## 阅读状态

状态建议使用：`未开始`、`粗读`、`已梳理`、`待复习`。

| 范围 | 入口 | 状态 | 笔记 |
|---|---|---|---|
| 总体架构 | [`docs/architecture.md`](../docs/architecture.md) | 未开始 | [`architecture/overview.md`](architecture/overview.md) |
| Cordis 基础 | [`docs/cordis-primer.md`](../docs/cordis-primer.md) | 未开始 | [`architecture/cordis-and-plugins.md`](architecture/cordis-and-plugins.md) |
| `core` | [`packages/core/README.md`](../packages/core/README.md) | 未开始 | [`groups/core.md`](groups/core.md) |
| `llm` | [`packages/llm/README.md`](../packages/llm/README.md) | 未开始 | [`groups/llm.md`](groups/llm.md) |
| `session` | [`packages/session/README.md`](../packages/session/README.md) | 未开始 | [`groups/session.md`](groups/session.md) |

## 目录

- [`architecture/`](architecture/)：跨 package 的整体模型和关键运行流程。
- [`groups/`](groups/)：package 分组地图和依赖关系。
- [`packages/`](packages/)：单个 package 的阅读记录，路径尽量镜像源码。
