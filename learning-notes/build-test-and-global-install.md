# 源码构建、测试与 `dsh` 全局安装

这篇笔记记录从仓库源码安装依赖、构建产物、运行测试，以及通过 pnpm 将 `apps/cli` 注册为全局 `dsh` 命令的步骤。它是个人学习记录；正式规则和完整命令仍以根 [`AGENTS.md`](../AGENTS.md)、[`docs/development.md`](../docs/development.md) 和 [`docs/testing.md`](../docs/testing.md) 为准。

## 1. 先确认安装对象

根目录 [`package.json`](../package.json) 是私有 workspace 根包，提供 `build` 和 `dsh` 等开发脚本，但不是要全局安装的 CLI 包。

[`apps/cli/package.json`](../apps/cli/package.json) 才是 `dsh` CLI 包；它声明了 `dsh` 的可执行入口为 `lib/bin.js`，并把 `lib/*.js` 和 `config` 纳入发布内容。

因此，构建命令从仓库根目录执行，全局安装命令的目标是 `apps/cli`，而不是根目录的 `package.json`。

## 2. 环境和依赖

仓库要求 Node.js `^22.19.0 || >=24.0.0`，并在根 [`package.json`](../package.json) 中固定 pnpm 版本 `11.7.0`。

在 PowerShell 中进入仓库根目录后检查版本：

```powershell
node --version
pnpm --version
```

如果系统尚未启用 Corepack，可以先执行：

```powershell
corepack enable
```

首次准备 workspace 依赖：

```powershell
pnpm install
```

`pnpm install` 会安装根工具依赖、连接 workspace package，并执行仓库定义的安装后处理；后续构建、测试和源码启动都以这次安装产生的 `node_modules` 为基础。

## 3. 构建源码

只构建 TypeScript 和运行时 package：

```powershell
pnpm run build:lib
```

`build:lib` 依次执行 host 和 client 两个 TypeScript/tsdown 构建面；CLI 的 tsdown 配置把入口输出到 `apps/cli/lib`。

构建可运行的完整应用，包含 Web 前端：

```powershell
pnpm run build
```

根 `build` 先执行 `build:lib`，再执行 Web 前端构建。要使用 `dsh web` 或把当前 checkout 作为生产运行时使用，应执行完整的 `pnpm run build`。

CLI 构建完成后，关键入口应存在于：

```text
apps/cli/lib/bin.js
```

可以用 PowerShell 检查：

```powershell
Test-Path .\apps\cli\lib\bin.js
```

构建不会把源码产物移动到 pnpm 全局目录；`apps/cli/lib` 仍是当前 checkout 的构建输出目录。

## 4. 测试源码

常用源码检查命令如下：

| 命令 | 作用 |
|---|---|
| `pnpm run test` | 运行 Vitest 单元测试。 |
| `pnpm run typecheck` | 执行严格 TypeScript 类型检查；脚本会先准备需要的 host 构建。 |
| `pnpm run lint` | 执行 lint 检查；脚本会先准备需要的 host 构建。 |
| `pnpm run test:coverage` | 运行带覆盖率的测试，适合检查覆盖率门槛。 |
| `pnpm run test:snapshot` | 运行 keyless snapshot replay，检查组装应用的稳定输出。 |
| `pnpm run test:e2e` | 运行真实 API e2e；没有 `DEEPSEEK_API_KEY` 时按仓库策略跳过需要密钥的测试。 |

日常修改后的最小检查可以从以下命令开始：

```powershell
pnpm run test
pnpm run typecheck
pnpm run lint
```

`pnpm run test` 主要验证源码测试面，不等同于验证全局安装后的 `dsh` 入口；全局入口需要在构建后单独做 CLI smoke test。

## 5. 从源码启动 CLI

根脚本中的 `pnpm dsh` 通过 tsx 直接运行 `apps/cli/src/bin.ts`，适合在 checkout 内调试启动器：

```powershell
pnpm dsh --help
pnpm dsh --profile headless "执行一个简单任务"
```

使用 Web profile 前先完成 `pnpm run build`：

```powershell
pnpm dsh web
```

源码启动和全局命令的区别是：源码启动使用 `src/bin.ts`，全局命令使用构建后的 `lib/bin.js`。

## 6. 使用 pnpm 全局安装当前 checkout

完成构建后，在仓库根目录执行：

```powershell
pnpm run build
pnpm add --global .\apps\cli
```

命令中的 `.\apps\cli` 是本地 CLI package 目录。它不会把根 workspace 安装成全局包，也不会把 `apps/cli/lib` 从仓库中移走；全局安装使用的是这个 package 的 manifest 和构建结果。

查询 pnpm 全局 package 目录和全局命令目录：

```powershell
pnpm root --global
pnpm bin --global
```

在当前 Windows 环境中，pnpm 返回的目录是：

```text
全局 package 管理目录：C:\Users\robby.he\AppData\Local\pnpm\global\v11
全局命令目录：C:\Users\robby.he\AppData\Local\pnpm\bin
```

上述路径会随 Windows 用户名、pnpm 版本和 pnpm 配置变化；以 `pnpm root --global` 和 `pnpm bin --global` 的实际输出为准。

全局安装后，pnpm 会在全局命令目录生成 Windows 命令 shim，通常是 `dsh.cmd`；它最终使用 `dsh` package 声明的 `lib/bin.js` 入口。

检查命令是否已经进入当前 shell 的 `PATH`：

```powershell
Get-Command dsh
where.exe dsh
```

从其他目录验证，而不是只在仓库根目录验证：

```powershell
Push-Location $env:TEMP
dsh --version
dsh --help
Pop-Location
```

如果 pnpm 报告 global bin 目录不在 `PATH`，执行下面的命令后重新打开终端：

```powershell
pnpm setup
```

## 7. 修改源码后的更新流程

修改 CLI 或其他 workspace package 后，重新生成构建产物：

```powershell
pnpm run build
```

为了让全局安装重新读取当前 `apps/cli` package，可以再次执行：

```powershell
pnpm add --global .\apps\cli
```

如果只运行源码入口，使用 `pnpm dsh ...`；如果验证全局安装，必须在其他目录使用 `dsh ...`，这样才能确认 PATH、全局命令 shim 和构建入口都正常。

卸载全局 CLI：

```powershell
pnpm remove --global @deepseek-ai/dsh
```

需要删除构建输出时使用仓库已有的清理脚本：

```powershell
pnpm run clean
```
