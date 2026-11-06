# Agent Note: Conductor 核心依赖清单

Status: proposed

[English](2026-11-05-conductor-core-dependencies.md) | 中文

## Problem

Biyocon Harness 保持 rc.7 基础；所有者已取消 [#68](https://github.com/Biyocon/biyocon-harness/issues/68) 的上游同步路线。今后应能将 Conductor 作为独立 DSH 插件移植到更新的 DeepSeek Harness。`packages/conductor/*` 和独立 `ui-conductor-subagent` 包以外，已有为 Conductor 所做的改动，使移植并非直接复制。本清单记录 `c1a6877f9215b3fc973aaed5247d07d6e8f6dab5` 上已合并的源代码依赖，不承诺与未知的新宿主兼容。

## Proposal

新 Conductor 代码留在 `packages/conductor/*` 和独立 UI 插件包中。避免修改 agent-loop、subagent、workflow、llm、system-prompt、tools、client-runtime 等共享包。必要的共享改动须小且通用，并在本清单登记每个修改的源文件、用途及 PR 号；依赖方向始终单向：核心绝不导入 Conductor。新的核心改动须解释通用扩展点并有针对性测试。本清单用于未来移植核对，不授权改造现有代码或同步上游。

### Merged dependencies and planned extension

条目列举相关已合并 PR 中位于 Conductor 包之外的源文件。生成的 API 目录、README、测试、fixture、snapshot、示例接线和清单随其源改动更新，不构成独立运行依赖。排除覆盖整个 Biyocon 的品牌/本地化及无关修复。首版列出准确源路径；未来移植前必须检查目标 API 和完整 PR 差异。

| PR | Conductor 包之外的文件 | 用途／移植关注点 |
|---|---|---|
| [#5](https://github.com/Biyocon/biyocon-harness/pull/5) | `packages/core/session/src/known-event-types.ts`; `packages/subagent/subagent/src/child-agent.ts`; `packages/subagent/subagent/src/index.ts`; `packages/subagent/subagent/src/types.ts`; `packages/subagent/subagent-acp/src/index.ts`; `packages/subagent/subagent-fork-in-process/src/index.ts`; `packages/subagent/subagent-in-process-driver/src/index.ts`; `packages/subagent/subagent-spawn-in-process/src/index.ts`; `packages/workflow/workflow/src/runtime-types.ts`; `packages/workflow/workflow-worker-thread/src/host.ts`; `packages/workflow/workflow-worker-thread/src/index.ts`; `packages/workflow/tool-ralph/src/index.ts` | 初始 Conductor checkpoint 注册、可信子级工具 guard、workflow 到子级的组合，以及 Ralph 集成；在目标宿主中保留或替代这些通用扩展点。 |
| [#6](https://github.com/Biyocon/biyocon-harness/pull/6) | `packages/sandbox/sandbox/src/classification.ts`; `packages/sandbox/sandbox/src/index.ts`; `packages/sandbox/sandbox-local/src/index.ts`; `packages/sandbox/sandbox-local/src/profiles.ts`; `packages/shell/bash-sandbox/src/helpers.ts`; `packages/shell/bash-sandbox/src/index.ts`; `packages/shell/pwsh-sandbox/src/helpers.ts`; `packages/shell/pwsh-sandbox/src/index.ts`; `packages/terminal/terminal-bash/src/index.ts`; `packages/subagent/subagent/src/index.ts`; `packages/subagent/subagent/src/types.ts`; `packages/subagent/subagent/src/out-of-process.ts`; `packages/subagent/subagent-acp/src/index.ts`; `packages/subagent/subagent-fork-in-process/src/index.ts`; `packages/subagent/subagent-in-process-driver/src/index.ts`; `packages/subagent/subagent-spawn-in-process/src/index.ts`; `packages/workflow/workflow/src/runtime-types.ts`; `packages/workflow/workflow-worker-thread/src/host.ts`; `packages/workflow/workflow-worker-thread/src/index.ts`; `packages/workflow/tool-ralph/src/index.ts` | 通用质量命令约束、网络/文件强制执行报告、子级与 workflow 能力传递；移植前核对目标宿主沙箱语义。 |
| [#45](https://github.com/Biyocon/biyocon-harness/pull/45) | `packages/core/session/src/known-event-types.ts`; `packages/client/ui-subagent/src/client/index.ts`; `packages/client/ui-subagent/src/client/SubagentCatalogAction.tsx`; `packages/workflow/tool-ralph/src/index.ts` | 注册 `conductor/child`；独立 Conductor UI 插件使用的通用子级目录呈现插槽；Ralph 观察者生命周期。事件注册具有 Conductor 特性，注册表支持插件所有权后应移出核心。 |
| [#53](https://github.com/Biyocon/biyocon-harness/pull/53) | `packages/core/session/src/known-event-types.ts` | 注册 `conductor/owner-response-acknowledged`；另一项须通过通用注册机制移出的 Conductor 特定核心登记。 |
| [#54](https://github.com/Biyocon/biyocon-harness/pull/54) | `packages/interaction/user-questions/src/index.ts`; `packages/interaction/user-questions/src/types.ts`; `packages/host/apiproxy/src/api-proxy.ts`; `packages/host/apiproxy/src/api/events.schema.ts`; `packages/host/apiproxy/src/api/questions.schema.ts`; `packages/host/apiproxy/src/question-requests.ts`; `packages/client/ui-user-questions/src/client/ConductorOwnerPanel.tsx`; `packages/client/ui-user-questions/src/client/ConductorOwnerPanel.module.css`; `packages/client/ui-user-questions/src/client/ConductorOwnerReceipt.tsx`; `packages/client/ui-user-questions/src/client/QuestionComposer.tsx`; `packages/client/ui-user-questions/src/client/QuestionTakeover.tsx`; `packages/client/ui-user-questions/src/client/conductor-owner-history.ts`; `packages/client/ui-user-questions/src/client/contract/slots.ts`; `packages/client/ui-user-questions/src/client/index.ts`; `packages/client/ui-user-questions/src/client/locales.ts`; `packages/core/session/src/known-event-types.ts` | 类型化所有者意图/回答、持久接受及 RPC 验证、所有者面板/回执与事件注册。这是最大的领域专用宿主/UI 耦合；把 UI 移到独立插件，仅保留通用提问扩展点。 |
| [#64](https://github.com/Biyocon/biyocon-harness/pull/64) | `packages/core/agent-loop/src/agent.ts`; `packages/core/agent-loop/src/index.ts`; `packages/core/agent-loop/src/tool-calls.ts`; `packages/core/agent/src/index.ts`; `packages/llm/llm/src/index.ts`; `packages/llm/llm/src/types.ts`; `packages/llm/llm-deepseek/src/adapter.ts`; `packages/subagent/subagent/src/index.ts`; `packages/subagent/subagent/src/types.ts`; `packages/subagent/subagent-fork-in-process/src/index.ts`; `packages/subagent/subagent-in-process-driver/src/index.ts`; `packages/subagent/subagent-spawn-in-process/src/index.ts`; `packages/workflow/workflow/src/runtime-types.ts`; `packages/workflow/workflow-worker-thread/src/host.ts`; `packages/workflow/workflow-worker-thread/src/index.ts` | 通用 `reservedSessionId`、含 reasoning 的累计 `maxOutputTokens`、provider 能力检查、逐次循环限制、DeepSeek 路由保证、workflow 子级提示与 token 上限。批评者身份与预算依赖这些能力；不得为了保留功能而令核心导入 Conductor。参见[原决策](../../implemented/architecture/2026-11-02-reserved-child-identity-and-output-token-limit.md). |
| [#71](https://github.com/Biyocon/biyocon-harness/pull/71) | `packages/interaction/user-questions/src/types.ts`; `packages/client/ui-user-questions/src/client/ConductorOwnerPanel.tsx` | v5 批评者运行的所有者继续元数据和面板呈现；遵循 #54 的移植分界。 |
| Planned [#75 phase 1](2026-11-05-conductor-analysis-claim-verification.md) | `packages/core/system-prompt/src/index.ts`; `packages/core/tools/src/index.ts`; `packages/web/tool-web/src/search.ts` (proposed locations) | 通用的类型化 `PromptSection.requiresTools` 与有效工具名称视图，网页指导关联真实能力。尚无代码交付；本清单合并及所有者另行下达任务后，才以独立 PR 实施。 |

历史上的 `packages/extensions/tool-cordis/src/api-catalog.ts`、`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` 和 `packages/core/session/src/known-event-types.ts` 容易混淆：前两者是生成的投影，session 文件则直接登记 Conductor 事件名称。#64 的通用实现规模较大，但批评者依赖其身份与预算保证，因此仍属依赖；语义以其 Agent Note 为准。现有 `ui-user-questions` 中的所有者 UI 并非独立的 Conductor UI 插件；移植应搬走领域呈现，而非把耦合复制到新宿主。

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
| `apps/web/tests/conductor-owner.e2e.ts`; `apps/web/tests/conductor-critic.e2e.ts`; `apps/web/tsconfig.json` | 导入 Conductor 类型与 adapter，并纳入浏览器场景。 | 将 Conductor 专属浏览器测试及 TypeScript 纳入项移到插件集成测试。 |
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
