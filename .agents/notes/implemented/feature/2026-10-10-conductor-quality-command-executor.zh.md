# Agent Note：Conductor quality-command executor

Status: implemented

[English](2026-10-10-conductor-quality-command-executor.md) | 中文

## 问题

Conductor runtime 刻意移除了所有专家的通用 shell 访问，但 Headsman 和 Ralph 指令要求执行实现检查，Gate E 也要求 Auditor 独立验证。当前专家只能检查已有结果，无法通过 Conductor 重现已配置的测试、编译器、schema validator 或 generator。若增加普通 shell 工具，模型输出就能选择超出已批准 execution baseline 的可执行文件、参数和影响。

## 决策

`dsh-tool-conductor` 拥有默认空的部署 quality-command catalog。每个定义包含不透明 id、模型安全描述、精确 argv、允许的 Headsman 或 Auditor stage、规范化的 workspace 相对 cwd、可选 write root、sandbox mode、timeout、输出上限和终止宽限期。Shell interpreter 和无效路径关系会在插件加载时失败。Gate C 只选择 id；host 将其解析为不可变 definition hash，并把 catalog hash 记录在 execution baseline 中。选择命令还要求独立的 `quality-execute` execution permission。

spawn-in-process provider 增加可信的仅限 child 的 tool-contribution capability。Workflow 与 Ralph 把 callback 作为 host policy 传递，不会将其序列化给 worker program。Contribution 在普通 child composition 之后安装到尚未发布的 child scope，因此它既不是全局 tool-registry 条目，也不受针对继承工具的名称 allowlist 控制。Fork、ACP 和其他进程外 provider 不声明支持，并在启动 child 前失败。

注入的 `conductor_quality_check` 只接受 `{ command_id }`。它解析 Gate-C binding，不通过 shell 调用精确 argv，要求 sandbox backend 报告 full enforcement，并以有界方式收集输出且不创建 spill file。持久化的 `QualityExecutionRecord` 包含 identity、stage、gate、cycle、baseline 和 definition hash、时间、退出事实、outcome 以及 stdout/stderr digest，但不包含命令文本或输出正文。有界诊断可以返回当前专家，但不会进入 record。

Gate D 要求当前 cycle 中每个 Gate-D binding 都有全新且通过的 record。Ralph Round 与 Headsman 共用 record sink，可以生成该证据，但 Ralph 不拥有 gate。Gate E 启动全新 Auditor，并要求每个 Gate-E binding 都有该 Auditor 自己生成的全新通过 record；Headsman 或 Ralph 的证据不能满足该 gate。恢复运行时会拒绝 catalog 或 binding drift。

Sandbox policy 只覆盖文件系统影响。本设计不声称提供网络隔离，也绝不会授予 commit、push、merge、release、publish 或 deploy 权限。

## 已考虑的替代方案

- 拒绝向 Headsman 或 Auditor 授予通用 shell 工具，因为模型输出会选择未经审查的命令和参数。
- 拒绝让私有工具接受原始命令文本，因为这会绕过部署审查和不可变 Gate-C binding。
- 拒绝把先前的外部结果视为充分证据，因为 Gate D 和 Gate E 要求当前 baseline 的证据，且 Gate E 必须独立。
- 拒绝让 Ralph 或 Auditor 决定 gate，因为 Conductor 是 workflow state 和 gate decision 的唯一 owner。
- 拒绝允许 partial sandbox enforcement，因为 host 无法完全执行的文件 policy 必须 fail closed。

## 验证

- Catalog 校验并冻结精确 command definition，拒绝 shell interpreter、重复 id、无效路径、Auditor 写入和缺少 write root 的定义。
- 私有工具在执行命令前拒绝未知 id、额外输入字段、过期 binding、未授权 stage、缺少 execution permission 以及 partial 或 unavailable sandbox enforcement。
- 执行不通过 shell 使用精确 argv，应用已配置 cwd 和文件系统 policy，限制时间与收集输出，不留下 spill path，并分类 timeout、signal、runner、denial 和普通 exit failure。
- 持久化 record 只包含获准的执行事实与 digest；persistence 拒绝未知字段、跨 run 引用、hash drift、无效时间和未知 evidence 引用。
- Gate D 接受 Ralph 生成的全新通过 Headsman evidence；Gate E 要求不同的全新 Auditor run，不能复用 Gate-D evidence。
- Workflow、Ralph 和 subagent provider 预检可信 child-tool capability，不向模型或 worker-script input 暴露 callback。
- Conductor package 将根入口和 invariant companion 构建为自包含的发布入口，不依赖未声明的 runtime chunk。
- `pnpm exec vitest run examples/headless-agent/tests/headless.snapshot.ts -t "replays Conductor quality commands" --config vitest.snapshot.config.ts` 让无密钥 assembled application 从 Detective 运行到 Arbiter，在 Headsman 与 Auditor 下独立执行 binding，持久化全部八个 run checkpoint，并以 `awaiting_authorization` 结束。
- `pnpm run test -t conductor` 在 10 个文件中通过 82 个聚焦测试，覆盖 catalog 校验、模型边界升级、Ralph 命令交接、stage 独立性、持久化和 gate evidence 规则。
- `pnpm run typecheck`、`pnpm run lint`、`pnpm run doc-sync`、`pnpm run verify-cordis-config` 和 `pnpm run verify-built-package-invariants` 全部通过；doc-sync 报告 28 个 gate，config 校验报告 124 个文件，built-package 校验报告 222 个 companion。

## 后果

- 没有 fully enforcing sandbox backend 的 host 无法运行 quality command；这是有意的 fail-closed 可用性代价，尤其影响只有 partial enforcement 的 Windows 配置。
- 部署 catalog 是可执行的 host policy。错误定义仍可能运行非预期但已审查的 argv，因此部署审查仍然必要。
- workspace-write backend 可能需要在配置的产品 write root 之外创建 backend 自有临时文件来启动受限进程；这些文件不属于产品写入权限。
- 文件系统 confinement 不阻止网络访问。需要网络隔离的命令必须使用不同的执行环境或 capability provider。
