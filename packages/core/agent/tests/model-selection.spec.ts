import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import {
  agentEvents,
  installModelSelection,
  type Agent,
  type ModelSelectionRef,
} from '../src/index.ts'
import { ReasoningEffortId, type LlmCallConfig } from '@deepseek-ai/dsh-llm'

/**
 * 已完成，注释已经直接补充到 [model-selection.spec.ts](G:/workspace/deepseek-harness/packages/core/agent/tests/model-selection.spec.ts)。

这次补充的注释主要解释了以下几层内容：

- 测试为什么必须先挂载 `SystemPrompt`
  - `ctx.systemPrompt.assemble()` 不只是普通方法调用，它会触发 `system-prompt/assemble` waterfall。
  - `installModelSelection()` 注册的第一个监听器正是在这个 waterfall 中捕获 `selection.current`。

- `selection.current` 和 `selection.assembled` 的区别
  - `current` 表示“下一次 prompt 组装时应该使用的模型选择”。
  - `assembled` 表示“当前这一步在 prompt 组装阶段已经冻结下来的选择”。
  - `agent/request` 使用的是 `assembled`，而不是实时读取 `current`。

- 为什么要先选择 alpha，再切换成 beta
  - prompt 组装阶段捕获 alpha。
  - 组装完成后把 `current` 改成 beta。
  - 当前 step 的 request 仍然必须使用 alpha。
  - 下一次 prompt 组装后，beta 才会成为新的 step 的选择。
  - 这验证了 prompt 内容和 LLM 请求路由不会因为中途切换模型而不一致。

- `{} as Agent` 为什么可以作为测试里的 Agent
  - 这个测试不需要调用 Agent 的真实方法。
  - `agentEvents(ctx, agent)` 这里只需要一个对象作为事件 subject 和 scope key。
  - `agentEvents()` 会把这个对象注入事件 payload，并用它定位 scoped listener。

- `seed` 和 `inherited` 的作用
  - waterfall 最后的回调模拟下游已经解析出来的基础 `LlmCallConfig`。
  - 测试验证模型选择只覆盖 provider/model/reasoning effort，不会丢失 `temperature` 等无关配置。
  - 当 beta 没有指定 `reasoningEffort` 时，还要清除 inherited 的 alpha reasoning effort，避免把旧模型的参数带给新模型。

- `dispose()` 和 `ctx.fiber.dispose()` 的区别
  - `dispose()` 只移除 `installModelSelection()` 注册的两个监听器。
  - 后面的断言确认 prompt variables 恢复为空，request waterfall 重新返回原始 `seed` 对象。
  - `ctx.fiber.dispose()` 则负责结束整个 Cordis 测试生命周期，释放挂载的 `SystemPrompt` 插件。

我也做了验证：

- `pnpm exec vitest run packages/core/agent/tests/model-selection.spec.ts`
  - 1 个测试文件通过
  - 1 个测试通过
- `git diff --check`
  - 通过，无空白或换行问题
 */
describe('installModelSelection()', () => {
  it('snapshots prompt variables and request routing together, then disposes both listeners', async () => {
    /*
     * This test drives the two waterfalls that installModelSelection() joins:
     *
     * 1. SystemPrompt must be mounted because assemble() builds the base prompt
     *    and dispatches `system-prompt/assemble`. The installed listener snapshots
     *    selection.current into selection.assembled and adds the selected provider
     *    and model to the prompt variables.
     * 
     * 2. `agent/request` starts with the config returned by its final `next`
     *    callback. The installed listener overlays the snapshot from prompt
     *    assembly, not the possibly newer selection.current, onto that config.
     *
     * Keeping those phases on one snapshot prevents a model switch between prompt
     * assembly and request routing from giving one step mismatched prompt variables
     * and an LLM route. A later assembly makes the new selection active.
     */
    const ctx = new Context()
    // Mount the real prompt service so its assemble() entry point dispatches the
    // same waterfall used by an assembled application.
    await ctx.plugin(SystemPrompt)

    // The caller owns this mutable reference; installModelSelection() only reads
    // and advances it when the two waterfalls run.
    const selection: ModelSelectionRef = { current: undefined, assembled: undefined }
    // Both listeners are registered on this context, and their combined disposer
    // is returned so the caller can remove the model-selection behavior as a unit.
    const dispose = installModelSelection(ctx, selection)

    // agentEvents() needs only an identity here: it injects this object as the
    // event subject and uses it as the scoped routing key. No Agent methods run.
    const agent = {} as Agent
    // The final waterfall callback stands in for ordinary request resolution.
    // Selection routing must preserve unrelated fields such as temperature.
    const seed: LlmCallConfig = { provider: 'seed', model: 'seed', temperature: 0.2 }
    const signal = new AbortController().signal

    // With no current selection, prompt assembly records no snapshot and request
    // routing delegates unchanged; `toBe` proves it even preserves object identity.
    expect((await ctx.systemPrompt.assemble()).variables).toEqual({})
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)

    // Prompt assembly captures alpha for this step and exposes the same provider
    // and model as variables available to prompt templates.
    selection.current = {
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('high'),
    }
    expect((await ctx.systemPrompt.assemble()).variables).toMatchObject({ provider: 'alpha', model: 'a1' })

    // A switch after assembly belongs to a later step. This request must still
    // route through the alpha snapshot while retaining seed.temperature.
    selection.current = { provider: 'beta', model: 'b1' }
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toEqual({
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('high'),
      temperature: 0.2,
    })

    // The next assembly advances the snapshot to beta, making beta active for
    // both prompt variables and the following request.
    expect((await ctx.systemPrompt.assemble()).variables).toMatchObject({ provider: 'beta', model: 'b1' })
    const inherited: LlmCallConfig = {
      provider: 'alpha',
      model: 'a1',
      reasoningEffort: ReasoningEffortId('max'),
      temperature: 0.2,
    }
    // Beta does not select a reasoning effort, so routing removes the inherited
    // alpha effort instead of accidentally applying it to a different model.
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 1, step: 1, signal }, () => Promise.resolve(inherited),
    )).resolves.toEqual({ provider: 'beta', model: 'b1', temperature: 0.2 })

    // Disposal must remove both listeners: assembly no longer adds variables and
    // request dispatch once again returns the final callback's exact object.
    dispose()
    expect((await ctx.systemPrompt.assemble()).variables).toEqual({})
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/request', { turn: 2, step: 0, signal }, () => Promise.resolve(seed),
    )).resolves.toBe(seed)

    // Finish the Cordis lifecycle and release the mounted SystemPrompt plugin.
    await ctx.fiber.dispose()
  })
})
