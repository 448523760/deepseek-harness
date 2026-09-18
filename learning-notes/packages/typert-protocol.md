# `dsh-typert-protocol`

源码：[`packages/typert/protocol/`](../../packages/typert/protocol/)

## 一句话职责

为 Typert Remote RPC 的业务包、生成产物、Host Gateway 和 Client API 提供共享的类型、元数据和运行时约定。

## 它不是什么

它不是执行远程 TypeScript 脚本的协议。这里的 Remote 表示“可通过 RPC 远程调用的已加载业务方法”，不是把 TypeScript 源码发送到另一端编译、解释或执行。该包不执行 TypeScript 分析，也不注册具体 Cordis Service（见 [`protocol README`](../../packages/typert/protocol/README.md)）。

## 主要内容

- `@Remote` 和 `@RemoteScope()` 在 Service 方法上记录可调用标记。
- `TypertRemoteService` 和 `bindTypertRemote()` 将 Service key 与 RPC namespace 绑定。
- `InvocationDescriptor` 描述 Service、endpoint、参数、lookup/Context receiver、codec、结果和取消信号。
- `TypertLookupMap`、`TypertContextMap`、`TypertRemoteMap` 等声明合并类型连接 Host 与 Client 的静态契约。
- lookup、Context、事件转发和 Client Remote 的 provider/registry 接口定义跨包约定。

装饰器只把方法名和调用模式保存在模块私有状态中；参数、结果和 schema 的完整反射由 `typert/generator` 在构建阶段生成。

## 真实执行路径

`typert/generator` 分析源代码并生成 descriptor/schema，`typert/loader` 与 `typert/registry` 发现并保存运行时产物，`api/gateway` 接收 RPC 后解析 descriptor、校验参数、解析 lookup/Context，最后调用 Host 上已经存在的 Cordis Service 方法。传输、请求关联和响应封装由 Connection 负责。

## 典型调用链

一次生成的 Remote 方法调用通常经过以下步骤：

1. 业务包在 Host Service 上使用 `@Remote` 或 `@RemoteScope()`，并通过声明合并提供 lookup、Context 和 Client 类型信息。
2. `typert/generator` 在构建阶段分析方法签名，生成 Host/Client contribution、`InvocationDescriptor` 和严格 codec/schema。
3. Host 侧由 `typert/loader` 发现生成产物，并交给 `typert/registry` 注册到 `ctx.typert.local`；对应 Cordis Service 同时被装配并保持存活。
4. Client 侧显式导入生成的 Remote contribution，调用 `ctx.remote.$mount()`；Client 根据 descriptor 安装类型化的 namespace 和方法。
5. Client 方法校验位置参数，构造 descriptor 要求的具名 `args`，然后通过 `ctx.connection.rpc.call('/api', endpoint, args)` 发送请求。
6. Host 的 Connection handler 将已认领的 endpoint 交给 `TypertGatewayService.invoke()`。Gateway 优先读取严格 descriptor；从未生成过严格定义时才允许 SRC fallback。
7. Gateway 校验参数集合，解析 lookup 对象或 Scope Context，取得并校验目标 Service，然后调用实际的 Host 方法；返回值通过 descriptor codec 校验。
8. Connection 传回响应，Client 再验证结果并将业务值交给调用方；分发、lookup、codec 或业务错误按各自的 RPC 错误约定返回。

Gateway 的 `SRC` fallback 和 `src-json` codec 只是源码启动时的弱反射路径：它解析简单参数并调用本地已加载方法，不提供任意远程脚本执行能力。协议包测试中的 `source-launch.ts` 也只是用 `tsx/esm` 验证源码装饰器加载。

## 相关源码

- [`protocol/src/index.ts`](../../packages/typert/protocol/src/index.ts)：Remote 装饰器、Service 绑定和 marker 快照。
- [`protocol/src/types.ts`](../../packages/typert/protocol/src/types.ts)：`InvocationDescriptor`、codec 和 registry/provider 类型。
- [`api/gateway/src/index.ts`](../../packages/api/gateway/src/index.ts)：Host 端 descriptor 解析和实际方法调用。
- [`typert/README.md`](../../packages/typert/README.md)：registry、loader、generator 的分工。
