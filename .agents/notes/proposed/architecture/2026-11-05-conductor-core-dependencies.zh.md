# Agent Note: Conductor 核心依赖清单

Status: proposed

[English](2026-11-05-conductor-core-dependencies.md) | 中文

## Problem

Biyocon Harness 保持 rc.7 基础；所有者已取消 [#68](https://github.com/Biyocon/biyocon-harness/issues/68) 的上游同步路线。今后应能将 Conductor 作为独立 DSH 插件移植到更新的 DeepSeek Harness。`packages/conductor/*` 和独立 `ui-conductor-subagent` 包以外，已有为 Conductor 所做的改动，使移植并非直接复制。本清单记录 `c1a6877f9215b3fc973aaed5247d07d6e8f6dab5` 上已合并的源代码依赖，不承诺与未知的新宿主兼容。

## Proposal

新 Conductor 代码留在 `packages/conductor/*` 和独立 UI 插件包中。避免修改 agent-loop、subagent、workflow、llm、system-prompt、tools、client-runtime 等共享包。必要的共享改动须小且通用，并在本清单登记每个修改的源文件、用途及 PR 号；依赖方向始终单向：核心绝不导入 Conductor。新的核心改动须解释通用扩展点并有针对性测试。本清单用于未来移植核对，不授权改造现有代码或同步上游。

### Merged dependencies and planned extension

条目列举相关已合并 PR 中位于 Conductor 包之外的源文件。生成目录、README、测试、fixture、snapshot 和示例接线随其源改动更新；运行时使用的目录及直接清单或 TypeScript 项目绑定列在下文。排除覆盖整个 Biyocon 的品牌/本地化及无关修复。移植前须检查目标 API 和完整 PR 差异。

| PR | Conductor 包之外的文件 | 用途／移植关注点 |
|---|---|---|
| [#5](https://github.com/Biyocon/biyocon-harness/pull/5) | `packages/core/session/src/known-event-types.ts`; `packages/subagent/subagent/src/child-agent.ts`; `packages/subagent/subagent/src/index.ts`; `packages/subagent/subagent/src/types.ts`; `packages/subagent/subagent-acp/src/index.ts`; `packages/subagent/subagent-fork-in-process/src/index.ts`; `packages/subagent/subagent-in-process-driver/src/index.ts`; `packages/subagent/subagent-spawn-in-process/src/index.ts`; `packages/workflow/workflow/src/runtime-types.ts`; `packages/workflow/workflow-worker-thread/src/host.ts`; `packages/workflow/workflow-worker-thread/src/index.ts`; `packages/workflow/tool-ralph/src/index.ts` | 初始 Conductor checkpoint 注册、可信子级工具 guard、workflow 到子级的组合，以及 Ralph 集成；在目标宿主中保留或替代这些通用扩展点。 |
| [#6](https://github.com/Biyocon/biyocon-harness/pull/6) | `packages/sandbox/sandbox/src/classification.ts`; `packages/sandbox/sandbox/src/index.ts`; `packages/sandbox/sandbox-local/src/index.ts`; `packages/sandbox/sandbox-local/src/profiles.ts`; `packages/shell/bash-sandbox/src/helpers.ts`; `packages/shell/bash-sandbox/src/index.ts`; `packages/shell/pwsh-sandbox/src/helpers.ts`; `packages/shell/pwsh-sandbox/src/index.ts`; `packages/terminal/terminal-bash/src/index.ts`; `packages/subagent/subagent/src/index.ts`; `packages/subagent/subagent/src/types.ts`; `packages/subagent/subagent/src/out-of-process.ts`; `packages/subagent/subagent-acp/src/index.ts`; `packages/subagent/subagent-fork-in-process/src/index.ts`; `packages/subagent/subagent-in-process-driver/src/index.ts`; `packages/subagent/subagent-spawn-in-process/src/index.ts`; `packages/workflow/workflow/src/runtime-types.ts`; `packages/workflow/workflow-worker-thread/src/host.ts`; `packages/workflow/workflow-worker-thread/src/index.ts`; `packages/workflow/tool-ralph/src/index.ts` | 通用质量命令约束、网络/文件强制执行报告、子级与 workflow 能力传递；移植前核对目标宿主沙箱语义。 |
| [#20](https://github.com/Biyocon/biyocon-harness/pull/20) | `packages/client/ui-agent-preset/src/client/locales.ts` | 硬编码 `conductor` preset 键及英/丹显示文本。把本地化名称和描述移入插件自有 preset 元数据，由通用 preset UI 读取可选条目。 |
| [#45](https://github.com/Biyocon/biyocon-harness/pull/45) | `packages/core/session/src/known-event-types.ts`; `packages/client/ui-subagent/src/client/index.ts`; `packages/client/ui-subagent/src/client/SubagentCatalogAction.tsx`; `packages/workflow/tool-ralph/src/index.ts` | `conductor/child` 类型的生成投影、独立 Conductor UI 插件使用的通用子级目录插槽、Ralph 观察者生命周期；提取时重新生成事件目录。 |
| [#53](https://github.com/Biyocon/biyocon-harness/pull/53) | `packages/core/session/src/known-event-types.ts` | 从已合并的事件声明生成 `conductor/owner-continuation-consumed`、`conductor/owner-question-created`、`conductor/owner-response-recorded`、`conductor/owner-terminal-rejection` 的投影。 |
| [#54](https://github.com/Biyocon/biyocon-harness/pull/54) | `packages/interaction/user-questions/src/index.ts`; `packages/interaction/user-questions/src/types.ts`; `packages/host/apiproxy/src/api-proxy.ts`; `packages/host/apiproxy/src/api/events.schema.ts`; `packages/host/apiproxy/src/api/questions.schema.ts`; `packages/host/apiproxy/src/question-requests.ts`; `packages/client/ui-user-questions/src/client/ConductorOwnerPanel.tsx`; `packages/client/ui-user-questions/src/client/ConductorOwnerPanel.module.css`; `packages/client/ui-user-questions/src/client/ConductorOwnerReceipt.tsx`; `packages/client/ui-user-questions/src/client/QuestionComposer.tsx`; `packages/client/ui-user-questions/src/client/QuestionTakeover.tsx`; `packages/client/ui-user-questions/src/client/conductor-owner-history.ts`; `packages/client/ui-user-questions/src/client/contract/slots.ts`; `packages/client/ui-user-questions/src/client/index.ts`; `packages/client/ui-user-questions/src/client/locales.ts`; `packages/core/session/src/known-event-types.ts` | 类型化所有者意图/回答、持久接受及 RPC 验证、所有者面板/回执，以及 `conductor/owner-response-acknowledged` 的生成投影。这是最大的领域专用宿主/UI 耦合；把 UI 移到独立插件，仅保留通用提问扩展点。 |
| [#64](https://github.com/Biyocon/biyocon-harness/pull/64) | `packages/core/agent-loop/src/agent.ts`; `packages/core/agent-loop/src/index.ts`; `packages/core/agent-loop/src/tool-calls.ts`; `packages/core/agent/src/index.ts`; `packages/llm/llm/src/index.ts`; `packages/llm/llm/src/types.ts`; `packages/llm/llm-deepseek/src/adapter.ts`; `packages/subagent/subagent/src/index.ts`; `packages/subagent/subagent/src/types.ts`; `packages/subagent/subagent-fork-in-process/src/index.ts`; `packages/subagent/subagent-in-process-driver/src/index.ts`; `packages/subagent/subagent-spawn-in-process/src/index.ts`; `packages/workflow/workflow/src/runtime-types.ts`; `packages/workflow/workflow-worker-thread/src/host.ts`; `packages/workflow/workflow-worker-thread/src/index.ts` | 通用 `reservedSessionId`、含 reasoning 的累计 `maxOutputTokens`、provider 能力检查、逐次循环限制、DeepSeek 路由保证、workflow 子级提示与 token 上限。批评者身份与预算依赖这些能力；不得为了保留功能而令核心导入 Conductor。参见[原决策](../../implemented/architecture/2026-11-02-reserved-child-identity-and-output-token-limit.md). |
| [#71](https://github.com/Biyocon/biyocon-harness/pull/71) | `packages/interaction/user-questions/src/types.ts`; `packages/client/ui-user-questions/src/client/ConductorOwnerPanel.tsx` | v5 批评者运行的所有者继续元数据和面板呈现；遵循 #54 的移植分界。 |
| Planned [#75 phase 1](../feature/2026-11-05-conductor-analysis-claim-verification.md) | `packages/core/system-prompt/src/index.ts`; `packages/core/tools/src/index.ts`; `packages/web/tool-web/src/search.ts` (proposed locations) | 通用的类型化 `PromptSection.requiresTools` 与有效工具名称视图，网页指导关联真实能力。尚无代码交付；本清单合并及所有者另行下达任务后，才以独立 PR 实施。 |
| Planned [统一 v6 设计](../feature/2026-11-11-conductor-v6-evidence-verification-and-budgets.md) | `packages/core/agent/src/runtime-types.ts`; `packages/core/agent-loop/src/agent.ts`; `packages/llm/llm/src/index.ts`; `packages/llm/llm/src/types.ts`; `packages/llm/llm-retry/src/index.ts`; `packages/llm/llm-deepseek/src/adapter.ts`; `packages/llm/llm-pi-ai/src/adapter.ts` (proposed locations) | 冻结 schema 前，G0 证明精确 route 保守上界。通用逐实际尝试 preflight 在两个 adapter 内、llm-retry 之下执行，包含有效尝试元数据/日志、输出强制限制，以及禁用或预留感知的 SDK 重试。通用 event 须声明、更新 catalog 及两个 SDK 投影。本设计不导入 Conductor 或实现运行时；实际前置 PR 和可行性 review 先于实施。 |

历史上的 `packages/extensions/tool-cordis/src/api-catalog.ts`、`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` 和 `packages/core/session/src/known-event-types.ts` 都是生成投影，而非直接注册。`scripts/gen-persistence-catalog.ts` 从 `SessionEventMap` 声明合并生成事件集合；提取时须先完成下述生成器改动，再按已安装包重新生成。API 和插槽目录也须重新生成。批评者依赖 #64 的身份和预算保证。现有 `ui-user-questions` 中的所有者 UI 应移入独立插件。

### Package/bundle coupling

| 包路径 | 当前耦合 | 插件化后的替代方式 |
|---|---|---|
| `packages/bundle/base/cordis.patch.yml` | 随产品附带的基础 bundle 以 `conductor-presentation` 安装 `@deepseek-ai/dsh-conductor`，独立于 agent preset 注册子级及不可用运行投影。 | 把该行移至可选的 Conductor bundle，并在需要 Conductor 视图前加载。 |
| `packages/bundle/base/package.json` | 为基础 bundle 的安装声明 `@deepseek-ai/dsh-conductor` 依赖。 | 由可选 Conductor bundle 持有该依赖，使基础 bundle 不依赖 Conductor。 |
| `packages/bundle/web-app/cordis.patch.yml` | 随产品附带的 Web bundle 无条件以 `ui-conductor-subagent` 安装 `@deepseek-ai/dsh-client-ui-conductor-subagent`（[#45](https://github.com/Biyocon/biyocon-harness/pull/45)）。 | 把 UI 安装行与宿主呈现行一起移入可选 Conductor bundle。 |
| `packages/bundle/web-app/package.json` | 为该 Web bundle 安装声明 Conductor UI 插件依赖（[#45](https://github.com/Biyocon/biyocon-harness/pull/45)）。 | 把依赖移入可选 Conductor bundle，使通用 Web bundle 无需 Conductor 也能加载。 |
| `packages/client/ui-user-questions/package.json`; `packages/client/ui-user-questions/tsconfig.json` | 共享提问 UI 对 Conductor 有 peer/dev 依赖及指向 `packages/conductor/conductor` 的 TypeScript 项目引用（[#54](https://github.com/Biyocon/biyocon-harness/pull/54)）。 | 把 owner 专属组件连同依赖和引用移到独立 Conductor UI 插件，使通用提问包不导入 Conductor。 |
| `tsconfig.base.json` | 源码路径别名解析 Conductor 类型和 Conductor UI 插件；不变量及源码包含通配符也覆盖 `packages/conductor/*`。 | 从宿主编译配置移除 Conductor 专属别名和通配符；通过独立项目配置编译提取出的包。 |
| `tsconfig.client.json` | 通用客户端构建引用 `ui-conductor-subagent` 项目。 | 将该项目引用移至可选的 Conductor UI 构建。 |
| `tsconfig.host.json` | 通用宿主程序引用三个 Conductor 项目，并纳入 Conductor 浏览器测试。 | 将项目引用和测试纳入项移至插件集成构建。 |
| `examples/package.json` | 将 `dsh-conductor`、`dsh-conductor-presets` 和 `dsh-tool-conductor` 设为示例工作区的必需依赖。 | 将 Conductor 示例及其依赖移至可选插件示例工作区，使通用示例保持独立。 |
| `scripts/gen-persistence-catalog.ts` | `collectLogEvents()` 只扫描 `packages/*/*/src/**/*.ts`，`packageNameFor()` 从仓库内路径推断包所有权。提取后插件的必需事件将缺席于 `known-event-types.ts`，回放时被拒绝。 | 通过显式的已安装插件输入发现事件声明，并从插件包清单确认所有权；为每个装配发行版重新生成严格的已知事件集合。若插件可在宿主构建后安装，则在读取会话前增加经过验证的事件注册步骤；绝不静默接受未知的必需事件。 |

### Repository tooling and examples

| 路径 | 当前耦合 | 插件化后的替代方式 |
|---|---|---|
| `scripts/gen-tool-catalog.ts` | 导入并安装 `dsh-tool-conductor`，以生成其工具目录条目。 | 从已安装插件加载目录贡献；移除通用脚本对 Conductor 的直接导入。 |
| `scripts/gen-cordis-catalog.ts` | 硬编码 Conductor 所有者测试组合值的说明。 | 将说明随插件迁移，或经通用目录元数据提供。 |
| `scripts/check-workspace-constraints.ts` | 要求 Conductor 发布包包含带哈希的持久化代码块。 | 将此包专属的打包断言移至 Conductor 发布检查。 |
| `knip.json`; `scripts/ui-locales.spec.ts`; `scripts/translation-pairing.manifest.json` | 指向 Conductor 示例 fixture、内置 preset 元数据和生成的技能资源。 | 将 fixture 与 preset 检查移至插件示例；资源生成迁移时更新通用双语配对排除项。 |
| `scripts/type-equiv.manifest.json`; `scripts/verify-package-readme-model-experience.ts` | 固定 Conductor 类型到文档的映射以及 Conductor README 例外。 | 将映射和文档检查移至插件文档；移除宿主专属例外。 |
| `examples/headless-agent/conductor*.cordis.snapshot.yml` | 装配 Conductor 专属回放示例及其 fixture。 | 将其与依赖一并放入可选插件的集成示例。 |

### App-level coupling

对 `apps/` 的扫描涵盖可执行接线、打包、文档和测试证据。这些是应用装配，而非核心包导入；提取时须搬走或替换，不能让宿主依赖 Conductor。

| 应用路径 | 当前耦合 | 插件化后的替代方式 |
|---|---|---|
| `apps/cli/scripts/source-launch.ts` | CLI 启动前调用 `generateConductorSkills()`。 | 由 Conductor bundle 安装资源；通用源码启动器不感知 Conductor。 |
| `apps/cli/scripts/generate-conductor-skills.ts` | 将 `.agents/conductor/{README.md,roles/,templates/}` 和 `.agents/skills/conductor-*/` 复制到 `apps/cli/config/agent-presets/conductor/skills/`。 | 从 Conductor 包经技能注册或 bundle 自有资源步骤发布。 |
| `apps/cli/tsdown.config.ts` | CLI 构建后调用同一生成器。 | 将资源步骤移入 Conductor 包构建或 bundle。 |
| `apps/cli/config/agent-presets/conductor/agent.cordis.yml`; `apps/cli/config/agent-presets/conductor/preset.yml` | 定义随应用附带的组合、提示、技能来源及显示元数据。 | 插件包提供 bundle 入口和 preset 元数据，经通用 preset loader 发现。 |
| `apps/cli/package.json` | 把 `dsh-conductor-presets` 和 `dsh-tool-conductor` 列为 CLI 必需依赖，并打包 `config/`。 | 独立安装可选的 Conductor bundle 和 preset。 |
| `apps/cli/composition.md`; `apps/cli/reference/README.md`; `apps/cli/reference/README.zh.md` | 记载内置组合和启动时资源准备。 | 从已安装 bundle 生成组合图，并在 Conductor 包内维护说明。 |
| `apps/cli/tests/conductor-assets.e2e.ts`; `apps/cli/tests/conductor-source-launch.spec.ts`; `apps/cli/tests/generate-conductor-skills.spec.ts`; `apps/cli/tests/fixtures/source-launch-fixture.ts` | 验证 CLI 自有资源复制与源码启动；fixture 还导入 `conductor-presets` 源码。 | 将资源与 bundle 测试移至 Conductor；CLI 只保留通用 bundle 加载覆盖。 |
| `apps/cli/tests/web-agent-presets.e2e.ts`; `apps/web/tests/agent-preset-authoring.e2e.ts`; `apps/web/tests/agent-preset-selection.e2e.ts` | 假定内置目录及浏览器 UI 必有 Conductor preset。 | 验证插件安装及可选 preset 发现。 |
| `apps/web/tests/conductor-owner.e2e.ts`; `apps/web/tests/conductor-critic.e2e.ts`; `apps/web/tests/snapshots/conductor-critic/*`; `apps/web/tsconfig.json` | 导入 Conductor 类型与 adapter、纳入浏览器场景并固定批评者输出。 | 将 Conductor 浏览器测试、批评者 goldens 及 TypeScript 纳入项移到插件集成测试。 |
| `apps/web/tests/snapshots/agent-preset-authoring/created.expected.md`; `apps/web/tests/snapshots/agent-preset-authoring/damaged.expected.md`; `apps/web/tests/snapshots/agent-preset-authoring/section.expected.md`; `apps/web/tests/snapshots/agent-preset-selection/danish-presets.expected.md`; `apps/web/tests/snapshots/agent-preset-selection/menu.expected.md`; `apps/web/tests/snapshots/conductor-owner/da-DK-accepted-receipt.expected.md`; `apps/web/tests/snapshots/conductor-owner/da-DK-waiting.expected.md`; `apps/web/tests/snapshots/conductor-owner/en-US-accepted-receipt.expected.md`; `apps/web/tests/snapshots/conductor-owner/en-US-proposal-receipt.expected.md`; `apps/web/tests/snapshots/conductor-owner/en-US-proposal.expected.md`; `apps/web/tests/snapshots/conductor-owner/en-US-rejected-receipt.expected.md`; `apps/web/tests/snapshots/conductor-owner/en-US-waiting.expected.md` | 固定内置 preset 与所有者卡片输出。 | 可选插件快照留在其集成测试；重新记录通用应用基线。 |

`apps/cli/src` 和 `apps/web/src` 没有 Conductor 引用。快照是测试证据，而非运行时依赖。

## Alternatives considered

**先同步 fork。** 所有者已否决。此时移动基础会掩盖 Conductor 专有的依赖。

**把 PR 中每个非 Conductor 文件都算作核心依赖。** 不采用：生成目录、snapshot、测试和广泛本地化是证据或投影，不是移植插件必需的代码。源文件清单仍使运行时及宿主/UI 耦合可审查。

**将当前核心改动全部复制到未来宿主。** 不作为默认方案：目标可能已有等效扩展点。先比较能力与测试，只补必要且通用的小缺口；核心绝不能导入 Conductor。

## Acceptance criteria

所有者可以找到每个文件与已合并 PR，区分通用与 Conductor 专有用途，并看到计划中的 `requiresTools` 而不误以为已交付。今后 Conductor PR 只要修改共享源文件，就须登记文件、用途和 PR 号；未来移植需验证单向导入并把所保留能力映射到新宿主。

## Risks

这是从已合并差异生成的首版清单，不证明每一行代码仍为当前 master 或未来宿主所必需。某些文件兼有通用与 Conductor 专有行为。所有者卡片的 UI/RPC 改动及直接会话事件注册是最明显的移植工作。本 note 不启动上游同步或阶段 1 实施。
