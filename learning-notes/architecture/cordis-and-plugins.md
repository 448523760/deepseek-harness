# Cordis 与插件模型

源码：[`vendor/cordis/`](../../vendor/cordis/)，入口是 [`src/index.ts`](../../vendor/cordis/src/index.ts)。本页是源码阅读笔记；正式的使用约定以 [`docs/cordis-primer.md`](../../docs/cordis-primer.md) 为准。

## 一句话职责

Cordis 是 DeepSeek Harness 使用的 TypeScript 插件运行时：它把依赖注入、作用域服务、类型化事件、可撤销 effect 和插件生命周期统一到一个 `Context` 中，使能力可以组合、替换、重新加载和卸载。

## 1. package 的目的

`cordis` 的核心目标不是实现某个业务能力，而是在同一进程内提供一个可组合的运行时容器。插件通过服务名声明依赖，通过事件暴露扩展点，通过 effect 注册资源及其清理函数；插件之间不需要直接导入具体实现。

在本仓库中，`vendor/cordis` 是被重新命名为 `@deepseek-ai/cordis` 的 vendored 核心包。`vendor/README.md` 记录了固定源码版本和本地修改；YAML 配置、插件树加载、include 和 HMR 属于其他 Cordis 插件，不属于这里的核心实现。

它主要解决四个问题：

- **依赖顺序**：插件声明 `inject`，只有依赖服务在同一作用域可用时才激活，不靠手写启动顺序。
- **资源所有权**：监听器、服务注册、定时任务或自定义资源都挂在当前插件 fiber 上，fiber 卸载时统一清理。
- **可插拔通信**：服务适合直接调用，事件适合观察、策略拦截和 waterfall 组合；消费者不需要知道提供者的具体类。
- **作用域隔离**：子 context 可以继承父 context，也可以为某个服务建立独立隔离域或注入配置，而不修改父 context。

## 2. 核心实现模型

| 模块 | 主要职责 | 关键接口 |
|---|---|---|
| [`context.ts`](../../vendor/cordis/src/context.ts) | 创建根/子 context；保存隔离映射和 intercept 配置；持有内置服务 | `Context`、`extend()`、`isolate()`、`intercept()` |
| [`reflect.ts`](../../vendor/cordis/src/reflect.ts) | 实现 Context Proxy 的属性读写、服务表、accessor 和 mixin | `ReflectService`、`get()`、`set()`、`provide()`、`notify()` |
| [`registry.ts`](../../vendor/cordis/src/registry.ts) | 识别插件入口、保存共享 runtime、创建 fiber、规范化依赖 | `Plugin`、`Inject`、`RegistryService`、`ctx.plugin()`、`ctx.inject()` |
| [`fiber.ts`](../../vendor/cordis/src/fiber.ts) | 表示一次插件挂载；跟踪依赖、配置、effect、加载/卸载和错误 | `Fiber`、`FiberState`、`effect()`、`await()`、`update()`、`restart()` |
| [`events.ts`](../../vendor/cordis/src/events.ts) | 保存监听器并按不同 dispatch mode 调用；监听器自动绑定当前 fiber | `Events`、`EventsService`、`on()`、`once()`、`emit()`、`waterfall()` |
| [`service.ts`](../../vendor/cordis/src/service.ts) | 提供服务基类；构造时注册 `ctx.<name>`，支持 callable service 和配置合并 | `Service<T>`、`Service[resolveConfig]` |
| [`logger.ts`](../../vendor/cordis/src/logger.ts) | 提供 callable logger、结构化消息和 exporter | `LoggerService`、`Logger`、`Message`、`Exporter` |
| [`utils.ts`](../../vendor/cordis/src/utils.ts) | 提供 disposer 集合、共享 symbol、traceable proxy、错误栈拼接 | `DisposableList`、`symbols`、`getTraceable()`、`composeError()` |

### 2.1 Context 是依赖容器和 Proxy

`new Context()` 先创建隔离表和 intercept 表，再为根 context 创建 root fiber，并安装 `ReflectService`、`RegistryService`、`EventsService` 和 `LoggerService`。`ReflectService` 把这些服务的方法 mixin 到 context，因此常用接口可以直接写成 `ctx.plugin()`、`ctx.provide()`、`ctx.on()`、`ctx.effect()` 和 `ctx.logger()`。

