# Agent Note: 观察已完成的 ACP 轮次，而不采样其打开状态

Status: implemented

[English](2026-10-27-acp-completed-turn-observation.md) | 中文

## Problem

后台结算和 goal wrap-up 可能在快照 harness 的两次文件系统轮询之间完成父级轮次。先等待打开的 `turn/start` 再等待 `turn/end` 会漏掉该已完成轮次；即使持久日志包含两条记录，仍会报超时。若只等待任意已关闭轮次，则可能接受更早的启动轮次，并在后台工作完成前销毁应用。

## Decision

[ACP harness](../../../../packages/test-support/acp-snapshot/src/harness.ts) 在 `waitForTurnEnd` 上接受 `minimumTurn`。选定会话必须包含该编号的 `turn/end`，且其最新完整轮次边界必须已关闭。轮次完成后，已完成的证据仍然有效。取消就绪检查保留 `waitForTurnStart` 对打开轮次的要求。

四个后台 subagent 场景和 goal-wrapup 直接等待父级轮次 2 完成。[结算栅栏](../feature/2026-08-06-manager-owned-subagent-settlement-delivery.md)仍保证后台投递会开启独立父级轮次。默认超时、轮询间隔、运行时调度、会话记录和预期输出比较保持不变。

## Alternatives considered

更长超时和重复测试无法恢复已关闭的打开轮次。在取消等待器中接受任意历史启动记录，会允许在目标轮次完成后才取消。保留启动／结束等待对仍存在竞态；等待无编号的结束记录则可能把轮次 1 当作所需的后台完成。

## Consequences

快照脚本表达持久化完成，而不依赖观察瞬态。所需轮次缺失或仍打开时仍会失败。该改动只影响测试编排；模型可见输入、产品行为、SDK 输出和规范化规则均不改变。

## Verification

确定性的子进程回归提供已关闭的轮次 2，复现打开轮次等待失败，并在改用编号完成等待后通过。负例拒绝已关闭的轮次 1 和仍打开的轮次 2。真实 `subagent-list-agents` 重放在首次观察延后 250 ms 时复现超时：捕获日志含有持续约 10 ms 的完整轮次 2。未修改的重复重放可能通过，因为缺陷取决于调度。聚焦的无密钥重放保留已提交的预期会话记录。
