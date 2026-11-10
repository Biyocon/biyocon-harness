# Agent Note: 子代理身份延后到达时刷新目录成员

Status: implemented

[English](2026-11-10-late-subagent-catalog-membership.md) | 中文

## Problem

Host 可能在追加 descriptor 之前就公布子会话。子会话枚举器会有意省略没有自身 descriptor 的会话。因此，即使子代理已在运行，由较早公布事件触发的浏览器目录仍可能一直为空：此前，后到的身份投影只更新会话投影值。

## Decision

通用 [SessionManager](../../../../packages/client/runtime/src/client/sessions/manager.ts) 收到已知直属子会话的 `subagent` 投影时，若其父会话当前被选中或目录已展开，就安排现有的防抖目录刷新。会话从属关系来自 Host 摘要；客户端既不折叠 descriptor 事件，也不解释 Conductor record。变更发生在请求进行期间时，保留现有的完成后再次刷新行为。未知会话、普通 fork、无父会话的会话，以及未选中且关闭的目录均不引发请求。若投影早于会话公布，现有的 Host 会话监听器仍负责刷新。

[critic 浏览器场景](../../../../apps/web/tests/conductor-critic.e2e.ts) 在比较现有 golden 之前，等待待处理的 critic 行，以及适用时已完成的 Arbiter 行。Host checkpoint 本身不能证明浏览器已收到对应的子会话投影。超时和 golden 均不改变。

## Alternatives considered

**延长等待或重试整个场景。** 两者都不会触发陈旧目录的刷新。确定性的单元回归测试无需计时或模型，即可重现缺失的延后身份刷新。

**Conductor 专用客户端事件。** 拒绝，因为使用 descriptor 的子代理共有这一创建窗口。运行时依赖通用子代理身份和权威 Host 从属关系，绝不依赖 Conductor。

**列出缺少 descriptor 的子会话。** 拒绝，因为普通 fork 和继承的 descriptor 不得成为获授权的子代理。

## Consequences

身份可用时，当前选中或已展开的目录会恢复，即使旧响应仍在进行中。Wire 协议和持久化 record 均不改变。Descriptor 公布时，浏览器可能多发出一次防抖目录请求；重复投影帧也可能请求刷新。单元测试覆盖选中／展开的父会话、应排除的接收者，以及进行中响应的竞态。组装后的 critic 场景保留待处理／完成状态和英丹双语证据，而不会接受缺少子会话的目录快照。
