# 阅读路线

目标是先建立运行模型，再沿依赖和实际请求路径深入 package。每个阶段完成后，写一段总结和 3 到 5 个仍未解决的问题。

## 阶段 0：建立地图

阅读根 [`README.md`](../README.md)、[`docs/architecture.md`](../docs/architecture.md)、[`packages/README.md`](../packages/README.md)，再查看 [`packages/examples/agent-spine-demo/README.md`](../packages/examples/agent-spine-demo/README.md)。

重点回答：插件如何被组合、`ctx` 服务如何注册、一个 turn/step 如何流动、Session Log 为什么是模型上下文的来源。

## 阶段 1：基础设施

建议顺序：`util` → `typert` → `context` → `boot`。

重点回答：类型和运行时注册如何生成，配置如何加载，插件如何启动和卸载。

## 阶段 2：核心脊柱

建议顺序：`core/scope` → `core/session` → `core/system-prompt` → `core/tools` → `core/agent` → `core/agent-loop`。

重点回答：Agent 接口和具体 Loop 的边界、工具执行流水线、事件与持久化事实的区别。

## 阶段 3：模型与持久化

先读 `llm`，再读 `session` 和 `session-query`。

重点回答：模型 adapter 如何接入、消息如何从日志投影、JSONL/SQLite 持久化和查询如何分工。

## 阶段 4：执行能力

建议顺序：`subprocess` → `shell` → `terminal` → `fs` → `lsp` → `web` → `sandbox`。

每个能力都按 Service Definition → Provider → Consumer 三个角色记录，特别标出安全策略和跨进程边界。

## 阶段 5：协作与扩展

阅读 `interaction`、`skill`、`subagent`、`workflow`、`jobs`、`goal`、`plan`。

重点回答：人类输入、后台任务、子代理和同一 session 的目标如何进入 Agent 生命周期。

## 阶段 6：应用组合

最后阅读 `bundle`、`host`、`client`、`sdk`、`acp`、`examples`，再回看 `docs/architecture.md`。

重点回答：同一套核心能力如何组成 Web、Headless、ACP 和 JSON-RPC 应用。

## 每个阶段的固定动作

1. 阅读分组 README 和对应 `docs/subsystems/` 页面。
2. 只跟一条真实路径进入 `src/`，从入口追到事件或服务边界。
3. 记录依赖、消费者、关键类型和一个失败/取消路径。
4. 用测试或 runnable example 验证理解，不把源码摘录当成总结。
