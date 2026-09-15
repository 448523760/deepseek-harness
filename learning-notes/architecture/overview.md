# 整体架构速记

待补充。先以 [`docs/architecture.md`](../../docs/architecture.md) 为权威入口，记录自己的分层理解、核心事件流和 package 关系，不复制正式文档全文。

## 当前模型

- Cordis 提供插件、服务、事件和可撤销 effect。
- `core` 提供 Agent、Loop、工具、提示词和 Session Log 的控制脊柱。
- 能力 package 通过 Service Definition / Provider / Consumer 形成可替换的能力 seam。
- 模型可见输入必须能够从 Session Log 重建。

## 待验证

- [ ] 从 demo 配置追到 Agent Loop 的实际装配。
- [ ] 画出一条完整 turn/step 与 tool call 的事件流。
- [ ] 对照 module graph 确认分组依赖方向。
