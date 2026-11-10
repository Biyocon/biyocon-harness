# Agent Note: 指令与 skill fixture 自有的项目根

Status: implemented

[English](2026-11-10-owned-instruction-fixture-roots.md) | 中文

## Problem

临时目录可能嵌套在真实项目中。未设置项目标记的指令及 skill 测试可能发现祖先目录的指令或 skill，而不是验证合成测试世界。[#93](https://github.com/Biyocon/biyocon-harness/issues/93) 中七个本地失败源于这一假设；仅替换默认 home 无法限制项目发现。

## Decision

[指令测试](../../../../packages/context/agent-instructions/tests/agent-instructions.spec.ts)在验证 home 选择、标签及不可用 home 候选时，为自有项目根设置标记。cwd 回退用例通过受支持的空标记列表显式禁用标记发现，并在 cwd 上方放置包含指令且带标记的父目录。保留对选中文件及显示路径的精确断言。

[skill 测试](../../../../packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts)分别验证优先级及无标记回退。优先级使用自有 Git 根；回退挂载现有文件系统测试 provider，在虚拟祖先链中将标记元数据设为不存在。Skill 内容仍来自真实合成文件，而 host 的祖先标记无法重定向发现。断言完成后释放 provider。

## Alternatives considered

**修改产品发现或接受额外指令。** 拒绝：发现最近项目是预期行为，所有者数据不能成为 fixture 的预期内容。

**假设系统临时目录没有带标记的祖先。** 拒绝，因为开发机器可以将临时目录合法地放在项目之下。

## Consequences

保留测试断言及生产配置。不修改运行时代码、snapshot、normalizer、超时、重试或 skip。继续覆盖准确的 home 标签、根优先级及基于 provider 的 cwd 回退。依赖区域设置的标识符排序属于 #93 的另一项决策。
