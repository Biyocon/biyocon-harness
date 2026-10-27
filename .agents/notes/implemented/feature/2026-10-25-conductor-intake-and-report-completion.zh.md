# Agent Note: Conductor intake admission and read-only report completion

Status: implemented

[English](2026-10-25-conductor-intake-and-report-completion.md) | 中文

## 问题

[Issue #30](https://github.com/Biyocon/biyocon-harness/issues/30)要求根据已提供的工作选择入口，并为分析和问题提供仅报告的完成方式。复核已有计划不能重复发现与规划；普通回答不能要求实现权限。从模糊任务开始的建议仍需要 Strategist 的规划评估。

## 决策

现有 Conductor 模型在强制的第一个 `conductor` 调用中提出 intake；[运行时准入](../../../../packages/conductor/conductor/src/intake.ts)验证提案并推导路线。没有 intake 专家、通用指令加载器修改或新增权限渠道。第一阶段仅支持 `purpose: implementation | analysis` 和 `detective | strategist | devils-advocate` 入口。分析必须指定 `deliverable: answer | recommendations`；实现拒绝 deliverable。缺失字段、禁止的入口和不支持的组合在创建运行前失败。

### 捕获的材料

运行时捕获实际当前用户消息，将 `current-request` 绑定到父 Session/事件来源，并生成 branded 材料 ID。模型提取的范围和计划引用只能解析到这些捕获 ID。当前消息显式引用的工作区相对文本文件通过现有文件系统服务解析；读取前后检查包含关系、稳定身份和版本，按 UTF-8 解码并保存完整内容及 SHA-256。未引用路径、不可访问或被替换文件、符号链接逃逸和不支持的二进制/附件输入明确失败。不递归盘点，也不获取网络材料。

[工具](../../../../packages/conductor/tool-conductor/README.md)验证文件数量、单个输入字节及序列化准入大小的部署限制，从不截断材料。捕获输入与初始跳过历史在第一个子级前持久化；后续分派和恢复使用存储内容。修改 purpose、entry、deliverable 或所提供输入需要新运行。引用文件的哈希仅标识那些输入，并不标识完整工作区或未提交的实现候选。

Detective 接受不确定的当前请求。较晚入口要求捕获的范围来源、非空范围和验收标准；C 还要求计划来源。实现从较晚入口开始时还须明确提供源 baseline；若缺失，运行时在分派前返工至 Detective。捕获输入的哈希绝不替代已评估的源状态；分析不要求源 baseline。缺失前提在分派前产生计入预算的 `origin: intake-validation` 返工，返回 A 或 B，不虚构专家。第一个专家评估语义充分性；代码不声称能证明文字或模型结论的质量。

### 验证后的路线

| 目的 | 入口 | 交付物 | 专家路径 |
|---|---|---|---|
| implementation | A/B/C | 不提供 | 所选入口 → 剩余实现阶段，经 C → D → E → F → G。 |
| analysis | A | answer | Detective → Auditor → Arbiter。 |
| analysis | A | recommendations | Detective → Strategist → Auditor → Arbiter。 |
| analysis | B | answer/recommendations | Strategist → Auditor → Arbiter。 |
| analysis | C | answer/recommendations | Devil's Advocate → Auditor → Arbiter。 |

从 Detective 开始的建议保留 A 的范围评估，并由 Strategist 生成报告。其他分析组合使用准入的 A/B/C 生产者。分析 C 审查报告，绝不审查执行 baseline。实现 C 仍须获得宿主对当前 baseline 和效果的精确批准，之后 Headsman、Ralph 或 Integrator 才能运行；已提供工作不能替代批准。

绕过的 gate 具有 `kind: skipped`、决策 `skipped`、supplied-work 或 profile-not-applicable 原因、purpose/deliverable、完整路线、理由、捕获材料引用及因果后继。它们不算已评估的通过或批准。只记录实际到达的绕过；后续返工可以评估此前跳过的 gate，而不改写历史。

因果返工返回保留 C → B → C 及嵌套 C → B → A → B → C。报告缺陷返回报告生产者；Arbiter 要求修改后，还必须经过新的 Auditor 才能再次裁决。[逐 gate 预算](../bug-fix/2026-10-25-conductor-gate-robustness.md)保持独立：预设允许每个决策 gate 返工两次，随后升级。准入修复、格式无效报告和修改消耗该 gate 的预算；跳过与恢复不重置预算。Ralph 独立的轮数限制不变。

### 报告完成与效果

生产者提供版本化 `ReportCandidate`，包含 deliverable、完整报告、精确验收标准评估、捕获材料引用、假设和限制。建议内容包含优先顺序与理由。运行时计算候选哈希；Auditor 在全新会话审查该精确版本和来源。另一个全新的 Arbiter 会话返回 `accept | revise | blocked`，绑定候选及成功审计哈希。修改产生新候选版本和新审计；旧哈希被拒绝。

接受产生 `kind: report`、终态 `reported` 和 `currentStage: report-complete`，既不是 GO，也不批准发布或实现。有依据的负面发现和静态分析限制保留在报告中。reported 运行不能恢复、closeout 或变成实现运行。实施建议需要新 implementation 运行及真正的执行 C 批准。

所有分析检查点保持 baseline/authorization 为 null、质量执行记录为空。[类型化分派](../../../../packages/conductor/tool-conductor/src/index.ts)、公布的工具允许列表和执行器守卫仅允许读取/搜索及结构化交接；排除写入/编辑、shell、质量执行、批准和外部操作。前向路线、返工与恢复不能到达 Headsman、Ralph 或 Integrator。从不调用批准服务。宿主 Session 日志与项目写入分离。[父级路由策略](../bug-fix/2026-10-25-conductor-mode-routing.md)仍在任何结果后禁止父级工具及重新分派，包括 reported，直到收到新用户输入。

规范[角色](../../../conductor/README.md)及[专家协议](../../../skills/conductor-specialist/SKILL.md)拥有按 purpose 区分的指令；名称和职责分配不变。安装副本由现有 build generator 生成，没有 #25 的新 source-launch 自动生成。实现保留现有报告 envelope、质量策略和 GO/NO-GO closeout 要求。

### 持久化

记录格式 3 保存不可变准入、捕获内容/来源、已评估/跳过 gate、待处理返工返回、报告版本、审计及最终报告裁决。解析器重放准入的因果路线，检查材料/候选/审计哈希、引用、逐 gate 次数、终态以及不兼容的执行字段。旧格式包括 #27 的版本 2 均明确拒绝，没有迁移或兼容别名。准入和每次转换均在后续分派前保存检查点。现有 `conductor/checkpoint` 仍携带不透明运行 JSON；没有新 Session 事件或 SDK 生命周期变体。

## 考虑过的替代方案

**A：Conductor 提议，代码准入。** 所有者选择此方案。重用现有上下文和强制路由，不增加分类器、协议或权限渠道。确定性输入检查与后续专家评估保持分离。

**B：单独的 intake 专家。** 被拒绝，因为它增加固定模型延迟、成本及持久状态，仍需相同代码验证，并不能独立证明语义正确性。

**修订 R1：生产者 → Auditor → Arbiter；Detective 建议另需 Strategist。** 所有者选择此方案。问题使用较短的只读路线，建议保留规划，已有计划避免重复发现。

**R2：所选入口经过所有剩余只读 A/B/C 阶段后再审计。** 被拒绝，因为简单回答与已有计划会重复规划。仅以提示词省略 C 批准也被拒绝：reported 是有强制只读效果的独立类型结果。

## 影响

捕获输入增加有界的 Session 日志体积，并可能包含敏感项目文本；现有文件系统权限及日志政策继续适用。全新角色只代表上下文分离，不代表不同模型或人工审查。有效引用和 keyless 测试不证明提供方的语义质量，也不认证未检查文件。

准入、报告验证及持久化篡改测试覆盖支持的组合、缺失材料、旧报告、因果修复/恢复、独立预算及禁止效果。[安装预设快照](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts)在具有矛盾 AGENTS.md 的外部工作区使用真实 Loader，仅替换模型，并验证实际第一个工具、专家路线、项目文件不变、无批准、父级拒绝以及 reported 或 blocked 结果。现有实现/质量快照保留宿主批准路线。Fixtures 在 Linux/WSL 录制；SDK 通用投影另行验证。

第二阶段仍未实现：Auditor 入口、`verification`、dirty 候选 digest 和非 Git manifest 需要 F02 及单独批准。附件、隐式会话检索、远程文档、source-launch 自动生成（#25）、UI 元数据（#28）及补充专家/提供方/文档处理不属于第一阶段。因此 #30 保持打开。Runtime、质量执行器、安装 skills、路由和 gate 稳健性决策保留各自独立保证，没有任何一篇被完全替代或归档。
