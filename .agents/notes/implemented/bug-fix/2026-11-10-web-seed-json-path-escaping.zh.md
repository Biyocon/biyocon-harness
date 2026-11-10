# Agent Note: 浏览器种子路径的 JSON 转义

Status: implemented

中文 | [English](2026-11-10-web-seed-json-path-escaping.md)

## Problem

[#66](https://github.com/Biyocon/biyocon-harness/issues/66)指出浏览器 JSONL fixture 直接替换 Windows 路径的问题。反斜杠与引号可能在浏览器启动之前破坏会话头。使用解码后的 cwd 替换序列化文本也可能遗漏已转义的路径。

## Decision

[种子处理函数](../../../../apps/web/tests/scaffold.ts)将替换路径与会话 ID 编码为 JSON 字符串内容；替换已录制 cwd 时，也先编码查找值。会话头与事件文本因此使用相同工作目录，重复处理保持文本不变。格式错误的会话头 JSON 仍明确失败。[浏览器测试决策](../testing/2026-07-24-web-gui-browser-e2e-lane.md)继续有效；本次变更只修复种子替换，不改变浏览器归一化或运行时路径处理。

## Alternatives considered

**只转义 cwd 占位符。** 后续路径替换仍会用解码路径匹配 JSON 转义文本，可能使事件保留错误的源路径。

**修改 golden 或延长测试超时。** 两者都无法修复无效的 fixture JSON 或错误的源标识。

## Consequences

[回归测试](../../../../apps/web/tests/seed-fixture.spec.ts)使用 Windows、UNC 与 POSIX 路径处理已提交的 seeded-history fixture，验证已转义录制路径、含引号的 ID 和格式错误会话头的拒绝行为。测试使用合成路径，不使用所有者会话数据。现有浏览器 golden 的含义保持不变。
