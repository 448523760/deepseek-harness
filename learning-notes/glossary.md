# 术语表

| 术语 | 我的理解 | 权威链接 |
|---|---|---|
| Cordis | TypeScript 插件运行时；以 Context 作为依赖容器，用 Registry/Fiber 管理插件实例，用服务、事件和 effect 组合可撤销能力。核心包不负责 YAML 配置加载。 | [`architecture/cordis-and-plugins.md`](architecture/cordis-and-plugins.md) |
| Service Definition / Provider / Consumer | 分别声明能力接口、提供实现和使用能力；Cordis 通过 `ctx.<service>` 和 `inject` 把三者连接起来。 | [`docs/capability-seams.md`](../docs/capability-seams.md) |
| Session Event | 需要进入持久化 Session Log 的事实事件；与只用于运行时扩展的 Cordis 事件不同。 | [`docs/architecture.md`](../docs/architecture.md) |
| Waterfall | 由监听器包裹 `next()` 的事件调用链；监听器调用 `next()` 才会继续，否则会 veto 后续处理。 | [`architecture/cordis-and-plugins.md`](architecture/cordis-and-plugins.md) |