Context 的普通属性读取经过 `ReflectService.handler`：已有属性直接读取，声明为 accessor 的属性调用 accessor，其他属性则按当前 fiber 的服务表、父 fiber 和隔离域逐层查找。所需服务尚未激活时会抛出带有调用栈的错误；不需要声明依赖的代码可以使用 `ctx.get(name, strict)` 查询服务。

`extend(meta)` 使用原型继承创建子 context，父 context 不被修改。`isolate(name, label)` 为服务名建立新的隔离标签；共享同一个标签的 context 使用同一个服务实现槽位。`intercept(name, config)` 使用原型链保存配置，后代插件解析该服务配置时按祖先到后代合并。

### 2.2 Registry、Runtime 和 Fiber

插件入口支持函数、类和带 `apply(ctx, config)` 的对象。插件还可以声明 `name`、`Config`、`inject`、`provide` 和 `intercept` 元数据。`RegistryService` 按可执行 callback 建立一个共享的 `Plugin.Runtime`；同一个 callback 在不同 context 中被挂载多次时，共享 runtime，但每次 `ctx.plugin()` 都创建独立的 `Fiber`。

`Inject.resolve()` 把数组形式的依赖和名称到 intercept 配置的对象形式统一成映射。`Fiber` 为插件创建继承父 context 的子 context，并把自身挂到 `ctx.fiber`；插件代码在这个子 context 上注册的所有 effect、服务和监听器都由该 fiber 拥有。

fiber 用依赖提供者 uid 组成的 epoch 表示当前依赖组合。缺少依赖时状态是 `PENDING`；所有依赖可用时进入 `LOADING`，执行配置解析和插件入口后进入 `ACTIVE`；配置或入口失败进入 `FAILED`；依赖消失或主动重载时进入 `UNLOADING`，资源清理完成后重新等待或加载；公开 disposer 完成后进入 `DISPOSED`。

### 2.3 服务注册和依赖唤醒

服务通过 `ctx.provide(name, value, check?)` 注册。实现记录包含服务名、提供者 fiber、当前值和可选的 availability check，并按当前隔离标签存储；同一隔离域不能重复提供同名服务。服务注册本身是 effect，因此 disposer 或 fiber 卸载会删除它。

服务变化后，`ReflectService.notify()` 遍历已注册 runtime 的 fibers，只刷新声明了相关服务且处于同一隔离范围的 fiber。fiber 重新检查每个依赖的实现和 `check` 结果，再根据 epoch 变化触发加载或卸载。这样，提供者先卸载时，消费者会自动退出；提供者重新出现时，消费者可以用新的实现重新激活。

`Service` 是服务实现的基类。子类在构造函数中调用 `super(ctx, name)`，基类立即通过 `ctx.reflect.provide()` 注册实例；如果服务定义了 `[Service.invoke]`，Cordis 会把实例包装成可调用对象。服务配置通过 context 的 intercept 链合并，服务的 `Config.merge()` 存在时使用它，否则使用浅合并。

### 2.4 Effect 是统一的资源所有权机制

`ctx.effect(execute, label)` 立即执行 effect 主体，并收集它返回的 disposer。返回值可以是单个 disposer、Promise、同步 iterable 或异步 iterable；异步 effect 和异步清理都会被生命周期等待。effect disposer 只执行一次，内部 effect 仍会记录嵌套的 `EffectMeta` 以支持诊断。

fiber 用 `DisposableList` 保存当前拥有的 disposer，并在卸载时清空集合、按注册逆序调用清理函数，再等待异步清理完成。清理失败会记录到 logger，但不会让其他 disposer 失去执行机会；effect 不能在已 disposed 或正在 unloading 的 fiber 上创建。

`ctx.on()`、`ctx.once()`、`ctx.provide()`、`ctx.accessor()`、`ctx.mixin()` 和 `ctx.logger.exporter()` 都通过 effect 获得相同的所有权语义。因此插件只要把注册动作放在当前 fiber 的 API 中，就不必单独维护卸载列表。

### 2.5 EventsService 是类型化事件总线

