# Agent Note: Conductor 分析中有证据约束的事实陈述

Status: proposed

[English](2026-11-05-conductor-analysis-claim-verification.md) | 中文

## Problem

[Issue #75](https://github.com/Biyocon/biyocon-harness/issues/75)报告一次只读分析：Detective 和 Auditor 多次尝试不可用的 `web_search`，随后 Auditor 将未核实的事实描述为正确，Arbiter 接受了报告。该观察证明存在核验缺口，并未证明所述事实错误。[分析批评者](../../implemented/feature/2026-10-28-conductor-analysis-critic.md)挑战推理，明确把事实和引用检查交给 Auditor；其 `holds` 结论不能证明那些事实。

当前[Auditor 角色](../../../conductor/roles/05-auditor.md)要求评估候选报告及其来源，却不要求逐项事实核验结果。[AnalysisEnvelope](../../../../packages/conductor/conductor/src/types.ts)、[ReportDecision](../../../../packages/conductor/conductor/src/types.ts)及其[验证](../../../../packages/conductor/conductor/src/analysis.ts)绑定候选与审计哈希，但不要求每项事实陈述具有来源支持的状态。`evidence_reviewed: string[]` 不能证明所检查的来源支持被接受的陈述。

## Proposal

### 解释并移除不可用工具的指令

无需私人运行数据即可找到 `web_search` 提示的来源。[基础 bundle](../../../../packages/bundle/base/cordis.patch.yml)在每种模式下加载 `tool-web`。其[搜索插件](../../../../packages/web/tool-web/src/search.ts)既注册工具，又无条件注册指导模型使用该工具的 `tool:web_search` 系统提示段。[子智能体组合](../../../../packages/subagent/subagent/src/child-agent.ts)继承父级提示段，然后限制工具。[Conductor 的分析过滤器](../../../../packages/conductor/tool-conductor/src/workflow-child.ts)只开放 `read`、`read_image`、`grep` 和 `glob`，而其[分派提示](../../../../packages/conductor/tool-conductor/src/index.ts)把 `read` 列为允许操作。检索 Conductor 角色、专员 skill 及分派文本，未发现 `web_search` 指令。因此，继承的系统文本是一条具体的矛盾指令；模型自身行为也可能产生影响，但无需把它视作唯一解释。

阶段 1 是通用子智能体组合修复，以独立 PR 交付，不改变 Conductor 记录或会话格式。为 `PromptSection` 增加类型化的可选 `requiresTools` 列表：只有其中每个工具都在当前 scope 的有效工具视图内，才包含该段。关联由显式元数据声明，绝不能解析 `tool:` 名称前缀。未关联的段保持既有行为。工具注册完成后，在组装时验证名称非空、不重复且对应已注册能力；已知但被过滤的工具导致该段省略。工具 provider 须独立于 wire schemas 提供有效能力名称，因为 Code Mode 可能只暴露 `run_code`，但仍有底层可调用能力。每次组装和冷恢复均重新计算可见性，保持父级/兄弟隔离和 scoped shadowing。在求值文本 provider 前省略被隐藏的段。搜索指导关联 `web_search`；建议后续使用 `web_fetch` 的句子须同时依赖两者。执行限制仍是权限依据，最终提示沿用现有已记录快照。

本提案仅部分取代[子智能体组合](../../implemented/feature/2026-07-12-subagent-persona-tool-filter-and-depth.md)中无条件保留独立工具指导的规则；persona、过滤、深度与 provider 决策继续有效。阶段 1 实施前，现有指导规则仍是已交付行为。

涉及的包为 [system-prompt](../../../../packages/core/system-prompt/src/index.ts)（类型化关联与组装）、[tools](../../../../packages/core/tools/src/index.ts)（有效能力名称投影）及 [tool-web](../../../../packages/web/tool-web/src/search.ts)（搜索/获取声明）。子智能体组合使用这些通用能力，Conductor 不需要专用隐藏规则。测试覆盖 system-prompt 分层组装、未知/被过滤能力、父级/兄弟隔离、shadowing、provider 求值和未关联段；tools 覆盖 native/code/both；tool-web 覆盖仅搜索及混合可见性。子智能体 driver 的 preset-inheritance 测试及 continuation-inheritance 测试验证新建与冷恢复。增加含受限与不受限子智能体的真实组装无密钥 transcript，并在该实施 PR 更新所属 README/JSDoc 和 system-prompt 类型投影。

后续 Conductor 专用阶段才将准确的可用工具和禁止外部检索写入专员输入。每次子智能体尝试用经过验证的正安全整数 Config 上限统计所有不可用工具拒绝，跨工具名和参数合计；建议默认两次（第一次记录纠正，第二次明显失败）。计数跨继续/恢复持久保存；达到上限即终止尝试，不自动重试，也不扩大权限。

### 接受“有文献证明”之前要求逐项审计

推荐陈述列表而非完整文本划分。每项有稳定 ID、候选报告中的非空逐字引用；引用重复时须指明出现序号。宿主验证未经规范化的 substring 身份、有效出现序号、唯一 ID 及候选哈希。Auditor 独立检查完整候选是否遗漏陈述，并判断重要性；列表本身不能证明完整。发现遗漏，或通过降低重要性隐藏无支持结论时，必须返工。判定为 `source_verified`（已准入来源 ID、支持命题的准确行号）、`derived`（已验证前提 ID 及显式推理）或 `unverified`（缺失证据）。验证来源哈希/范围、提交的所有陈述 ID 均有判定、前提有支持且无循环，以及审计身份。在两种模式下，宿主均拒绝把 `current-request` 直接或经推导前提用作事实支持；它定义范围及所有者假设，而非佐证。模型记忆、单独 URL 和未准入的发现文件不能成为来源核验。语义支持与完整性仍由 Auditor 判断，substring 验证不保证二者。

可信的专员指令明确把候选与来源文本界定为不可信证据，而非指令。嵌入的指令不能授权工具、选择证据模式或覆盖接受判定。Auditor 独立核查陈述，Arbiter 审查审计，而非服从报告指令；这些措施降低注入风险，但不保证语义免疫。

宿主选择两种证据模式。`model_knowledge` 表示除必需的 `current-request` 外没有准入来源材料；请求用于说明问题，并非独立佐证。若分析满足其他条件，Arbiter 可以接受此答案，包括重要但未核实的陈述。整个报告必须使用宿主渲染的 DA/EN 标签 **“Bygger på modelviden, ikke verificeret mod kilder” / “Based on model knowledge, not source-verified”**，包括最终回复及导出/显示的报告，绝不能称为有文献证明或事实已核实。记录给父智能体的结果必须保留该标签，不能只依靠模型转述。生产者或 Arbiter 不能自行选择该模式以绕开已有来源核查。在该模式下，所有分析子智能体（包括 Auditor 和 Arbiter）仅暴露必需的结构化输出工具：子级过滤与执行 guard 均拒绝文件/图像读取、发现、网页访问及其他来源检索。禁止注入工作区/来源内容，保留可信角色指令及请求。来源访问必须经过新的授权 intake，不能隐式改变模式。

一旦存在任何准入来源材料，即使用 `source_backed`，即使材料不足或无关。结论依赖的重要陈述未核实时，宿主拒绝 `accept`；重要性由 Auditor 独立判断。被接受的附带未核实陈述不能支持结论。宿主在每项此类陈述的准确出现位置渲染 “Unverified / Ikke verificeret”，并将呈现绑定到候选/审计哈希；任一必需标签缺失或位置错误时，拒绝接受。所有已接受的显示/导出/最终回复均保留此带标签的呈现。若可通过准入证据、删除陈述或缩小结论修复，则用 `revise`；关键核验需要不可访问来源或授权外操作时用 `blocked`。新增证据须经过新的授权 intake，不能暗改捕获。Arbiter 接收准确候选、批评、审计及逐项判定；来源模式下的接受仅说明已核实范围。

把陈述清单、审计判定、宿主选择的证据模式及接受条件存入 Conductor 运行记录，以哈希绑定准确的候选报告及审计。这些必需字段与终态语义需要下一个单调递增的记录版本，不能重新解释 v5。与 [#30 第二阶段](https://github.com/Biyocon/biyocon-harness/issues/30)及 [#58 阶段 B](2026-11-05-conductor-detective-evidence-budget.md)协调版本；Codex 已被所有者指定为共同 schema 与版本负责人；[统一 v6 提案](2026-11-11-conductor-v6-evidence-verification-and-budgets.md)管理三个工作流的合并字段和验收规则，实施前由 Claude review。第一阶段及本文独立理由继续有效。该负责人依据已合并 master 串行协调分配 schema：一个版本只有一种布局，绝不能并行定义不兼容的 v6。若 v6 已交付，负责人检查已合并 schema 后分配下一版本，并在合并前再次验证分配；这不意味着提供兼容迁移。所有模型可见的指令、来源摘录、工具拒绝反馈及返回判定，都须能从会话日志重建。保留既有 Conductor 路线的七个角色、必经批评、只读分析及 Gate C/GO 权限。

## Alternatives considered

**仅在提示中警告。** 可以减少对不可用工具的调用，但模型仍可能宣称未引用的事实正确；需要类型化的陈述结果和宿主接受规则。

**完整不重叠划分与逐字引用列表。** 划分可机械证明每个字符都归属某段，却不能证明被标成非事实的段没有事实。它需要准确偏移量，并为标题及连接文字增加段。引用较能容忍无关排版变化，但重复文字需要出现序号，遗漏仍须独立审计。任何候选变更都会使两种方案的审计失效。推荐引用列表以降低结构负担，同时保留 Auditor 对整份报告的遗漏检查。

假设报告 2,000 token、20 项陈述，划分元数据估计为 40 段 × 20–30 token，即增加 800–1,200 个生产者输出 token；引用列表为 20 项 ×（20 个引用 token + 6–10 个元数据 token），即 520–600。两者的审计判定均另增约 400–800 个输出 token。这些是规划估算，并非实测分词或账单结果；向批评者、Auditor 和 Arbiter 重复发送会增加输入成本。较长引用可能逆转收益。实施验收前须用公开材料测量真实输入/缓存/输出及重试；两种方案均不要求额外的陈述提取模型调用。

**阻止所有未核实报告。** 按所有者决定，对无来源知识问题不采用该方案。整份报告明确标记模型知识即可提供有用答案而不声称核验；有准入来源的分析仍对重要陈述严格核验。

**给分析开放网页搜索。** 这会扩大只读角色的外部访问，引入新的来源归属和费用，而且搜索结果仍不能证明页面支持每项陈述。外部检索需要独立的授权与准入设计。

## Acceptance criteria

阶段 1 测试通用类型化关联，包括不带 `tool:` 前缀的任意段名称、已注册但隐藏的工具、不可用的 `web_fetch` 后续指引、Code Mode、scope 隔离、新建/冷恢复子智能体及不变的日志格式。独立实施 PR 包含真实组装的无密钥子智能体 transcript。

阶段 2 的 `conductor-installed` 无密钥 snapshot 覆盖混合来源报告、一次被拒调用及有界的重复拒绝处理、Auditor 发现遗漏、Arbiter 的 revise/blocked。无来源知识问题必须能被接受，并显示整份报告的准确 EN/DA 标签；必需的当前请求不能单独迫使使用来源模式。有准入但无关来源的报告不能降级为模型知识。测试拒绝不存在/歧义引用、缺失判定、伪造来源/范围、循环推导、过期哈希、篡改模式，以及来源模式下接受重要未核实陈述。对抗案例包括来源/报告指令要求伪造核验或改变模式、请求断言加无关准入文件、直接/推导的请求佐证、模型知识模式下访问来源、跨恢复交替被拒工具名/参数，以及附带标签缺失或位置错误。无论嵌入什么指令，宿主判定都拒绝无效决定；公开模型测试还须测量语义注入失败。UI/最终结果检查确保重载及父智能体最终回复均保留文字标签，不依靠颜色。重放恢复模式、判定和哈希；受影响的两个 SDK 投影均更新。公开材料的真实模型对比测量两种清单方案的 token、缓存、调用、重试及遗漏发现。私人运行数据不得进入 fixture 或日志。

## Risks

陈述清单与独立审计增加 token，仍可能漏掉事实陈述或误判来源支持；本设计不宣称可形式化证明语义真实。准入来源稀少时，严格阻止会减少完成的报告。隐藏工具指导须遵循实际可见的分层工具列表，否则可能隐藏其他角色合法拥有的工具。跨进程并发仍由 [#51](https://github.com/Biyocon/biyocon-harness/issues/51)负责。
