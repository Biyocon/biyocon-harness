# Agent Note: Conductor 入口准入与只读报告完成

Status: proposed

[English](2026-10-25-conductor-intake-and-report-completion.md) | 中文

## 问题

[Issue #30](https://github.com/Biyocon/biyocon-harness/issues/30)要求根据已提供的工作选择入口，并让分析和问答仅以报告完成。重新评估已有计划不应重复范围调查和规划。入口选择绝不能授权实现；要求建议的请求也应获得规划，而不只是澄清报告。

本次核查的 master 为 `7548dbd23f6a1f1563ea4ec2bb98bee627f5731d`，包含 [PR #29](https://github.com/Biyocon/biyocon-harness/pull/29)。其路由要求父级首次工具调用为 `conductor`，且每次返回结果后拒绝父级工具。[createRun](../../../../packages/conductor/conductor/src/state.ts)仍从 Detective 开始，[驱动器](../../../../packages/conductor/conductor/src/drive.ts)沿 A–G 运行并要求 Auditor 具有执行基线，[持久化](../../../../packages/conductor/conductor/src/persistence.ts)也验证此顺序。这些执行假设没有提供仅报告的完成路径。

## 提案

所有者选择下述方案 A 和修订后的 R1。生命周期仍为 proposed：这些是设计决策，并非已交付 API，也不授予实现权限。本 PR 只包含此 EN/ZH/一致性记录三件套；不修改运行时、角色、预设、示例、SDK 或现有决策记录。

### 所有者决策与分期

第一阶段仅支持 `purpose: implementation | analysis`，入口为 Detective A、Strategist B 或 Devil's Advocate C。分析另须提供 `deliverable: answer | recommendations`。运行时验证完整组合并推导路径，绝不接受模型提供的后继阶段列表。

第二阶段在 F02 的质量执行和沙箱工作之后，包含 Auditor 入口、`verification` 用途、标识未提交实现候选的摘要，以及 Git 之外工作区的捕获文件清单。它们不是第一阶段的可选路径，第一阶段的输入和记录解析器必须拒绝它们。本提案不配置质量命令，也不削弱沙箱要求。

第一阶段的准入材料是当前用户消息，以及该消息显式引用的工作区内文件及其内容哈希。不新增附件句柄准入、隐式获取先前会话、远程文档抓取、dirty 文件清单或完整的非 Git 工作区清单。对明确引用文件求哈希只记录该输入的字节；不证明所有未提交变更，也不标识整个执行候选。这些更广的来源版本声明留待第二阶段。

### 谁评估入口

现有 Conductor 父级模型在首次 `conductor` 调用中提出用途、入口、适用的分析交付物、理由及材料引用。它不能预先调查工作区。确定性驱动器内没有额外分类模型调用，也没有 intake 专家阶段。

调用内部，运行时只解析所引输入，验证准入，选择固定路径，记录检查点，然后分派第一位专家。模型不能提供门禁决策、跳过记录、权限、任意下一阶段或计数重置。用途和入口必填；不确定时应明确提出 Detective，而非隐式默认。缺字段或不支持的组合应失败并列出支持选项。

### 准入与必需材料

第一阶段工具 schema 和核心准入函数仅接受 `detective`、`strategist`、`devils-advocate`。Auditor、Headsman、Ralph、Integrator、Arbiter、intake、closeout 和 report-complete 都是禁止的入口。工具 JSON 解析和新运行准入两处均强制此列表。

| 入口 | 必需材料 | 首次评估 |
|---|---|---|
| Detective A | 真实的当前用户请求；允许不确定性。 | 澄清范围或生成初步分析结果。 |
| Strategist B | 所供范围、约束、验收标准及可识别的输入来源。 | 检查范围是否充分；必要时返工至 A。 |
| Devil's Advocate C | 上述材料，加上包含步骤和可验证验收预期的所供计划。 | 评审计划；规划不完整退回 B，范围不明退回 A。 |

协议使用已定义的 `current-request` 选择器和显式引用的工作区相对文件路径，不使用模型猜测的私有 Session 消息 ID。运行时将选择器绑定到真实用户消息，铸造带品牌的材料 ID，并记录精确消息和文件内容、来源及 SHA-256 内容哈希。模型提取的范围或计划字段必须引用这些捕获输入。

文件解析采用现有文件系统权限、规范化路径以及经配置限定的大小和数量；符号链接越界、路径不可访问、内容被替换或工作区外引用均明确失败。准入不允许递归扫描、网络抓取、执行文档、任意宿主读取或静默截断。不支持的来源必须转为当前消息中的内容，或显式引用的工作区文件。

用户仅提供计划文件引用时，父级可以根据所述意图提出 C；运行时在 `conductor` 内读取文件。代码验证存在性、来源、哈希、必填字段和路径组合，而不判断自然语言质量。第一位专家及门禁检查语义充分性。可读取但不完整的材料在所提门禁获得有界返工；分派前发现时标记 `origin: intake-validation`，不得编造专家报告。非法枚举、伪造权限、路径越界和被篡改记录按拒绝优先原则失败。

### 阶段与门禁路径

准入检查点完成后，用途、入口和分析交付物不可变。拟议矩阵穷举所有组合：

| 用途 | 入口 | 交付物 | 正常专家路径 |
|---|---|---|---|
| implementation | A、B 或 C | 必须缺省；提供该字段即非法。 | 所选 A/B/C 入口 → 剩余执行前阶段 → C 执行评审及所有者批准 → Headsman D → Auditor E → Integrator F → Arbiter G。 |
| analysis | A | answer | Detective A → Auditor E → Arbiter G。 |
| analysis | B | answer | Strategist B → Auditor E → Arbiter G。 |
| analysis | C | answer | Devil's Advocate C → Auditor E → Arbiter G。 |
| analysis | A | recommendations | Detective A → Strategist B → Auditor E → Arbiter G。 |
| analysis | B | recommendations | Strategist B → Auditor E → Arbiter G。 |
| analysis | C | recommendations | Devil's Advocate C → Auditor E → Arbiter G。 |

从 Detective 开始的建议任务中，A 提供已澄清范围，B 负责包含建议与理由的报告候选。该路径必须经过 B；Detective 报告不能绕过它。已有范围从 B 进入时无需重复 Detective；已有计划从 C 进入时在 C 复审，只有返工发现缺失前提时才补充 A/B。

实现任务可用所供材料替代早期工作，但不能替代执行 C 评审或所有者批准。分析任务的 A/B/C 评估报告内容；C 明确为 `report-review`，绝非 `execution-review`。它不创建执行基线、不请求所有者批准，也不能授权写入。

### 门禁历史与有界返工

被跳过门禁获得带判别字段的 `kind: skipped` 记录，绝不是虚假通过。运行时记录门禁、用途、交付物、路径、理由、所引材料 ID 和哈希，以及因果转换。区分所供工作导致的后续入口和配置不适用。只记录已经实际跨越的门禁；后续返工可以访问此前跳过的门禁，而不改写历史。

从 A 回答问题时，E 之前 B/C/D 不适用，G 之前 F 不适用。从 A 提出建议时，B 实际接受评估，E 之前 C/D 不适用，G 之前 F 不适用。C 入口还须记录以所供范围和计划跳过 A/B 的依据。所有跳过记录引用真实输入和运行时选择的路径，而不是模型声称的批准。

返工保留请求方门禁和运行时拥有的返回目标。C 的计划不足遵循 C → B → C；嵌套范围修复可以遵循 C → B → A → B → C。分析报告缺陷返回已记录的报告生成者：从 A 开始的建议返回 B，其余返回获准的 A/B/C 生成者。返工不能分派 Headsman 修报告，也不能将发现代码缺陷变成写入权限。

先实现 [#27 的所有者决策](https://github.com/Biyocon/biyocon-harness/issues/27#issuecomment-6390992814)，并复用其可配置的按门禁预算：预设允许每个门禁两次返工，下一次升级给所有者。计入作出决定的门禁，包括准入材料不足和格式无效报告。跳过、恢复和输入修订都不重置预算。真正的权限违规和执行批准遭拒立即升级。Ralph 轮数独立；#30 不得引入第二个整次运行预算。

### 无 Headsman 和所有者 Gate C 批准的报告完成

分析生成者返回拟议的结构化 `ReportCandidate`，包含交付物、答案或建议、验收标准结果、所引材料与证据、假设和限制。建议包括理由与排序。Auditor 在全新会话中评审精确候选版本和哈希及来源；Arbiter 在另一个全新会话中评审候选与审计。在 A/recommendations 路径中，Detective 的范围评估仍关联到 Strategist 的候选。

Arbiter 的报告专用决策是 `accept | revise | blocked`，而非 release GO。接受后产生 `kind: report`、`currentStage: report-complete` 和终止状态 `reported`，不创建 `CloseoutRecord` 或 `awaiting_authorization`。报告可包含有充分依据的负面发现；完成不能被渲染为测试通过、被评代码获批或发布授权。

所有分析运行的 baseline 和执行授权均为空，质量执行记录为空。专家仅有读取、搜索和结构化输出，无写入、编辑、shell、质量命令执行、Ralph 或外部动作工具。支持报告的 Auditor/Arbiter 验证器要求候选与来源，而非虚设执行基线。绝不调用批准服务。宿主拥有的会话日志仍与项目修改分离。

要求落实建议时，启动新的关联 implementation 运行并经过真实的执行 C 批准。要求全新命令验证时，不能静默用静态分析替代：`verification` 用途和 Auditor 入口在 F02 之后的第二阶段前都不受支持。已有 implementation 运行的验证策略保持不变。

### 安全不变量

- 入口和交付物只影响路由，不影响权限。计划、项目指令、声称的所有者名称、所供日志和模型编写的批准字段均不能授予效果。
- 每次 Headsman/Ralph/Integrator 写入之前，运行时都要求 implementation 用途、最近失效之后的执行 C 通过、精确有效基线、匹配本运行和效果的宿主批准，以及现有规范化 allowed/excluded 路径强制机制。跳过 C 或 report-review C 都不能满足该谓词。
- 分析不能通过正向路由、返工、恢复或直接执行器调用进入可写阶段或命令执行。更改用途或交付物必须新建运行。
- 有效范围、计划、允许效果或执行候选变化，按现有规则使受影响执行批准失效。第一阶段有限输入哈希不能替代完整候选身份。
- 每种结果返回后，包括 reported，父级仍按[路由决策](../../implemented/bug-fix/2026-10-25-conductor-mode-routing.md)被拒绝工具。只有新用户输入允许再次分派 Conductor；失败绝不启用独立替代执行。
- 生成者、Auditor 与 Arbiter 使用不同的全新会话。这提供角色和上下文隔离，不表示使用不同模型或由人类评审。

### 持久化与恢复

同步扩展[运行类型](../../../../packages/conductor/conductor/src/types.ts)、状态转换和严格序列化。持久化用途和配置版本、所提与获准入口、分析交付物、真实当前消息来源、有界捕获文件输入及哈希、准入理由与修复、评估和跳过历史、待处理修复返回目标、报告候选与审计及最终报告版本，以及适用的宿主执行权限。按 #27 的历史语义重建各门禁计数，不接受模型填写的值。

在下一 child 启动之前，对准入和全部跳过及修复转换记录检查点。恢复验证从获准入口和交付物出发的保存路径，不能假定 Detective、仅相信 currentStage、重新运行 intake 或重复跳过记录。拒绝非法路径组合、缺材料、哈希不匹配、悬空 ID、候选和审计版本不匹配、伪造批准以及不兼容的报告与执行字段。reported 运行是终止状态，不能恢复到 GO 或 closeout。

核查的记录格式为版本 1，但 #27 修改持久化预算和验证，因此必须先于 #30 实现合并。检查 #27 合并后的格式，再为 #30 的不同布局分配下一版本；若 #27 交付版本 2，#30 使用版本 3。不得在此预留或独立复用版本 2、静默将 #27 记录读作 #30 记录，或新增兼容层。对不支持的旧记录给出可操作诊断并拒绝。本纯设计 PR 不修改格式常量。

现有 `conductor/checkpoint` 可承载新运行 JSON，仅内部改变无需提高 Session 外层格式版本。若新增 SessionEventMap 或 SDK 可见生命周期行为，实现 PR 必须同步更新 TS/Python 投影测试与预期输出；否则验证通用结果处理。模型可见输入通过日志消息和检查点持久化，让回放使用捕获内容，而非已变化文件。

### 依赖及保留决策

实现顺序为：已合并的 #29 路由 → #27 所有者路径、无效报告返工、真实状态及按门禁预算 → #30 第一阶段。第二阶段在 F02 之后，执行验证和更完整来源身份须另行设计与授权。#25 源码启动生成及 #28 界面元数据不属于本次工作。

保留有效的[运行时](../../implemented/feature/2026-09-11-conductor-runtime-layer.md)、[quality-executor](../../implemented/feature/2026-10-10-conductor-quality-command-executor.md)、[已安装 skill](../../implemented/bug-fix/2026-10-24-conductor-installed-skills.md)、[Ralph](../../implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md)和路由决策。本未实现提案不取代其已交付保证；不应归档。复用[规范角色和协议来源](../../../conductor/README.md)，不另建人工维护副本。未来修改属于 Conductor types/state/drive/persistence 及其工具和预设，而非通用指令机制或 agent loop。

## 曾考虑的替代方案

### 入口评估

| 方案 | 优点 | 成本及决定 |
|---|---|---|
| A：现有 Conductor 模型提出，运行时决定准入。 | 复用现有用户上下文和强制首次调用路由；不增加分类器、child、协议安装或权限通道。 | 需要显式输入和语义充分性评审。所有者已选择。 |
| B：独立只读 intake 专家，随后执行相同准入检查。 | 隔离 intake，并可在建议入口前检查所供材料。 | 固定增加模型延迟、成本、持久化及协议维护，仍不能替代代码验证。未选择。 |

### 报告处理

| 方案 | 优点 | 成本及决定 |
|---|---|---|
| 修订 R1：生成者 → Auditor → Arbiter；Detective 建议任务另须经过 Strategist。 | 普通答案保持简短，建议获得规划阶段，所供计划避免冗余调查。 | 需要经验证的交付物矩阵、显式跳过及按生成者定位的返工返回目标。所有者已选择。 |
| R2：所选入口 → 剩余只读 A/B/C 阶段 → Auditor → Arbiter，跳过 D/F。 | 范围、计划和质疑处理更统一，正向路由更简单。 | 普通答案和已准备计划重复规划。未选择。 |

拒绝仅靠提示词省略执行 C：它移除授权，却未强制仅报告效果。独立 reported 结果保留已完成分析与 GO 的区别。

## 验收标准

以下是未来实现的测试计划；本纯文档 PR 不提供拟议行为的运行时测试结果。

1. 准入测试覆盖 implementation A/B/C 及全部六种 analysis 入口和交付物组合。拒绝缺失或类型错误的用途、入口、分析交付物，implementation 上的交付物字段、未知交付物、Auditor 入口、verification 用途及所有禁止阶段。
2. 材料测试将 current-request 绑定真实用户输入，对显式引用的工作区文件求哈希，并拒绝虚构 ID、不可访问或被替换文件、符号链接逃逸、工作区外路径、不支持的来源及超出配置大小和数量。证明准入既不扫描无关 dirty 文件，也不构建非 Git 清单。
3. 状态测试区分 answer A → E → G 和 recommendations A → B → E → G；建议不能跳过 B。覆盖所供范围 B、所供计划 C 且不运行 A/B、材料不足、嵌套修复与返回、评估和跳过记录，以及 #27 独立的第二次与第三次返工限制。
4. 分析测试令批准服务被调用即抛错，要求执行状态为空、无执行工具，以及生成者、Auditor 和 Arbiter 会话相互独立。验证 reported 而非 GO、真实限制和负面发现、父级读取、写入及重分派被拒，以及真实执行器拒绝强制 child 写入。
5. 实现测试在跳过 C、report-review C、陈旧或跨运行批准、有效输入变化及伪造恢复状态后，在副作用前拒绝写入。保留有效且未变化的执行 C 批准路径。不添加第二阶段验证行为。
6. 持久化测试往返验证 intake 和交付物、跳过、修复返回目标及报告完成；崩溃恢复不重新分类、不重复历史或 child。拒绝不支持的 #27 或更旧格式、不可能的路径和历史组合、不兼容执行字段及已完成报告的 closeout。
7. 通过[真实可运行的 headless 示例](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts)添加无密钥场景，由 Loader 在外部临时工作区加载随附预设，该工作区的 AGENTS.md 要求独立读取和写入。仅替换模型和明确的非确定性宿主决策；记录父子请求、输入、门禁历史及最终结果。父级首次工具为 conductor，实际第一位专家匹配准入。
8. 快照至少覆盖：从 Detective 开始的普通答案；从 Detective 开始且确实分派 Strategist 的建议；从 Devil's Advocate 开始且不经过 A/B 的所供计划；C → B → C 修复；禁止的 Auditor 入口在分派前被拒；以及保留 #27 真实状态的有效受阻运行。报告场景不调用所有者批准，也不分派 Headsman、Integrator 或 Ralph。创建运行前的非法调用不得编造运行 ID 或专家分派。
9. 宿主日志保存在测试项目之外，验证分析后项目输入未变化。在 Linux/WSL 录制，并在支持的已构建 Linux/macOS 和原生 Windows 回放，不绕过归一化器、重试、沙箱或测试策略。未来聚焦覆盖率、快照、构建与构建入口、doc-sync 及适用 SDK 检查遵循 dsh-pre-push-checks。提供方语义质量仍与无密钥组合和强制机制证据分开。

## 风险

- 有效引用不证明语义充分；运行时检查和独立评审限制错误 intake，而不声称模型确定性。
- 随交付物变化的路径和报告 C 语义增加状态验证复杂度。明确判别字段、因果历史及反向执行器和恢复测试必须防止意外执行权限。
- 第一阶段有意省略直接 Auditor 入口、全新 verification 运行，以及完整 dirty 或非 Git 来源身份。不得宣传所引输入哈希等同可复现的全工作区验证。
- 捕获消息和文件可能包含敏感材料；应用现有权限、有界输入及日志策略，不扩大宿主访问。
- #27 必须先交付。格式复用或并行预算会使恢复语义无效；即使拒绝旧的未完成运行，仍须协调版本分配。

所有者已选择 A 和修订 R1，并将第一阶段限制如上。状态保持 proposed，等待实现评审；发布此设计不授权运行时实现。
