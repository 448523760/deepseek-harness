# Cordis `waterfall`：事件调用链与 `system-prompt/assemble`

本文是一篇源码阅读参考，说明 Cordis 的 `waterfall` 如何组织监听器调用，以及 `SystemPrompt.assemble()` 如何利用这条调用链变换一次 prompt assembly。正式 API 约定以 [`vendor/cordis/src/events.ts`](../../vendor/cordis/src/events.ts) 和 [`dsh-system-prompt` README](../../packages/core/system-prompt/README.md) 为准。

## 1. 先给结论

`waterfall` 不是把监听器按顺序全部调用的 `serial`，而是把每个监听器包成一层函数。外层监听器先获得控制权，只有它调用 `next()`，下一层监听器或最后的内置回调才会执行。

监听器通常在调用 `next()` 前处理输入，在 `await next()` 后处理下游结果；因此同一条链同时支持“向内传递”和“向外返回”两个阶段。不调用 `next()` 会截断后续链，这就是 waterfall 的 veto 语义。

对 `system-prompt/assemble` 来说，`assembly` 是进入链条的初始对象，最后的内置回调返回这个对象；监听器可以原地修改它，也可以返回一个新的 `PromptAssembly`。没有完整 prompt 约束或运行时上下文抑制时，链条返回的值就是 `assemble()` 的结果。

## 2. 类型声明表达了什么

