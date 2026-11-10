# Agent Note: 对 API proxy 执行完整覆盖率门禁

Status: implemented

[English](2026-11-10-api-proxy-coverage.md) | 中文

## Problem

API proxy 的整文件豁免使完整覆盖率门禁无法发现现有 RPC 路由及生命周期分支缺少测试。[Issue #55](https://github.com/Biyocon/biyocon-harness/issues/55) 要求在有意义的覆盖率达到仓库常规逐文件阈值后移除该豁免。

## Decision

[API proxy](../../../../packages/host/apiproxy/src/api-proxy.ts) 纳入常规的 100% statements、branches、functions 和 lines 门禁。当行为由服务持有时，测试通过真实的 Session、Inbox、Goal、Workspace 和存储域服务调用其公开 RPC 方法。外部 provider 失败及原生应用打开器使用可控替身。Fixture 全部为合成数据，不包含所有者会话、凭据或私人资料。

覆盖范围包括持久图片引用授权、取消及 replay 截面、准确的会话所有权、provider 元数据、成功及失败的变更、请求排序，以及 Host 帧生命周期。负面用例通过实际执行器或事件消费方运行。[预设切换队列修复](../bug-fix/2026-11-10-preset-switch-queue-settlement.md) 纠正了本次工作发现的对象身份比较错误。

搜索保留可见性快照和 provider await 之后的取消检查，以及调整 provider 失败之前的检查。移除每轮入口的重复检查：其间的 cursor 及结果处理均为同步操作，在下一次 provider await 之前不产生调度点。现有取消优先级及有界分页测试继续生效。

## Alternatives considered

**保留豁免或降低阈值。** 拒绝，因为两者都会允许未来的 RPC 行为缺少测试。

**增加 ignore 或操纵 signal getter 来命中重复检查。** 拒绝，因为测试必须覆盖实际调度及公开行为。

**直接对所有者桌面运行原生打开器。** 拒绝：gateway 测试使用可控打开器替身证明委托；平台适配器行为由打开器包持有。

## Consequences

API 新增的未覆盖路径会令完整门禁失败。不增加 ignore、skip、重试或超时延长。逐文件覆盖率补充组装后的 keyless 浏览器场景，但不证明所有交错或真实 provider 行为。问题编辑器的独立覆盖率决策[另有记录](2026-11-10-generic-question-composer-coverage.md)。
