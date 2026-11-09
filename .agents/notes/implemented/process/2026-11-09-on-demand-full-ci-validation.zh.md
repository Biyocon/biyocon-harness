# Agent Note: 按需执行完整 CI 验证

Status: implemented

中文 | [English](2026-11-09-on-demand-full-ci-validation.md)

## Problem

CI 工作流只在拉取请求上运行完整测试矩阵。推送到 Biyocon fork 的 master 时，PR 作业和仅限非 fork 的备用作业会跳过，因此工作流显示成功并不表示精确的合并提交已通过验证。分别通过检查的 PR head 没有执行合并后的代码树。本地全套测试也不能替代托管 Linux 和原生 Windows 的结果。

## Decision

现有 `workflow_dispatch` 增加 `full-validation` 选项。它在所选 ref 上运行与拉取请求相同的静态检查、覆盖率、消费者、Node 兼容性、Python、Wine 和原生 Windows 作业。现有 `all checks passed` 作业保留 PR 所需依赖；独立的手动验证结论还要求原生 Windows 成功。静态归档检查在 PR 上使用基础提交，在手动运行时使用所选提交的第一父提交；没有父提交则拒绝。没有可信的 PR head 时，运行器选择保持在 GitHub 托管资源池。

Master 推送仍只运行轻量作业。验证合并后的 head 时，执行 `gh workflow run CI --repo Biyocon/biyocon-harness --ref master -f suite=full-validation`，接受结果前核对运行的 head SHA 与目标 master SHA。现有工作流级并发规则可能在手动派发时取消同一 ref 上正在运行的任务；[CI 故障转移手册](2026-07-26-ci-failover-runbook.md)记录了该限制。

## Alternatives considered

**每次 master 推送自动运行完整矩阵。** 这增加持续的托管运行器成本，并改变对不可取消推送任务数量的测试约束。手动选项在需要时提供精确提交的证据，同时保持推送行为不变。

**把 PR head 检查或本地测试视为合并提交检查。** 两者都没有在托管矩阵上执行精确的合并代码树，因此不能支持该结论。

## Consequences

取得完整的合并 head 证据需要显式派发并核对 head SHA。所需 PR 矩阵或原生 Windows 只要失败、取消或跳过，手动验证结论就失败。普通 master 推送的 CI 成功仍只是轻量信号，不得称为完整验证。
