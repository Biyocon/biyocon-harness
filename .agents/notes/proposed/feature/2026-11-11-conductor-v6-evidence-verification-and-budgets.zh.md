# Agent Note: 统一 Conductor 的证据、验证与预算格式

Status: proposed

[English](2026-11-11-conductor-v6-evidence-verification-and-budgets.md) | 中文

## 问题

[#75 第二阶段](https://github.com/Biyocon/biyocon-harness/issues/75)、[#30 第二阶段](https://github.com/Biyocon/biyocon-harness/issues/30)与 [#58 B 阶段](https://github.com/Biyocon/biyocon-harness/issues/58)都需要必需的持久字段。分别分配版本会让相同格式号表示不兼容记录。引用哈希正确不等于事实有依据，Git commit 不能标识未提交工作，没有逐次调用记账的限制也无法约束并发子 agent 或披露不确定消耗。

## 提案

### 所有权与版本分配

Codex 维护唯一的 schema 及版本分配，Claude review，所有者 merge。v6 是此完整提案预留的名称，不代表已实现格式。实施前及 merge 前重新检查已合并 master；编号已占用时停止并协调重新分配。本设计 PR 不包含运行时代码、格式升级或迁移。保留 rc.7，以及 Conductor 依赖通用服务的单向关系。

本文负责合并后的未来字段与验收规则。[声明设计](2026-11-05-conductor-analysis-claim-verification.md)、[Detective 设计](2026-11-05-conductor-detective-evidence-budget.md)、[intake 决策](../../implemented/feature/2026-10-25-conductor-intake-and-report-completion.md)与[子 agent 限额决策](../../implemented/architecture/2026-11-02-reserved-child-identity-and-output-token-limit.md)保留各自独立理由及已交付行为。#75 第一阶段与 #58 A 阶段不需要 v6；其尚未合并的实施 PR 是待 review 的依赖，不能视为 master 已有行为。

### 必需的记录分组

保留现有 checkpoint 事件与 session envelope。每个 v6 run 必须具有以下经过验证的分组；按 purpose 区分的数据使用显式判别字段，不依赖含义模糊的缺失字段。

| 分组 | 必需信息 |
|---|---|
| `admission` | 不可变 purpose：`implementation`、`analysis` 或 `verification`；入口、验收条件、捕获来源、host 选择的证据模式及已解析限制。 |
| `candidateIdentities` | 仅追加的 host Git/manifest 身份、有序文件条目、遗漏、范围及摘要；活动候选 ID，纯分析则显式为 `none`。 |
| `reportVersions` | 精确候选内容/哈希、引用声明及出现位置、challenge/audit 哈希与 host 呈现。 |
| `budgetLedger` | 限额、唯一预留、dispatch 与 usage 来源、实际扣账、未解决预留及终止原因。 |
| `inspectionLedger` | 子 agent/尝试、来源身份、返回区间/分页、观察到的变化、选择与已披露遗漏。 |
| `final` | 报告/验证/实施结果，或包含原因及尚未验证范围的终态 `incomplete`。 |

Run、子 agent、候选、声明、检查及调用身份均使用 branded ID。规范序列化规定 UTF-8、仅记录序列化使用 LF、对象键排序、数组顺序不变；来源字节和报告引用绝不规范化。哈希包含域/版本前缀；子 agent、audit、presentation 哈希包含 run 及精确候选/来源身份。解析器验证引用、唯一性、无环性、计数及可达转换，不能只验证字段类型。通过经过验证的 Config 限制数量、字节及总 checkpoint 大小；在超限 checkpoint 之前拒绝 admission 或显式结束，不得静默丢弃记账。

Analysis 保存含声明的报告历史；verification 保存绑定候选的 audit/verdict 历史；implementation 保留其执行 baseline 历史。不适用分组使用 `not_applicable`，不虚构证据或批准。仅 analysis 选择两种声明证据模式。Verification 增加终态 status/stage `verified` / `verification-complete`；每种 purpose 都可结束为 `incomplete` / `incomplete`。保留现有 implementation 与 reported 终态。Resume 仅允许有效非终态转换；终态结果不可变。

### 声明与诚实的报告呈现

采用已批准的精确引用清单：唯一声明 ID、非空精确 substring、出现序号及候选哈希。Auditor 独立通读候选，寻找遗漏的重要声明和被降低的重要性；substring 匹配只证明身份。每个已提交声明都得到 `source_verified`（已 admit 来源/哈希/行）、`derived`（非空、无环的受支持前提链及推理）或 `unverified`（缺失证据）。拒绝过期身份、不存在的出现位置、不完整评估及无支持前提。`current-request`、模型记忆、单独 URL 及未 admit 的发现，无论直接还是经推导，都不能建立来源验证。

仅在 admission 除 `current-request` 外没有其他证据时，host 选择 `model_knowledge`。所有分析子 agent，包括 critic、Auditor 与 Arbiter，只获得 structured-output 能力；禁止文件/图像/搜索/web 工具及工作区/来源注入，保留可信角色指令与问题。可接受包含未验证重要声明的答案，但整份报告必须带有 **“Bygger på modelviden, ikke verificeret mod kilder” / “Based on model knowledge, not source-verified”**。新来源需要新的已授权 intake。

只要 admit 任何来源，包括无关来源，就采用 `source_backed`。任何重要未验证声明均阻止接受；附带的未验证声明不得支持结论，且每个精确出现位置都标注 **“Unverified / Ikke verificeret”**。Host 对重叠位置进行确定性呈现，并把完整标注文本绑定到候选/audit 哈希。Auditor 判断含义及来源支持，Arbiter 检查精确候选、challenge、audit 及允许的接受条件。可通过现有证据修复时使用 `revise`，关键验证无法获取时使用 `blocked`。嵌入来源/报告的指令不能选择模式或授权工具。

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

输入上界包含 system/persona、schemas、messages/history 与 provider framing。精确 route 必须在 dispatch 前提供有依据的保守输入 token 上界，并强制限制包含 reasoning 的输出；不支持的 route 在花费前失败。每 token 字符数估算不能支撑硬输入上限。通用 preflight 必须在有效 header 记录前获得最终冻结请求。现有 `agent/request` 只看到 config，看不到完整 messages；`llm/stream` 在 header 记录后才看到 messages，两者都不能单独静默重写已记录请求。Review 小型通用 prepared-request hook 与 route 所属的输入上界能力；核心类型不得导入 Conductor。

Provider 可行性是前置条件，不是已经具备的支持：于 2026-11-11 检查的[官方 token 指南](https://api-docs.deepseek.com/quick_start/token_usage/)提供近似字符比例与离线 tokenizer demo，实际 usage 来自响应；这不能证明精确部署 route 上完整 framing 请求的上界。实施预算强制限制前必须证明该能力；否则把限制提交设计 review，不能宣传硬输入保证。

在 host 的每 run 串行锁内分配唯一 call ID 和持久预留，并在任何 provider dispatch 前 flush。Call ID 绑定子 session、turn、step 及尝试序号；同一步重试使用新序号。预留 `I` 输入 token，加上 `O = min(请求输出限额, 子 agent 剩余输出, run 剩余额度 − I)`。没有正数 `O` 就不 dispatch。原子性限于所属进程；跨进程安全仍需要独立 review 的 #51 单写锁。

持久化 `reserved` → `dispatched` → `settled`，不确定时显式为 `unknown`。预留持久化成功前 dispatcher 不能调用 provider。按 call ID 和日志来源位置只对账一次；相同 replay 不产生效果，冲突重复 usage 为错误。规范 `TokenUsage` 的 uncached input/cache-read/cache-write 相互独立；三者相加得到输入，再加一次包含 reasoning 的输出。Reasoning 是子集，不额外扣账。缺失 cache 字段仍为未报告；释放未用预留前，adapter 必须证明报告的总输入完整。实际报告 usage 与保守扣账分别保存。

未知/无效 usage、带未解决预留的 crash、缺失结算证据或 adapter 超额，至少消耗预留，披露更大的已观察 usage，并以 `incomplete` 结束。不自动 redispatch，不以假定零值退款，不因所有者继续而重置预算，也不能把预留复用于新调用。除非每次实际尝试都有独立持久预留及 usage，否则禁用 provider/网络重试；middleware 重试不能隐藏在单一账目后。现有子 agent 输出限制及 critic 额度引用同一批已结算调用，不重复相加输出。Resume 前从已结算 usage 和保守扣账的未解决调用重建子 agent 剩余输出。

### 检查记录与 incomplete 结果

已 admit capture 的成功返回区间记录 material ID/哈希、精确行区间及 tool-result 来源。搜索分页记录不可变 snapshot ID/摘要、cursor 与显示/总数；返回命中是搜索观察，不证明读过完整文件。工作区读取携带观察到的候选摘要/版本，否则明确为临时信息。错误、截断/未返回分页及未读文件不计为已检查。模型选择解释明确归属于模型，不能虚构为 host 事实。Auditor 在同一 run 预算约束下仍能访问完整已 admit 证据。

终态 `incomplete` 记录原因、实际/保守扣账/预留/限额及明确遗漏范围。它不能成为完整 producer 候选、已接受报告或 GO，也不能在同一耗尽 run 中 resume。所有者重新请求的新 run 有新 ID 与显式新额度，绝不重写旧结果。UI 和 timeline 显示 **“Ufuldstændig — ikke færdigverificeret / Incomplete — verification unfinished”**，附带数量和遗漏。预算限制控制风险敞口，不证明节约价格。[#106](https://github.com/Biyocon/biyocon-harness/pull/106) 的两项公开研究尚未证明 A 阶段稳定净节约；预算验收不得隐藏失败或昂贵试验。

### 交付与包所有权

共享状态/解析/哈希/记账位于 `packages/conductor/conductor`；dispatch/guard/材料捕获位于 `packages/conductor/tool-conductor`；可信角色资源/preset 位于 Conductor；呈现位于其 UI 插件。任何通用 preflight/输入上界例外都在[核心依赖清单](../architecture/2026-11-05-conductor-core-dependencies.md)记录文件、理由及实际 PR 号。核心保持不依赖 Conductor。SDK 工作投影现有通用 checkpoint/tool 结果；新增事件或循环生命周期时更新两个 SDK 的预期输出并重新生成 catalog。

使用一个 integration branch 和可 review commits。不得 merge 对 v6 的部分解释：要么一个完整 PR，要么独立安全的通用前置 PR，之后再提交完整格式 integration PR。v5/更早 Conductor 记录变为不可用，不迁移，但通过 #79 可用性处理仍可打开其聊天历史。使用保存记录时严格验证；打开/replay 隔离失败，不回退到猜测的 run。不仅为这些字段增加新的 required session event 类型；无关未知 required session event 仍保持通用严格行为。

## 考虑过的替代方案

**每个 issue 单独升级 v6。** 拒绝：所有者要求唯一 schema 负责人及唯一经 review 含义。Feature flag 不能重新解释已持久化 v6 字段。

**完整不重叠报告分段。** 可保留字符覆盖，但不能证明语义完整；精确引用声明减少结构开销，同时保留 Auditor 独立遗漏检查。之前 520–600 对 800–1,200 个 producer token 的估算仅为示例，不是测量或节约承诺。

**尽力而为预算或历史裁剪。** 字符估算、易失计数及 dispatch 后预留无法强制提议的额度。历史裁剪保持禁用，除非独立公开真实模型价格研究包括丢失 cache 命中及 recall 成本。来源限长和更便宜模型评估保留独立范围。

**Verification 修复复用 Gate C 权限。** 拒绝：验证已有工作绝不授权新写入。新建 implementation run 保留显式所有者控制。

## 验收条件

- 解析/篡改测试涵盖每个必需分组、不可能转换、过期/外来身份、超大数据、无效预留算术及 v5/不可用历史隔离。全部 fixture 为合成数据。
- 声明：缺失/重复/重叠引用、遗漏重要陈述、循环前提、current-request 洗白、错误来源区间、模式切换、嵌入指令及缺失/错位标签均正确失败。通过真实 producer/critic/Auditor/Arbiter 装配测试有来源严格性及无来源接受。
- Verification：Git dirty/untracked/deleted 与非 Git 候选、捕获/检查/audit 期间变化、cold resume、只读修复及拒绝写入/GO/批准转移，使用真实文件系统和已批准质量路径。
- 记账：并发预留、重试序号、dispatch/结算前后 crash、重复/冲突 usage、缺失 cache 字段、reasoning 包含关系、provider 超额、后代归属及耗尽 rework/continuation，不得产生免费调用或重复扣账。证明不支持 provider 在 dispatch 前失败。
- Keyless 可运行示例涵盖标注报告、带延迟 context/steering 的终态工具呈现、verification 入口、rework/resume 与 incomplete 输出。两个 SDK 投影及真实 preset GUI/GIF 证据保留规范标签、数量及不可用历史。真实模型公开试验报告完整价格及质量，包括失败；所有者 app/home 不受影响。

## 风险

语义遗漏、重要性与来源支持仍由模型判断。保守 preflight 可能拒绝有用工作，违规 provider 仍可能单次超额；账本披露该事实，不承诺预付账单控制。完整 checkpoint 随历史增长，需要 admission/总量限制。#51 实现前跨进程写入仍不安全。新的通用 request hook 与输入上界能力是须独立审查的计划依赖，不构成向核心加入 Conductor 逻辑的许可。仅在此合并设计得到 review 且所有者下达任务后开始实现。
