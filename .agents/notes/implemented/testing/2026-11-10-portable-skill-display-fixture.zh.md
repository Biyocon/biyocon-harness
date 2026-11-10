# Agent Note: 种子 skill 展开中的可移植路径

Status: implemented

[English](2026-11-10-portable-skill-display-fixture.md) | 中文

## Problem

种子 skill 展开会渲染完整的录制工具结果。在 Windows 上，Playwright 对多行指令区域加引号时会转义原生路径中的反斜杠。未转义的工作区前缀无法匹配这种 ARIA 写法，因此即使 JSONL 实例化正确、可见指令没有变化，仍会出现 [#89](https://github.com/Biyocon/biyocon-harness/issues/89)。

## Decision

[场景](../../../../apps/web/tests/skill-tool-row.e2e.ts)分别实例化原生会话 header 和录制事件。显示路径仍指向同一工作区，但使用正斜杠；host 保留原生 cwd，用于所有权及持久化。两种写法指向同一个 Windows 目录。现有种子后端仍通过常规 API 验证并持久化日志。

浏览器将显示的完整指令字符串与种子工具结果比较，明确检查其 base directory，并在捕获现有 ARIA golden 时使用显示路径的写法。指令、usage 及共享 ACP 录制均保持不变。不修改产品路径处理或 snapshot normalizer。

## Alternatives considered

**全局归一化更多转义写法。** 对此场景拒绝：源 fixture 可以提供可移植的显示路径，无需扩大对无关 UI 文本的归一化。

**接受 Windows 专用 golden 或移除路径。** 拒绝，因为前者削弱跨平台一致性，后者停止检查指令结果的重要部分。

## Consequences

同一个 golden 在原生 Windows 和 Linux 上检查真实持久化会话及渲染后的展开内容。原生会话身份独立于 fixture 的显示路径写法。这是种子渲染测试，不声称执行了新的 skill 或实际读取文件系统。