事件类型通过 `declare module` 扩展 `Events` 接口，事件名和参数因此可以在 TypeScript 中检查。`ctx.on()` 把监听器存入事件列表并绑定当前 context；监听器会随拥有它的 fiber 自动移除，`once()` 则在第一次调用前先注销自己。

| dispatch mode | 执行方式 | 返回/停止规则 |
|---|---|---|
| `emit` | 同步调用全部监听器，不等待返回的 Promise | 忽略返回值 |
| `parallel` | 并发调用并等待全部监听器 | 失败聚合为 `AggregateError` |
| `serial` | 按注册顺序逐个等待 | 第一个非 `null`、非 `false`、非 `undefined` 的结果停止后续调用 |
| `bail` | 按注册顺序同步调用 | 第一个 bail 值停止后续调用 |
| `waterfall` | 监听器包裹最后一个 `next()`，由外向内执行 | 不调用 `next()` 就 veto 后续链；调用后可返回内层结果 |

`waterfall` 的源码调用链和 `system-prompt/assemble` 业务用法见[`waterfall 源码笔记`](waterfall.md)。

`internal/*` 事件是 Cordis 自己的扩展点，包括插件创建/销毁、fiber 状态变化、配置解析、服务变化、配置更新、context 读写、监听器注册和 dispatch 诊断。普通事件 dispatch 前会发出 `internal/dispatch`，而内部事件不会再次触发这个诊断事件。

## 3. 一个插件的主要执行流程

```text
new Context()
  -> 创建 root Fiber 和内置服务，并把核心方法 mixin 到 ctx
ctx.plugin(plugin, rawConfig)
  -> RegistryService 解析入口并取得/创建 Plugin.Runtime
  -> Inject.resolve() 规范化依赖
  -> Fiber 创建子 Context，注册到父 fiber 的 disposer，并发出 internal/plugin
  -> Fiber 检查依赖：缺失则 PENDING；齐全则进入 LOADING
  -> internal/config waterfall 解析 rawConfig，再执行 Standard Schema 校验
  -> 执行函数、new 类或 object.apply()
  -> 插件通过 ctx.provide()/ctx.on()/ctx.effect() 注册资源
  -> Fiber 进入 ACTIVE，await(fiber) 完成
服务变化或 fiber.update(config)
  -> notify/_refresh 改变依赖 epoch
  -> UNLOADING：按 effect 所有权清理
  -> 依赖恢复或更新获准后重新解析配置并执行插件
fiber.dispose()
  -> 标记 uid 无效，停止新的 effect
  -> 发出插件销毁通知，清理全部 disposer
  -> 进入 DISPOSED
```

其中 `ctx.plugin()` 返回一个同时具有 fiber 属性和 `PromiseLike<Fiber>` 行为的对象，因此可以立即检查生命周期，也可以 `await ctx.plugin(...)` 等待配置校验和插件启动结束。启动错误会记录到 fiber 并由 `await()` 重新抛出；卸载错误则由 logger 记录并继续清理其他资源。

`Fiber.update(config, noSave)` 先保存 raw config；激活中的 fiber 先经过 `internal/update` waterfall，监听器可以修改更新流程或不调用 `next()` 直接 veto，默认行为是应用解析后的配置并 restart。尚未激活的 fiber 延迟配置解析，直到其依赖满足。

## 4. 主要接口清单

### Context 和直接使用的 `ctx` 方法

- `Context`：根/子依赖容器；`root` 指向根 context，`fiber` 指向当前插件运行实例。
- `ctx.plugin(plugin, config?)`：挂载函数、类或 object plugin，返回 `Fiber & PromiseLike<Fiber>`。
- `ctx.inject(deps, callback)`：`ctx.plugin()` 的依赖注入简写，依赖变动时自动卸载并重新执行 callback。
- `ctx.provide(name, value, check?)`、`ctx.get(name, strict?)`、`ctx.set(name, value)`：注册、读取和更新服务；只有服务的提供者 fiber 可以 `set()` 该服务。
- `ctx.on()`、`ctx.once()`、`ctx.emit()`、`ctx.parallel()`、`ctx.serial()`、`ctx.bail()`、`ctx.waterfall()`：监听和五种事件分发方式。
- `ctx.effect(execute, label?)`：注册带 disposer 的资源 effect。
- `ctx.extend(meta)`、`ctx.isolate(name, label?)`、`ctx.intercept(name, config)`：创建继承、隔离或配置拦截作用域。
- `ctx.accessor()`、`ctx.mixin()`：向 Proxy context 声明计算属性或转发服务方法。
- `ctx.logger(name?)`：创建带名称和 fiber 元数据的 logger；也可以直接调用 `ctx.logger.info()` 等严重级别方法。

