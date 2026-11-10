# Agent Note: 释放准确的已完成预设切换队列项

Status: implemented

[English](2026-11-10-preset-switch-queue-settlement.md) | 中文

## Problem

API 会为每个空白会话串行处理预设选择。队列保存的是已处理拒绝的 promise，完成时却拿原始 promise 与该队列项比较。这两个对象不同，因此会话队列项永远无法释放。

## Decision

[预设选择](../../../../packages/host/apiproxy/src/api-proxy.ts) 为放入队列的、已处理拒绝的准确 promise 命名，并在清理时比较同一个对象。已完成的请求只释放自己的队列项。若后续选择已替换该项，较早请求会保留它。保留的 promise 仍会收容意外的 provider 拒绝，使后续请求能够继续执行。

## Alternatives considered

**与原始请求 promise 比较。** 拒绝，因为 `catch()` 会创建另一个 promise；对象身份比较不可能成功。

**无条件删除会话队列项。** 拒绝，因为较早请求可能删除后续选择的串行化所有者，导致重组操作重叠。

## Consequences

已完成的选择不再无限保留队列项。两个待处理选择保留顺序、会话及 agent 身份，并只在重组成功后追加预设选择事件。已开始的会话仍被锁定。单元证据覆盖并发选择、类型化挂载拒绝、意外且无法转为字符串的 provider 拒绝，以及之后成功的选择。不改变 wire、record、模型输入或可见文案。本修复是在为 [#55](https://github.com/Biyocon/biyocon-harness/issues/55) 测试 API proxy 时发现的；覆盖率政策变更与队列的所有权规则是不同事项。
