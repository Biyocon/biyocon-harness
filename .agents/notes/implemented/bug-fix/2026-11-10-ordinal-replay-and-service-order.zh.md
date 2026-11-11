# Agent Note: 不依赖区域设置的回放及服务名称顺序

Status: implemented

[English](2026-11-10-ordinal-replay-and-service-order.md) | 中文

## Problem

默认 `localeCompare` 使用 host 的排序规则。丹麦语对 `aa` 序列的处理不同于英语，导致 [#93](https://github.com/Biyocon/biyocon-harness/issues/93) 中合成会话 ID 及泄漏服务名称的预期顺序反转。区域设置不同的录制及回放 host 可能对同一时间的子会话顺序产生分歧。

## Decision

[ACP 收集](../../../../packages/test-support/acp-snapshot/src/harness.ts)及[回放加载](../../../../packages/test-support/llm-replay/src/index.ts)保留主会话及创建时间规则，并按 UTF-16 代码单元顺序比较时间相同的会话 ID。[Preset 拒绝](../../../../packages/preset/agent-presets/src/mount.ts)对泄漏服务名称使用相同的序数顺序。这些是技术身份，不是自然语言标签。其他依赖语言的展示不受影响。

这明确了[逐会话 snapshot 回放](../testing/2026-06-22-subagent-snapshot-replay.md)中的 ID 平局规则，不改变脚本派生、持久事件或 fixture 格式。Header 排序不能建立首次调用的因果关系：并发子会话录制仍需要其中指出的独立 ordinal 设计。

组合后的 keyless 验证也需要自有指令根。ACP harness 在复制 fixture 文件后、自定义准备或 agent 启动前创建工作区本地 `.git` 标记，并保留已有标记。空标记并不构成 Git 仓库，并会出现在显式目录列表中。这防止真实回放示例通过祖先项目继承开发者指令；继承 snapshot 在启动 agent 前断言标记存在。

## Alternatives considered

**固定使用英语排序。** 拒绝，因为技术身份无需语言相关的大小写及标点规则；序数比较不依赖 ICU 排序数据。

**为丹麦语修改预期输出。** 拒绝，因为这会保留依赖 host 的录制/回放分配及不一致诊断。

**修改机器区域设置。** 拒绝：受支持的开发者区域设置不应要求修改全局设置。

## Consequences

英语及丹麦语默认排序用例验证真实 preset guard、持久 ACP 收集及回放 loader。测试替身仅改变默认排序，并保留显式请求的 locale；每个用例结束后恢复原生方法。同一批子会话 ID 及诊断名称在两种 host 上保持相同顺序。不引入凭据、私人日志、Conductor 依赖、record 版本变化或 GUI 变化。