### Plugin、Fiber 和服务接口

- `Plugin.Function`、`Plugin.Constructor`、`Plugin.Object`：三种插件入口；`Plugin.Base` 的 `Config`、`inject`、`provide`、`intercept` 和 `name` 定义运行时元数据。
- `Fiber`：主要属性是 `ctx`、`config`、`state`、`uid`、`store` 和 `inertia`；主要方法是 `effect()`、`getEffects()`、`await()`、`restart()`、`update()`、`dispose()`。
- `FiberState`：`PENDING`、`LOADING`、`ACTIVE`、`FAILED`、`UNLOADING`、`DISPOSED`。
- `Service<T>`：服务实现基类；构造函数注册服务，`Service[config]` 表示 intercept 配置类型，`Service[resolveConfig]` 负责合并配置。
- `ValidationError`、`resolveConfig()`、`CordisError`：配置校验错误、Standard Schema 配置解析和稳定错误码。

### 事件、反射和日志接口

- `Events`、`EventOptions`、`DispatchMode`：声明事件参数、监听器选项和 dispatch mode；业务代码通常通过 declaration merging 增加事件。
- `ReflectService`：`ctx.reflect` 的实现，提供 `get()`、`set()`、`provide()`、`notify()`、`accessor()`、`mixin()`、`trace()` 和 `bind()`；它是核心实现服务，不在 `src/index.ts` 中单独 re-export。
- `LoggerService`、`Logger`、`Message`、`Exporter`：结构化日志 facade、日志记录和导出器接口；默认 exporter 保留最近一段内存消息。
- `DisposableList`、`symbols`、`getTraceable()`、`createCallable()`、`composeError()`：支持生命周期所有权、跨 context 调用绑定和异步错误栈处理的底层工具。

## 5. 阅读结论和边界

Cordis 的最小闭环是：`Context` 提供查找入口，`RegistryService` 把插件变成 `Fiber`，`ReflectService` 管理服务可见性，`EventsService` 提供扩展调用链，`Fiber.effect()` 负责资源所有权，`Service` 和 `LoggerService` 提供可复用的内置实现。

对 DeepSeek Harness 来说，“所有部分都是插件”意味着模型适配器、工具注册、session、agent loop 等都使用同一个生命周期和依赖机制；Cordis 只负责运行时组合，不负责定义这些业务服务的语义，也不负责把 YAML 配置文件解析成插件树。

继续阅读 Harness 时，先看每个 package 的 Service Definition、Provider 和 Consumer，再回到本页的 `inject`、`provide`、事件 mode 和 effect 所有权；这样可以区分“服务如何被发现”和“业务服务具体做什么”。

## 相关源码和文档

- [`vendor/cordis/README.md`](../../vendor/cordis/README.md)：核心包 README 和快速示例。
- [`docs/cordis-primer.md`](../../docs/cordis-primer.md)：面向插件作者的使用原则。
- [`docs/architecture.md`](../../docs/architecture.md)：Cordis 在 Harness 中的插件树、事件和 turn 流程。
- [`vendor/cordis/src/index.ts`](../../vendor/cordis/src/index.ts)：核心公开导出。
- [`vendor/cordis/src/context.ts`](../../vendor/cordis/src/context.ts)、[`fiber.ts`](../../vendor/cordis/src/fiber.ts)、[`registry.ts`](../../vendor/cordis/src/registry.ts)、[`reflect.ts`](../../vendor/cordis/src/reflect.ts)：Context、生命周期、插件注册和服务解析。
- [`vendor/cordis/src/events.ts`](../../vendor/cordis/src/events.ts)、[`service.ts`](../../vendor/cordis/src/service.ts)、[`logger.ts`](../../vendor/cordis/src/logger.ts)、[`utils.ts`](../../vendor/cordis/src/utils.ts)：事件、服务、日志和底层工具。
