# Agent Note: Biyocon fork 标识与 checkout 位置

Status: implemented

[English](2026-10-24-biyocon-harness-repository-name.md) | 中文

## Problem

重命名 fork 会改变本地推送守卫允许的仓库标识。移动 Windows checkout 还会让绝对依赖链接、生成的钩子路径、工作区注册和快捷方式失效。GitHub 重定向不会修复这些本地引用，也不能在已配置的钩子路径不存在时保留守卫保护。

## Decision

版本化推送允许列表选择 `Biyocon/biyocon-harness`，本地启动器示例使用 `C:\Users\Biyocon\biyocon-harness`。远程别名仍为 `biyocon`；`deepseek-ai/deepseek-harness` 仍是只读抓取源。包名、`dsh`、`.dsh`、产品术语、已归档记录和 Conductor 执行日志不在本次命名变更范围内。

发布此策略前，必须先完成 GitHub 仓库重命名并更新具名远程的 URL。验证器检查字面目标，不跟随重定向，因此会拒绝原 fork 标识。本地准备和提交不会重命名远程仓库或 checkout；这些操作需要所有者另行执行。

只有在源码变更合并、本地 master 完成 fast-forward 且 Codex 与应用已停止后，才能移动 checkout。在目标位置安装依赖并运行 `node scripts/install-lefthook.mjs`，可恢复 checkout 本地链接及其所有的钩子。移动后 checkout 的 `core.hooksPath` 必须指向其自身的 `.git/dsh-hooks`；工作区注册和快捷方式必须引用新位置。绕过钩子不是迁移方法。

[仅允许向 fork 推送的决策](2026-10-18-fork-only-push-destination.md)保持活跃，因为其中关于传输、凭据隐藏、分发器和上游集成的依据仍有独立价值。本决策只替换其中具体的 fork 标识。

## Alternatives considered

**同时允许两个名称或依赖重定向。** 重定向不会改变传给本地守卫的目标字符串。同时允许两个标识会保留已废弃的发布目标，而不是强制使用选定仓库。

**重命名整个产品。** 包标识、运行时命令、主目录和上游引用有各自的使用方与含义。标识 Biyocon fork 和 Windows checkout 不需要重命名这些内容。

## Consequences

准备好的分支不能向原 fork URL 发布。仓库与 checkout 迁移仍是执行时机不同的显式操作；本地提交成功不能证明任一迁移已完成。当现有链接依赖旧仓库名的重定向时，不得将该名称用于另一个 GitHub 仓库。

## Verification

目标 spec 覆盖允许的 HTTPS/SSH 形式，并通过验证器和实际安装的钩子证明原 fork 会在 typecheck 前被拒绝。分发器与钩子安装器测试保留参数隔离和 worktree 本地路径检查。无密钥的翻译提示词快照通过其可运行场景刷新，因为其中嵌入了开发指南。文档配对、doc-sync、lint 和 typecheck 覆盖其余集成。
