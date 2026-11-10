# Agent Note: 对通用问题编辑器执行覆盖率门禁

Status: implemented

[English](2026-11-10-generic-question-composer-coverage.md) | 中文

## Problem

[Issue #55](https://github.com/Biyocon/biyocon-harness/issues/55) 跟踪通用问题编辑器及 API proxy 的覆盖率豁免。即使现有组件测试已覆盖大部分路径，豁免仍使完整门禁无法发现新增但未经测试的编辑行为。

## Decision

[通用问题编辑器](../../../../packages/client/ui-user-questions/src/client/QuestionComposer.tsx) 纳入常规的逐文件 100% statements、branches、functions 和 lines 门禁。测试验证：只有整批问题完成后，选项上的键盘操作才会提交；其他按键和未完成的批次不提交；取消操作出现非 Error 失败时显示错误并恢复交互。现有测试保留导航、草稿、本地化、IME 输入、类型化接管和传输证据。产品行为不变。

## Alternatives considered

**等 API proxy 覆盖率完成后再移除豁免。** 拒绝，因为两个文件职责独立，可以分别纳入门禁。

**忽略剩余分支或降低阈值。** 拒绝，因为普通用户操作和传输失败都能到达这些路径。

## Consequences

编辑器新增的未覆盖路径会令现有完整门禁失败。不增加 ignore 指令、skip、超时变更或重试。API proxy 的独立豁免不在本决策范围内；本变更并未完成 #55 的全部工作。
