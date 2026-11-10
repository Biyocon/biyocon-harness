# Agent Note: 浏览器 preset 指令隔离

Status: implemented

中文 | [English](2026-11-10-web-preset-instruction-isolation.md)

## Problem

[#80](https://github.com/Biyocon/biyocon-harness/issues/80)记录了原生 Windows steering golden 中额外出现的祖先目录指令。禁用部署层指令项不会禁用交付的 standard preset 单独挂载的加载器。若不存在更近的项目标记，该加载器会发现祖先项目，并将其指令注入回放请求。

## Decision

[浏览器 scaffold](../../../../apps/web/tests/scaffold.ts)在组合启动前，在其持有的临时工作区中创建 `.git` 项目根标记。[英语/丹麦语选择器 helper](../../../../apps/web/tests/support.ts)也标记每个创建的工作区，使项目 skill 从所选工作区而非外层 scaffold 目录解析。preset 的现有指令加载器继续运行，在任何祖先项目之前找到本地标记。其全局目录已限制为 scaffold 的合成 `DSH_HOME`。工作区内部的合成项目指令仍可使用，包括子目录。该标记不是已初始化的 Git 仓库，也不授予额外工具权限。

[浏览器测试说明](../testing/2026-07-24-web-gui-browser-e2e-lane.md)保留组合与回放决策，只更新指令隔离描述。产品指令发现、源文本归一化和已提交的浏览器 golden 均保持不变。

## Alternatives considered

**只禁用主机指令项。** preset 在该覆盖层之外独立挂载，其模型可见上下文仍不受控。

**为回放复制并改写交付的 preset。** 这增加了另一套需要维护的组合，并可能掩盖产品集成缺陷。项目根标记直接使用交付加载器的现有发现机制。

## Consequences

组合回归测试在带有 `.git` 与 `AGENTS.md` 的合成祖先目录下执行真实回放模型轮次。它拒绝祖先标记文本进入日志上下文，同时要求工作区标记文本存在，证明隔离并未关闭真实 preset 加载器。scaffold 关闭后恢复临时目录环境变量。fixture 和提交日志不包含私有指令内容或所有者会话。需要 Git 操作的场景必须在自有工作区内初始化真实仓库。
