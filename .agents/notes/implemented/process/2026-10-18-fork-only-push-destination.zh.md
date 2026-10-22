# Agent Note: 仅允许向 fork 推送

Status: implemented

[English](2026-10-18-fork-only-push-destination.md) | 中文

## Problem

本仓库会从 `deepseek-ai/deepseek-harness` 引入变更，但所有 Biyocon 开发内容都必须保留在 `Biyocon/deepseek-harness`。远程命名和账户权限能降低误发布风险，却没有为远程重命名、直接 URL 推送或未来凭据变化提供版本化的本地规则。

## Decision

上游仓库是只读抓取源，Biyocon fork 是唯一推送目标。pre-push 验证器检查 Git 的远程位置，只识别显式的 GitHub HTTPS/SSH authority 或 GitHub SCP 语法，拒绝直接 URL 推送，并且只允许 `Biyocon/deepseek-harness`。它保留原始路径，而不采用可能与 Git 传输选择不同的浏览器 URL 修复规则。Lefthook 在 typecheck 前以管道顺序运行验证器，因此拒绝结果会阻止 typecheck 启动。

生成的钩子调用 `scripts/run-lefthook.mjs`。分发器将继承的 pre-push 传输值替换为以 JSON 编码的 Git 原始参数数组，然后不经 shell、仅以 `run pre-push` 启动 Lefthook。验证器的 script 作业使用固定参数并读取该载荷；远程名和位置都不会成为 shell 语法或 Lefthook 选项。其他钩子保留原有参数，但不携带该载荷。

上游变更通过 merge-forward 进入新的 Biyocon 集成分支。集成操作从精确的 Biyocon master 提交开始，记录上游提交，在解决冲突时保留 fork 功能，并且只有通过评审和单独授权的合并才能进入 Biyocon master。活跃功能分支 merge-forward 更新后的 Biyocon master，不改写历史。

## Alternatives considered

只依赖已禁用的 `origin` 推送 URL 无法防止重命名远程或直接 URL 推送。只依赖 GitHub 权限会让安全性取决于外部账户状态。重命名现有远程会破坏跟踪配置，却不会加强目标验证。rebase 或 GitHub 的 fork 同步操作会减少用于证明 fork 功能在上游引入后仍被保留的可评审证据。

## Consequences

解析到 Biyocon fork 的具名远程可使用允许的 HTTPS 与 SSH 形式。上游、其他仓库、含糊位置、直接 URL 推送和不完整的钩子调用会在本地失败。修改分发器配置后，运行 `node scripts/install-lefthook.mjs`，重新生成 worktree 所有的钩子。直接 Lefthook 调用（包括 `LEFTHOOK_BIN` 覆盖）在没有有效传输值时会失败；JSON 载荷不会验证其来源。本地覆盖的钩子、伪造载荷、`LEFTHOOK=0` 和 `--no-verify` 都能绕过检查，因此仓库政策和 GitHub 权限仍是必要的后备保护。允许列表会有意排除自托管镜像和非 GitHub 传输；新增目标需要经过评审的代码和政策变更。

## Verification

`scripts/verify-push-destination.spec.ts` 覆盖目标解析与实际安装钩子的作业顺序，包括恶意参数、缺失传输值、继承载荷及钩子重新生成。`scripts/run-lefthook.spec.ts` 覆盖进程参数、环境隔离、stdin 和失败传播。`scripts/install-lefthook.spec.ts` 覆盖隔离的 worktree 钩子和用户所有钩子路径的保留。typecheck、lint、文档同步和空白检查覆盖仓库集成。