Cordis 在 [`events.ts` 的 `Context` 扩展](../../vendor/cordis/src/events.ts#L34-L108) 中声明了两个 `waterfall` 重载：普通形式接收事件名和事件参数，显式 receiver 形式在事件名之前接收一个 `thisArg`。两种形式都根据 `Events[K]` 推导参数和返回值。

事件声明本身负责把最后一个参数定义为 `next`。例如，`system-prompt/assemble` 的事件类型是 `(assembly, context, next) => Promise<PromptAssembly>`，所以调用者必须提供一个返回 `Promise<PromptAssembly>` 的最终回调，监听器也必须返回同样的结果类型。

返回值是最外层监听器的返回值，而不是 Cordis 自动合并的结果。监听器调用 `next()` 后，如果想把内层结果原样传出，必须 `return next()` 或 `return await next()`；它也可以等待内层结果后修改，再返回自己的结果。

`waterfall()` 方法本身不是 `async`。它立即返回最外层回调的返回值；这个返回值可以是 Promise，所以业务调用方通常使用 `await ctx.waterfall(...)` 等待整条异步链完成。

`waterfall` 不检查返回值来决定是否继续，也没有 `serial` 那种 bail 值规则。继续与否完全由监听器是否调用 `next()` 决定；监听器即使返回 `false`，只要已经调用 `next()`，后续链仍然已经开始执行。

## 3. `dispatch()` 先解析 receiver、事件名和监听器

`waterfall()` 首先把参数数组交给 [`EventsService.dispatch()`](../../vendor/cordis/src/events.ts#L158-L175)。这个数组会被原地消费，解析过程如下：

1. 如果第一个参数是对象或函数，`dispatch()` 把它当作显式 `thisArg` 移出参数数组；否则本次 dispatch 没有 receiver。
2. 下一个参数被当作事件名移出参数数组。
3. 普通事件会先触发 `internal/dispatch` 诊断事件，携带 dispatch mode、事件名、剩余参数和 receiver；`internal/*` 事件不会递归触发这项诊断。
4. `thisArg` 如果带有 `Context.filter`，Cordis 会用它检查每个监听器所属的 context；`global` 监听器绕过这个过滤器。
5. 通过过滤的监听器被映射成绑定了 `thisArg` 的 callback，形成本次 dispatch 使用的 callback 数组。

因此，`thisArg` 不只是监听器的 JavaScript `this`，还承担事件路由和作用域过滤的输入角色。`dispatch()` 使用 `filter().map()` 生成当前数组，当前 dispatch 开始后新增监听器不会插入这次已经解析出的链条。

## 4. `waterfall()` 的核心实现

[`EventsService.waterfall()`](../../vendor/cordis/src/events.ts#L224-L243) 的实际算法可以压缩成下面的伪代码：

```text
cbs = dispatch('waterfall', args)
inner = args.pop()
next = () => {
  cb = cbs.shift() ?? inner
  return cb(...args)
}
args.push(next)
return next()
```

`dispatch()` 完成后，`args` 只剩事件参数和原始最后回调；`inner` 保存这个原始回调，随后用同一个 `next` 函数替换最后参数。因此每个监听器收到的参数仍然是原事件参数加一个无参数的 `next()`。

假设注册顺序得到监听器 A、B，实际调用关系如下：

```text
waterfall(..., inner)
  -> next() 调用 A(..., next)
       -> A 调用 next()，进入 B(..., next)
            -> B 调用 next()，进入 inner(...)
            <- B 返回结果
       <- A 返回结果
  <- waterfall 返回 A 的结果
```

默认注册使用 `push`，所以 A 先于 B 成为外层；使用 `{ prepend: true }` 的新监听器会被放到数组头部，成为更外层的一层。调用顺序由监听器数组决定，不由事件名或插件类名决定。

每次调用 `next()` 都会从 `cbs` 中 `shift()` 一个 callback。实现没有额外的“一次性 continuation”状态，因此监听器应把 `next()` 当作一次性继续点使用；重复调用会继续消费后续 callback，并可能重复执行最终回调。

如果没有监听器，`cbs` 为空，第一次 `next()` 直接调用 `inner`。如果某个监听器不调用 `next()`，`inner` 以及它之后的监听器都不会执行，但该监听器的返回值仍然会成为整条链的返回值。

实现没有吞掉同步异常，也不会把异步 rejection 转换成其他结果；异常或 rejection 会沿返回值传播到调用方。`system-prompt` 的 `assemble()` 用 `await` 接收这个 rejection。

## 5. 监听器从哪里来

`ctx.on()` 和 `ctx.once()` 的注册逻辑位于 [`events.ts`](../../vendor/cordis/src/events.ts#L245-L317)。注册前会确认当前 fiber 仍然有效，普通监听器通过当前 context 的 effect 保存；fiber 卸载时，Cordis 自动执行 disposer 并从事件列表移除监听器。

`on(name, listener, options)` 支持两个与 waterfall 直接相关的选项：`prepend` 控制监听器进入列表头部还是尾部，`global` 让监听器忽略 dispatch receiver 的 context filter。`once()` 在第一次真正调用监听器前先注销自己，因此即使监听器随后抛错，也不会再次注册。

事件监听器的生命周期属于注册时的 fiber，而不是一次 dispatch。一个插件通过 `ctx.on()` 注册的 waterfall 行为会随着插件卸载消失，这也是事件扩展点能够安全重载的原因。

## 6. `system-prompt/assemble` 如何接入 waterfall

### 6.1 事件声明

`SystemPrompt` 在 [`index.ts` 的事件声明](../../packages/core/system-prompt/src/index.ts#L18-L38) 中把 `system-prompt/assemble` 标记为 `@mode waterfall`。它的 receiver 类型是 `Scoped<SystemPrompt>`，事件参数依次是 `PromptAssembly`、`AssembleContext` 和 `next`。

这里的 receiver 不是事件 payload。真实的 `SystemPrompt` 服务仍然由 assembly 相关的业务代码持有；receiver 主要用于让 Cordis 在 dispatch 时执行 `Context.filter`，而 `assembly` 和 `context` 才是监听器可以读取和修改的事件参数。

### 6.2 进入 waterfall 前先建立基础 assembly

[`SystemPrompt.assemble()`](../../packages/core/system-prompt/src/index.ts#L457-L545) 在调用 waterfall 前完成基础数据准备：

- 根据 `context.scope` 合并全局层和作用域层，作用域变量和同名 section 覆盖全局值。
- 执行变量、section、runtime context 和 tool provider，得到当前请求的快照。
- 按 section 的 `order` 排序，并在 provider 数据上完成 tool order 的规范化。
- 记录有效的 complete section，用于 waterfall 返回后重新执行完整 prompt 约束。

因此，`system-prompt/assemble` 监听器看到的是已经完成 provider 求值和基础排序的 assembly。监听器后来追加的 section 或 tool 不会再次经过这一步排序；监听器需要对自己返回的顺序负责。

### 6.3 调用参数逐项对应

源码中的调用是 `this.ctx.waterfall(scopeTarget(this, scope), 'system-prompt/assemble', assembly, context, () => Promise.resolve(assembly))`。按 `dispatch()` 和 `waterfall()` 的解析规则，各位置的作用如下：

| 位置 | 值 | 作用 |
|---|---|---|
| 显式 receiver | `scopeTarget(this, scope)` | 提供 listener filter，并作为监听器的 `this`；不会成为事件 payload |
| 事件名 | `'system-prompt/assemble'` | 选择该事件的监听器列表 |
| 第一个事件参数 | `assembly` | 进入链条的 sections、contexts、tools 和 variables |
| 第二个事件参数 | `context` | 本次 assembly 的 scope、signal 及其他 merge-extensible 字段 |
| 最后回调 | `() => Promise.resolve(assembly)` | 没有监听器截断时的内置 assembly 结果 |

### 6.4 `scopeTarget()` 决定哪些监听器参与

[`scopeTarget()`](../../packages/core/scope/src/index.ts#L159-L184) 返回一个只用于路由的 carrier，并保留 `SystemPrompt` 原有 filter。Cordis 的 `dispatch()` 把这个 carrier 当作 receiver 后，会按 carrier 的 `Context.filter` 判断监听器是否参与。

无 scope 标签的监听器可以观察所有 assembly；带标签的监听器只有在标签与 dispatch scope 相同，或标签是该 scope 的祖先时才参与。子 scope 的监听器不会反向收到父 scope 的 assembly；没有 scope 的 assembly 也不会触发带标签的监听器。`global: true` 仍然可以绕过 receiver filter。

### 6.5 一个 assembly listener 的前后处理

下面的流程表示两个监听器如何共享同一个 assembly 引用，并在 `await next()` 前后分处不同阶段：

```text
A：追加 section-a
A：await next()
  B：读取 section-a
  B：await next()
    inner：返回基础 assembly
  B：追加或替换下游结果
  B：return result
A：读取 B 的结果并继续修改
A：return result
```

监听器可以像 `system-prompt` 测试中的 A、B 那样先后看到对方的原地修改，也可以像工具、计划模式等消费者一样等待下游返回后替换 `sections` 或 `tools`。由于 `assemble()` 返回 waterfall 的结果，监听器返回的新对象同样具有权威性。

### 6.6 waterfall 返回后仍有两项业务约束

`assemble()` 不会把所有业务约束都交给监听器。waterfall 完成后，如果存在有效的 complete section，源码会恢复进入 waterfall 前保存的那一个 section，并让它成为唯一的 `sections`；监听器不能通过追加、修改或返回新对象替换这个完整 prompt。

如果当前 scope 启用了 runtime context 抑制，`assemble()` 会在 waterfall 返回后把 `contexts` 设为空数组，因此监听器添加的 runtime context 也会被丢弃。除这两项约束外，waterfall 返回的 sections、tools、variables 和其他扩展字段保持权威。

## 7. 与源码测试对照

[`system-prompt.spec.ts`](../../packages/core/system-prompt/tests/system-prompt.spec.ts#L247-L302) 覆盖了多个监听器按注册顺序嵌套、监听器不调用 `next()` 时短路，以及 complete section 在 waterfall 后恢复。

[`scoped.spec.ts`](../../packages/core/system-prompt/tests/scoped.spec.ts#L207-L224) 证明作用域 listener 只塑造自己的 assembly；[`tool-order.spec.ts`](../../packages/core/system-prompt/tests/tool-order.spec.ts#L81-L96) 证明基础 tool order 在 waterfall 前完成，而 listener 自己追加的 tool 不会被重新排序。

这些测试共同说明：waterfall 负责可组合的调用链，SystemPrompt 负责在调用链前建立快照、在调用链后执行 complete section 和 runtime context 的最终约束。

## 8. 阅读和使用时的注意事项

- 不要把 `waterfall` 当成“自动执行所有监听器”的广播 API；每层都必须显式调用 `next()` 才能继续。
- 调用 `next()` 后要返回它的结果，或者返回经过处理的新结果；只调用而不返回会丢失内层结果。
- 不要把 receiver 和 payload 混为一谈；`scopeTarget()` 负责路由，`assembly` 和 `context` 才是 `system-prompt/assemble` 的事件参数。
- 不要假设 waterfall 会重新排序监听器修改后的数组；`SystemPrompt` 的 provider canonicalization 发生在 waterfall 之前。
- 不要试图通过 waterfall listener 改写 complete section 或被抑制的 runtime contexts；这些限制在 waterfall 返回后重新执行。
- 不要在同一个 listener 中并发或重复调用 `next()`；源码的 `shift()` 语义会让同一条链被继续消费多次。

## 9. 一句话复习

Cordis `waterfall` 是“监听器包裹内层 continuation”的事件分发器：`dispatch()` 先解析 receiver 并筛选 listener，`waterfall()` 再用 `shift()` 把 listener 串成由外向内、结果由内向外传播的链；`SystemPrompt.assemble()` 用 `scopeTarget()` 做作用域路由，用最终 callback 提供基础 assembly，并在链条结束后保留 complete section 与 runtime context 抑制规则。
