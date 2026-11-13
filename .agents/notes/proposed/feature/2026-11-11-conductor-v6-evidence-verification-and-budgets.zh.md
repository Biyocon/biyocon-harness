# Agent Note: 统一 Conductor 的证据、验证与预算格式

Status: proposed

[English](2026-11-11-conductor-v6-evidence-verification-and-budgets.md) | 中文

## 问题

[#75 第二阶段](https://github.com/Biyocon/biyocon-harness/issues/75)、[#30 第二阶段](https://github.com/Biyocon/biyocon-harness/issues/30)与 [#58 B 阶段](https://github.com/Biyocon/biyocon-harness/issues/58)都需要必需的持久字段。分别分配版本会让相同格式号表示不兼容记录。引用哈希正确不等于事实有依据，Git commit 不能标识未提交工作，没有逐次调用记账的限制也无法约束并发子 agent 或披露不确定消耗。

## 提案

### 所有权与版本分配

Codex 维护唯一 schema 及版本分配，Claude review，所有者 merge。v6 是工作名称，不是已冻结 schema 或已分配发布编号。下述 provider 可行性 G0 先执行：其证据经 review 前，不冻结格式，也不开始 v6 实施。分配、实施及 merge 前重新检查已合并 master；编号占用时协调重新分配。本设计 PR 不增加运行时、格式升级或迁移。保留 rc.7，核心不依赖 Conductor。

本文负责合并后的未来字段与验收规则。[声明设计](2026-11-05-conductor-analysis-claim-verification.md)、[Detective 设计](2026-11-05-conductor-detective-evidence-budget.md)、[intake 决策](../../implemented/feature/2026-10-25-conductor-intake-and-report-completion.md)与[子 agent 限额决策](../../implemented/architecture/2026-11-02-reserved-child-identity-and-output-token-limit.md)保留各自独立理由及已交付行为。#75 第一阶段与 #58 A 阶段不需要 v6；其尚未合并实现不能视为 master 行为。所有者暂缓 #100，不接受 #105 作为价格优化，并保留 #106 两项研究；v6 不能静默要求这些 PR 先合并。

### 第一关：冻结 schema 前的 provider 可行性

在每条精确 route 上，将两种候选上界与报告 usage 比较：**(a)** 完整序列化模型请求的 UTF-8 字节数，加上实测 chat-template 余量；**(b)** 随包分发的离线 tokenizer，加上实测余量。对已证明采用 byte-level BPE 的 route，普通 token 各代表至少一个输入字节；这一本身不覆盖 special token、隐藏模板、规范化、工具或多模态转换。(a) 必须统计全部模型可见序列化字段，并覆盖隐藏 framing。(b) 必须固定 tokenizer/model/template 版本、来源和再分发权；其他模型的 tokenizer 或只统计 message 文本均不足。

固定 endpoint、adapter/provider 实现、实际模型版本、reasoning/tool 编码及模板。用 Unicode、转义 JSON、工具/history、长上下文和重试，把两种上界与完整报告输入比较，包括 cache-read。记录最大低估、所选余量、假设及拒绝输入；route 改变时重新验证。经验余量不是普遍证明。[官方 token 指南](https://api-docs.deepseek.com/quick_start/token_usage/)提供估算和离线 demo，不提供完整 route 保证。

保留的 606 次调用可为离线校准提供依据，但不能证明当前固定 route 上的两种候选。**未经所有者明确批准，不发起新的付费模型调用。** G0 要求两种候选的上界/usage 结果经 review，选定保守上界，具备逐尝试传输可观察性/输出强制限制，并通过无密钥重试/拒绝测试。否则把限制交回 review：不冻结 schema、不升级 v6，也不宣传硬预算。本次修订只执行下文离线 checkpoint 大小估算。

### 必需的记录分组

保留现有 checkpoint 事件与 session envelope。每个 v6 run 必须具有以下经过验证的分组；按 purpose 区分的数据使用显式判别字段，不依赖含义模糊的缺失字段。

| 分组 | 必需信息 |
|---|---|
| `admission` | 不可变 purpose：`implementation`、`analysis` 或 `verification`；入口、验收条件、捕获来源、host 初始选择的证据模式及已解析限制。 |
| `candidateIdentities` | 仅追加的 host Git/manifest 身份、有序文件条目、遗漏、范围及摘要；活动候选 ID，纯分析则显式为 `none`。 |
| `reportVersions` | 精确候选内容/哈希、引用声明及出现位置、challenge/audit 哈希、仅追加证据模式决策及 host 呈现。 |
| `budgetLedger` | 限额、唯一预留、dispatch 与 usage 来源、实际扣账、未解决预留及终止原因。 |
| `inspectionLedger` | 子 agent/尝试、来源身份、返回区间/分页、观察到的变化、选择与已披露遗漏。 |
| `final` | 报告/验证/实施结果，或包含原因及尚未验证范围的终态 `incomplete`。 |

Run、子 agent、候选、声明、检查及调用身份均使用 branded ID。规范序列化规定 UTF-8、仅记录序列化使用 LF、对象键排序、数组顺序不变；来源字节和报告引用绝不规范化。哈希包含域/版本前缀；子 agent、audit、presentation 哈希包含 run 及精确候选/来源身份。解析器验证引用、唯一性、无环性、计数及可达转换，不能只验证字段类型。通过经过验证的 Config 限制数量、字节及总 checkpoint 大小；在超限 checkpoint 之前拒绝 admission 或显式结束，不得静默丢弃记账。

Analysis 保存含声明的报告历史；verification 保存绑定候选的 audit/verdict 历史；implementation 保留其执行 baseline 历史。不适用分组使用 `not_applicable`，不虚构证据或批准。仅 analysis 选择两种声明证据模式。Verification 增加终态 status/stage `verified` / `verification-complete`；每种 purpose 都可结束为 `incomplete` / `incomplete`。保留现有 implementation 与 reported 终态。Resume 仅允许有效非终态转换；终态结果不可变。

### 声明与诚实的报告呈现

采用已批准的精确引用清单：唯一声明 ID、非空精确 substring、出现序号及候选哈希。Auditor 独立通读候选，寻找遗漏的重要声明和被降低的重要性；substring 匹配只证明身份。每个已提交声明都得到 `source_verified`（已 admit 来源/哈希/行）、`derived`（非空、无环的受支持前提链及推理）或 `unverified`（缺失证据）。拒绝过期身份、不存在的出现位置、不完整评估及无支持前提。`current-request`、模型记忆、单独 URL 及未 admit 的发现，无论直接还是经推导，都不能建立来源验证。

Admission 除 `current-request` 外没有证据时，host 初始选择 `model_knowledge`。此模式下 dispatch 的子 agent，包括 critic、Auditor、Arbiter，仅获 structured output；禁止文件/图像/搜索/web 工具及工作区/来源内容注入，保留可信角色指令与问题。可以接受未验证重要声明，但整份报告必须带有 **“Bygger på modelviden, ikke verificeret mod kilder” / “Based on model knowledge, not source-verified”**，不能称为有文档依据或事实已验证。新来源需要新的已授权 intake。

Admit 来源时初始选择 `source_backed`。所有者 D1 决策允许此例外：**Auditor 判断某个已 admit 来源与请求的分析无关时，报告退回带标签的 `model_knowledge`，不能仅因该无关性变为 `blocked`。** 接受前持久化仅追加决策，绑定 Auditor 可信子 agent/尝试、候选/audit 哈希、来源 ID/哈希及相关性理由。保留 capture 和此前已授权访问，不能伪装成从未 admit 来源。除整份报告必需 EN/DA 标签外，还须清楚显示理由和模式变化。所得候选不享有来源验证信用；以前评估仅为历史，不能成为已接受的 `source_verified` 声明。后续子 agent 使用受限模型知识视图，不从先前报告注入来源摘录。必要修订不能重置已花预算或 rework 额度；预算耗尽仍可产生 `incomplete`。

`source_backed` 有效期间，任何重要未验证声明均阻止接受。附带未验证声明不能支持结论，每个出现位置均标注 **“Unverified / Ikke verificeret”**。Host 确定性处理重叠，并将标注文本绑定候选/audit/模式决策哈希。Auditor 判断相关性、重要性及支持；Arbiter 检查精确候选、challenge、audit 和模式决策。相关 admit 证据可修复时用 `revise`，关键验证不可获取时用 `blocked`，而非用它处理 D1 的无关来源回退。Producer/报告/来源指令或请求本身均不能选择或伪造降级。

规范最终响应是包含已标注报告、由 host 呈现的 Conductor 工具结果，而不是额外的模型转述。接受报告时使用现有执行所属的 `concludeTurn()` 标记；Conductor 作用域的 request guard 拒绝已完成任务的后续父 agent 模型调用。不得丢弃竞争到达的 steering：保留到显式的新用户任务，或显示拒绝。终态呈现必须在真实已装配 preset 中工作，包括会延迟 context 的其他插件。UI、复制/导出与 Conductor SDK adapter 暴露同一规范文本及哈希。原始候选仍是明确未接受的草稿，不得伪装成最终报告。若现有终态工具投影不能满足某个 adapter，须在 review 中解决该缺口，再考虑增加通用核心机制。

按每个子 agent 尝试持久化 unavailable-tool 拒绝次数，跨名称、参数及 resume 累计。正整数 Config 限制初始为二：允许一次已记录纠正，随后明确失败；不自动重试或扩展能力。

### Verification 入口与精确候选身份

仅在存在明确范围、非空条件、捕获的已提供工作及完整 host 候选身份时，允许 `purpose: verification`、`entry: auditor`。Verification 为只读，路径为 Auditor → Arbiter；不虚构执行批准、Integrator 交付或 GO。记录实际经过的绕过项，包含所提供材料引用及原因。Analysis 保留强制独立 critic；implementation 保留全部现有执行 gate。

Git 身份包括 HEAD 以及所选 tracked/untracked 文件的有序 manifest，记录类型/模式、字节数、SHA-256、删除项和保存的范围/排除策略。Dirty/status 字符串或单独 HEAD 不足以标识候选。非 Git 使用整个已声明验证范围内的显式根目录相对 manifest，并记录相同文件事实。拒绝路径逃逸、symlink 遍历、不可读文件、大小写歧义冲突及不稳定读取；记录排除项，不能暗示整个工作区已验证。文件哈希支持二进制身份，但不承诺文本提取。在 admission 限制内持久化足够的来源/候选材料，以满足已声明验证及 replay；缺失内容是显式限制，不能从已变化文件重建。

Dispatch 前及接受验证或使用质量证据前立即观察身份。任何变化都使 audit 失效，需要新候选版本及重新验证。反复变化或无法检查范围时以 `incomplete` 结束。质量命令证据绑定候选摘要、命令策略及实际执行结果；失败或缺失的检查不能变成 pass。只读验证只能执行现有 host 批准、且策略允许该范围的质量操作；来源修改使候选失效。

仅修复 audit 的 rework 在同一身份上重跑 Auditor。实施/范围缺陷可在决策 gate 保留的 rework 额度内返回更早的只读规划，但本 verification run 绝不能进入 Headsman、Ralph 或 Integrator。写入需要新的 implementation run、精确的 host baseline 及所有者 Gate C 批准。现有批准不能转移到已改变摘要或新 run。`verified` 仅表示已声明范围与条件得到检查，不代表软件或所有声明普遍正确。

### 每次实际模型调用前预留

在 admission 持久化正安全整数限制：逐请求总输入、包含 reasoning 的输出、每个子 agent 累计输出，以及 run 总 token 额度。Run 预算涵盖全部 Conductor 所属 specialist、critic、Auditor、Arbiter、rework 与嵌套子 agent 模型调用，通过可信子 agent 身份归属。创建 run 前分类 intake 的父调用，以及无关任务调用单独报告，不在该上限内。拒绝无法归属的后代 dispatch；不得称其为整个账户账单上限。

子 agent 激活前，通过 host 作用域监听器把策略绑定到预留子 session ID；label 或模型参数不能建立成员身份。Provider 必须支持预留身份、可观察的逐尝试 preflight/usage，以及包含 reasoning 的输出强制限制。无法满足这些要求的远程或嵌套 dispatch 在启动前拒绝；不得把工具 contribution 回调改作未记录的生命周期 hook。

输入上界覆盖完整冻结 route 请求，而非仅文本。通用逐实际尝试 preflight 位于 [dsh-llm-retry](../../../../packages/llm/llm-retry/src/index.ts) **之下**，在每个 adapter 完成 route 转换后、实际传输前执行。[DeepSeek](../../../../packages/llm/llm-deepseek/src/adapter.ts) 在最终 payload 构造后、每次 `fetch` 前执行；[pi-ai](../../../../packages/llm/llm-pi-ai/src/adapter.ts) 必须覆盖惰性 `streamSimple` 下的每个实际 provider 请求，包括 SDK 内部重试。若只包裹 `streamSimple` 而不能观察序列化/每次尝试，则不够；该 route 不能通过 G0。

回调确定 cap、冻结精确请求、预留/flush，并在传输前记录非秘密有效尝试参数、请求/输入引用及 serializer/哈希来源。不能静默改写已记录有效请求。提议通用逐尝试请求元数据：旧聊天 reader 可忽略 envelope，但 v6 预算 replay 必须有引用证据；前置 PR 声明 event type、重新生成 catalog 并更新两个 SDK 投影。现有 `agent/request` config 和外层 `llm/stream` 不能替代它。请求文本可由已有输入日志及显式有效字段重建；绝不记录授权 header 或 key。G0 证明日志和上界对应同一冻结请求。

预算 route 初始设置 provider `retryPolicy.maxRetries=0`，拒绝 `always`，禁用 SDK/网络重试，包括 pi-ai provider 选项。其他 retry plugin 仅在传输回调为每个实际发送创建新尝试序号、预留、有效请求记录及结算时才允许。dsh-llm-retry 恢复不能绕过它。已 dispatch usage 未知时以 `incomplete` 结束，不隐藏重试。无密钥 fake-transport 测试统计跨 plugin/SDK 重试的实际发送；配置名不能证明重试已关闭。核心 hook 从不导入 Conductor。

在 host 的每 run 串行锁内分配唯一 call ID 和持久预留，并在任何 provider dispatch 前 flush。Call ID 绑定子 session、turn、step 及尝试序号；同一步重试使用新序号。预留 `I` 输入 token，加上 `O = min(请求输出限额, 子 agent 剩余输出, run 剩余额度 − I)`。没有正数 `O` 就不 dispatch。原子性限于所属进程；跨进程安全仍需要独立 review 的 #51 单写锁。

在一个 preflight checkpoint 中原子持久化预留及 `dispatch_authorized` 意图，再在第二个 checkpoint 中结算为 `settled` 或显式 `unknown`。授权不证明远端收到请求。预留后、传输前崩溃仍保守视为未解决；缺少独立 dispatched 标记不允许退款。父预留和有效尝试元数据都 flush 后，dispatcher 才能调用 provider；两份 session 写入之间失败仍消耗未解决预留。按 call ID 和日志来源位置只对账一次；相同 replay 不产生效果，冲突重复 usage 为错误。规范 `TokenUsage` 的 uncached input/cache-read/cache-write 相互独立；三者相加得到输入，再加一次包含 reasoning 的输出。Reasoning 是子集，不额外扣账。缺失 cache 字段仍为未报告；释放未用预留前，adapter 必须证明报告的总输入完整。实际报告 usage 与保守扣账分别保存。

未知/无效 usage、带未解决预留的 crash、缺失结算证据或 adapter 超额，至少消耗预留，披露更大的已观察 usage，并以 `incomplete` 结束。不自动 redispatch，不以假定零值退款，不因所有者继续而重置预算，也不能把预留复用于新调用。除非每次实际尝试都有独立持久预留及 usage，否则禁用 provider/网络重试；middleware 重试不能隐藏在单一账目后。现有子 agent 输出限制及 critic 额度引用同一批已结算调用，不重复相加输出。Resume 前从已结算 usage 和保守扣账的未解决调用重建子 agent 剩余输出。

### Checkpoint 增长与所选限制

[无内容大小估算](2026-11-11-conductor-v6-checkpoint-estimate.json)使用保留的[首次](https://github.com/Biyocon/biyocon-harness/blob/5b3e4d7c8fd7ddfc5f84c6d8826c0e9bcd2f3fe5/scripts/conductor-cost/results/2026-11-11.json)和[后续](https://github.com/Biyocon/biyocon-harness/blob/5b3e4d7c8fd7ddfc5f84c6d8826c0e9bcd2f3fe5/scripts/conductor-cost/results/2026-11-11-guidance.json)研究：606 次调用，47 次 parent 调用在 run ledger 之外，559 条预算项，1,116 条文件系统结果项，145 个已有 workflow checkpoint，24 次尝试中有 23 个实际 run。错误结果保留元数据，但不建立已检查证据。

此离线模拟使用假设元数据/opaque ID，并在每个模拟 checkpoint 复用各 run 最大的已观察 v5 record。报告 token 数只用于数字字段大小，不是已证明预留。来源及公开实验原始 session 保持本地且未变。Node 24.13.0 将每次 flush 的 checkpoint 压缩为独立、带校验和、默认级别的 Zstandard frame，匹配后端追加 framing，不使用跨 frame 字典。

| 保留研究总计指标 | 估算 |
|---|---:|
| 已结算预算条目，UTF-8 JSON | 684–703 字节；均值 695 |
| 检查条目，UTF-8 JSON | 446–499 字节；均值 482 |
| 每调用三个 checkpoint 加 workflow：数量 / 原始 / zstd | 1,822 / 372,710,753 / 39,108,844 字节 |
| 所选每调用两个 checkpoint 加 workflow：数量 / 原始 / zstd | 1,263 / 259,851,095 / 27,342,097 字节 |
| 每个实际 run 所选 checkpoint 数 | 27–101；均值 54.91 |
| 每个实际 run 所选 zstd checkpoint 字节 | 357,020–3,565,781；均值 1,188,787 |
| 最大模拟完整编码 checkpoint | 424,138 字节 |

每个实际调用选用两个必需完整 checkpoint：preflight 预留/dispatch 意图，以及最终结算。检查更新从已有 tool-result 来源合并至下一 preflight/workflow checkpoint，不按 token、usage chunk 或工具结果逐项 checkpoint。估算保留 145 个 workflow checkpoint；不能削弱 crash 记账。所得 23 个 run 合计 zstd checkpoint 为 26.08 MiB，不是未来完整 v6 磁盘用量。其他新 claim/identity 字段、子 transcript 和通用 attempt event 未计入；每尝试元数据另允许最多 2 KiB。压缩效果及未来 payload 可能不同。

提议经验证、保存在 admission 的 Config 默认值：每 run 256 次调用、4,096 检查条目、每 ledger 条目 2 KiB、每 checkpoint 合计 ledger 512 KiB、完整编码 checkpoint envelope 8 MiB、每 run 累计未压缩 checkpoint 64 MiB。本模型最大合计 ledger 为 74,536 字节，每 run 累计为 39,125,379 字节。Dispatch 前为结算和终态 incomplete 预留容量；达到任一限制时在继续花费前明确结束，不丢弃/裁剪 ledger 历史。这些提议存储/风险敞口限制不是价格节省或冻结的 v6 常量；G0 和设计 review 必须用完整 schema 再确认。

### 检查记录与 incomplete 结果

已 admit capture 的成功返回区间记录 material ID/哈希、精确行区间及 tool-result 来源。搜索分页记录不可变 snapshot ID/摘要、cursor 与显示/总数；返回命中是搜索观察，不证明读过完整文件。工作区读取携带观察到的候选摘要/版本，否则明确为临时信息。错误、截断/未返回分页及未读文件不计为已检查。模型选择解释明确归属于模型，不能虚构为 host 事实。Auditor 在同一 run 预算约束下仍能访问完整已 admit 证据。

终态 `incomplete` 记录原因、实际/保守扣账/预留/限额及明确遗漏范围。它不能成为完整 producer 候选、已接受报告或 GO，也不能在同一耗尽 run 中 resume。所有者重新请求的新 run 有新 ID 与显式新额度，绝不重写旧结果。UI 和 timeline 显示 **“Ufuldstændig — ikke færdigverificeret / Incomplete — verification unfinished”**，附带数量和遗漏。预算限制控制风险敞口，不证明节约价格。[#106](https://github.com/Biyocon/biyocon-harness/pull/106) 的两项公开研究尚未证明 A 阶段稳定净节约；预算验收不得隐藏失败或昂贵试验。

### 交付与包所有权

共享状态/解析/哈希/记账位于 `packages/conductor/conductor`；dispatch/guard/材料捕获位于 `packages/conductor/tool-conductor`；可信角色资源/preset 位于 Conductor；呈现位于其 UI 插件。任何通用 preflight/输入上界例外都在[核心依赖清单](../architecture/2026-11-05-conductor-core-dependencies.md)记录文件、理由及实际 PR 号。核心保持不依赖 Conductor。SDK 工作投影现有通用 checkpoint/tool 结果；新增事件或循环生命周期时更新两个 SDK 的预期输出并重新生成 catalog。

使用一个 integration branch 和可 review commits。不得 merge 对 v6 的部分解释：要么一个完整 PR，要么独立安全的通用前置 PR，之后再提交完整格式 integration PR。v5/更早 Conductor 记录变为不可用，不迁移，但通过 #79 可用性处理仍可打开其聊天历史。使用保存记录时严格验证；打开/replay 隔离失败，不回退到猜测的 run。不单为 ledger 字段增加 Conductor event type。通用逐尝试请求元数据是单独 review 的前置项：旧聊天读取可忽略 envelope，但 v6 使用必须具有有效引用元数据。无关未知 required event 保持通用严格行为。

## 考虑过的替代方案

**每个 issue 单独升级 v6。** 拒绝：所有者要求唯一 schema 负责人及唯一经 review 含义。Feature flag 不能重新解释已持久化 v6 字段。

**完整不重叠报告分段。** 可保留字符覆盖，但不能证明语义完整；精确引用声明减少结构开销，同时保留 Auditor 独立遗漏检查。之前 520–600 对 800–1,200 个 producer token 的估算仅为示例，不是测量或节约承诺。

**尽力而为预算或历史裁剪。** 字符估算、易失计数及 dispatch 后预留无法强制提议的额度。历史裁剪保持禁用，除非独立公开真实模型价格研究包括丢失 cache 命中及 recall 成本。来源限长和更便宜模型评估保留独立范围。

**Verification 修复复用 Gate C 权限。** 拒绝：验证已有工作绝不授权新写入。新建 implementation run 保留显式所有者控制。

## 验收条件

- 冻结 schema/版本前通过 G0：两种候选上界与精确 route usage 比较，证明 adapter 级重试/日志；付费校准前取得所有者批准。
- 解析/篡改测试涵盖每个必需分组、不可能转换、过期/外来身份、超大数据、无效预留算术及 v5/不可用历史隔离。全部 fixture 为合成数据。
- 声明：缺失/重复/重叠引用、遗漏重要陈述、循环前提、current-request 洗白、错误来源区间、模式切换、嵌入指令及缺失/错位标签均正确失败。通过真实装配测试有来源严格性、无来源接受及 Auditor 无关来源降级，包含已记录理由、整份报告标签、不变来源历史及受限后续 dispatch。
- Verification：Git dirty/untracked/deleted 与非 Git 候选、捕获/检查/audit 期间变化、cold resume、只读修复及拒绝写入/GO/批准转移，使用真实文件系统和已批准质量路径。
- 记账：并发预留、重试序号、dispatch/结算前后 crash、重复/冲突 usage、缺失 cache 字段、reasoning 包含关系、provider 超额、后代归属及耗尽 rework/continuation，不得产生免费调用或重复扣账。证明不支持 provider 在 dispatch 前失败。
- Keyless 可运行示例涵盖标注报告、带延迟 context/steering 的终态工具呈现、verification 入口、rework/resume 与 incomplete 输出。两个 SDK 投影及真实 preset GUI/GIF 证据保留规范标签、数量及不可用历史。真实模型公开试验报告完整价格及质量，包括失败；所有者 app/home 不受影响。

## 风险

语义遗漏、重要性与来源支持仍由模型判断。保守 preflight 可能拒绝有用工作，违规 provider 仍可能单次超额；账本披露该事实，不承诺预付账单控制。Checkpoint 数字是大小模拟，不是已测 v6 或完整日志预测；完整 schema 必须重新验证提议限制。#51 实现前跨进程写入仍不安全。新的通用 request hook 与输入上界能力是须独立审查的计划依赖，不构成向核心加入 Conductor 逻辑的许可。仅在此合并设计得到 review 且所有者下达任务后开始实现。
