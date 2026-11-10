# Agent Note: 可检查的子代理结束断言

Status: implemented

[English](2026-11-11-subagent-settlement-assertion.md) | 中文

## Problem

[#67](https://github.com/Biyocon/biyocon-harness/issues/67) 报告间歇性 activation 等待，其断言被 `PrettyFormatPluginError: cannot get property "$$typeof" without inject` 掩盖。Vitest formatter 遍历仍存活 Agent 的作用域 Cordis context。一个空闲的合成 Agent 即可重现格式化错误，与 coverage 或结束速度无关；这并不能解释子代理为何仍存活。

## Decision

[控制测试套件的结束等待](../../../../packages/subagent/tool-subagent-control/tests/tool-subagent-control.spec.ts) 对注册表结果的可选 ID 断言，不再对整个 Agent 断言。Agent 始终有 ID，因此不存在条件保持不变。失败检查保留实际身份，无需格式化作用域服务。五秒 timeout、轮询机制及 runtime 均不变。

回归测试创建真实、由注册表拥有的 Agent，并通过透传 spy 观察实际轮询回调。失败回调必须产生包含该 Agent ID 的 AssertionError。释放 handle 后，原等待正常结束；测试既不等待 timeout，也不替换等待实现。

## Alternatives considered

**修改 Cordis 或 formatter。** 拒绝，因为断言只需要身份，无需序列化作用域服务。

**仅断言布尔值。** 虽可安全格式化，但会丢失仍存活 Agent 的身份。

**延长截止时间。** 拒绝：额外等待无法修复错误渲染，还会掩盖未解决的 activation 问题。

## Consequences

诊断回归在修改前因 formatter 错误失败，修改后通过。既有结束测试仍使用真实注册表及持久化路径。此修改仅修正测试诊断，不解决 #67 的间歇性生命周期故障；该 issue 继续保持打开。无产品/模型输出、snapshot、持久格式或私人数据变化。
