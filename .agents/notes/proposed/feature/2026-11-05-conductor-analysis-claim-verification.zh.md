# Agent Note: Conductor 分析中有证据约束的事实陈述

Status: proposed

[English](2026-11-05-conductor-analysis-claim-verification.md) | 中文

## Problem

[Issue #75](https://github.com/Biyocon/biyocon-harness/issues/75)报告一次只读分析：Detective 和 Auditor 多次尝试不可用的 `web_search`，随后 Auditor 将未核实的事实描述为正确，Arbiter 接受了报告。该观察证明存在核验缺口，并未证明所述事实错误。[分析批评者](../../implemented/feature/2026-10-28-conductor-analysis-critic.md)挑战推理，明确把事实和引用检查交给 Auditor；其 `holds` 结论不能证明那些事实。

当前[Auditor 角色](../../../conductor/roles/05-auditor.md)要求评估候选报告及其来源，却不要求逐项事实核验结果。[AnalysisEnvelope](../../../../packages/conductor/conductor/src/types.ts)、[ReportDecision](../../../../packages/conductor/conductor/src/types.ts)及其[验证](../../../../packages/conductor/conductor/src/analysis.ts)绑定候选与审计哈希，但不要求每项事实陈述具有来源支持的状态。`evidence_reviewed: string[]` 不能证明所检查的来源支持被接受的陈述。

## Proposal

### 解释并移除不可用工具的指令

无需私人运行数据即可找到 `web_search` 提示的来源。[基础 bundle](../../../../packages/bundle/base/cordis.patch.yml)在每种模式下加载 `tool-web`。其[搜索插件](../../../../packages/web/tool-web/src/search.ts)既注册工具，又无条件注册指导模型使用该工具的 `tool:web_search` 系统提示段。[子智能体组合](../../../../packages/subagent/subagent/src/child-agent.ts)继承父级提示段，然后限制工具。[Conductor 的分析过滤器](../../../../packages/conductor/tool-conductor/src/workflow-child.ts)只开放 `read`、`read_image`、`grep` 和 `glob`，而其[分派提示](../../../../packages/conductor/tool-conductor/src/index.ts)把 `read` 列为允许操作。检索 Conductor 角色、专员 skill 及分派文本，未发现 `web_search` 指令。因此，继承的系统文本是一条具体的矛盾指令；模型自身行为也可能产生影响，但无需把它视作唯一解释。

第一实施阶段应根据子智能体实际可见工具列表隐藏不可用工具的指导，并在已记录、模型可见的分析分派中明确列出可用工具名称和禁止外部检索。此规则覆盖所有分析专员，包括 Arbiter，不授予 `web_search` 或 `web_fetch`。执行过滤器及 guard 仍是最终权限依据。被拒绝的工具调用返回一次清晰、已记录的纠正信息，列出可用工具；同一子智能体反复发出相同的不可用调用时，该尝试须明显失败，不能无限消耗模型轮次。不通过延长超时或自动重试解决。隐藏提示及工具拒绝反馈沿用现有会话事件，不改变 v5 运行记录。

### 接受“有文献证明”之前要求逐项审计

第二阶段中，候选报告须将完整 `content` 划分为准确、不重叠的文本范围，分别标记为事实陈述或非陈述；每项重要事实陈述有稳定 ID。Auditor 独立检查非陈述范围是否隐藏遗漏事实，并对每项陈述返回结构化判定：`source_verified` 包含已准入材料 ID、准确行号及得到支持的命题；`derived` 指明已验证的前提陈述和推理；`unverified` 说明缺少何种证据。模型记忆和未获支持的 URL 均不能算作 `source_verified`。准入范围外发现的工作区文件可用于引导调查，但不能暗中变为已准入证据。宿主根据不可变捕获验证文本范围完整划分、陈述 ID、材料 ID 和行号、前提引用、无循环推导、候选/审计身份及必需字段。命题是否真的受到来源支持仍须 Auditor 判断；有效的范围与哈希本身不能证明语义支持。发现遗漏事实陈述时，Auditor 必须要求返工，不能确认清单完整。

Arbiter 接收准确的候选报告、批评结果、审计及逐项判定。只有结论所依赖的每项重要陈述均为 `source_verified` 或有支持的 `derived`，且其余未核实陈述明确标记、没有支撑结论时，才可 `accept`。即使 Arbiter 的文字赞成，宿主也须拒绝含未核实重要陈述的 `accept`。如果生产者可在分析授权内引用已准入证据、删去陈述或缩小结论，则用 `revise`；如果关键核验需要不可访问的外部材料或授权外操作，则用 `blocked`。所有者可通过新的授权 intake 提供新材料，不能暗中扩展当前捕获。最终 EN/DA 报告在每项保留的未核实陈述旁显示 “Unverified / Ikke verificeret” 等文字标签，并说明限制，不能只靠颜色。若仅剩非重要陈述未经核实，也不能把接受的报告标为“事实全部核实”；须说明已核实范围。

把陈述清单、审计判定及接受条件存入 Conductor 运行记录，以哈希绑定准确的候选报告及审计。这些必需字段与终态语义需要下一个单调递增的记录版本，不能重新解释 v5。与 [#30 第二阶段](https://github.com/Biyocon/biyocon-harness/issues/30)及 [#58 阶段 B](2026-11-05-conductor-detective-evidence-budget.md)协调版本；若其中之一先交付 v6，就使用下一版本。所有模型可见的指令、来源摘录、工具拒绝反馈及返回判定，都须能从会话日志重建。保留既有 Conductor 路线的七个角色、必经批评、只读分析及 Gate C/GO 权限。

## Alternatives considered

**仅在提示中警告。** 可以减少对不可用工具的调用，但模型仍可能宣称未引用的事实正确；需要类型化的陈述结果和宿主接受规则。

**所有未核实陈述都导致终态阻止。** 这会拒绝包含明确标记、对结论无关紧要的不确定性的有用分析。只阻止缺乏支持的关键陈述，仍可提供真实的有限报告。

**给分析开放网页搜索。** 这会扩大只读角色的外部访问，引入新的来源归属和费用，而且搜索结果仍不能证明页面支持每项陈述。外部检索需要独立的授权与准入设计。

## Acceptance criteria

通过真实 `conductor-installed` 示例生成的无密钥 snapshot 须呈现允许的工具、一次被拒的 `web_search` 调用及有界反馈、含已核实与未核实陈述的候选报告、Auditor 的逐项判定、重要缺口下 Arbiter 的 `revise` 或 `blocked`，以及有限接受答案中的 EN/DA 标签。聚焦验证测试须拒绝缺失或重叠的陈述覆盖、伪造材料 ID 或行号、循环推导、过期哈希及对未核实重要陈述的 `accept`。重放保留准确判定及来源哈希；若运行或会话事件改变，两个 SDK 投影均更新。在公开材料上用真实模型比较额外审计调用和 token 与正确的陈述覆盖。私人会话内容不得进入 fixture 或日志。

## Risks

陈述清单与独立审计增加 token，仍可能漏掉事实陈述或误判来源支持；本设计不宣称可形式化证明语义真实。准入来源稀少时，严格阻止会减少完成的报告。隐藏工具指导须遵循实际可见的分层工具列表，否则可能隐藏其他角色合法拥有的工具。跨进程并发仍由 [#51](https://github.com/Biyocon/biyocon-harness/issues/51)负责。
