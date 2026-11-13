# Agent Note: Devil's Advocate 对分析报告提出质疑

Status: implemented

[English](2026-10-28-conductor-analysis-critic.md) | 中文

## 问题

早期分析可在 Auditor 和 Arbiter 审查生产者报告后即可被接受，但没有独立质疑其推理。Auditor 核验事实及文件、行号引用；这并不能证明优先级、备选方案、风险取舍或建议由证据推出。所有者报告，CON-2026-0687（CustomAgents）和 CON-2026-7660（biyocon-harness）均未经过 Devil's Advocate 批评而获得 Arbiter 接受。两次运行各角色的报告 token 消耗依次为 Detective 303K/378K、Strategist 150K/138K、Auditor 165K/196K、Arbiter 30K/26K。这些是所有者报告的观察，并非重新回放的会话；不附带任何私有会话内容。

在 [biyocon/master 45d316f](https://github.com/Biyocon/biyocon-harness/tree/45d316f852a7ad104375e07a148a48ca67f3b730)，[admittedRoute 与 reportProducer](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/intake.ts#L159-L179) 曾将 Detective 入口的 recommendations 路由为 Detective → Strategist → Auditor → Arbiter，而 answer 曾走入口角色 → Auditor → Arbiter。Devil's Advocate 当时可作为入口 C 的报告生产者，但不额外批评另一生产者的报告。[driveAnalysis](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/analysis.ts#L153) 驱动了这些只读阶段。[recordGate](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/state.ts#L235) 仅对 implementation 的 Gate C pass 要求已批准的执行基线；[parseAnalysisState](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/analysis-persistence.ts#L14) 拒绝分析记录携带执行权限。该基线的记录格式是 [v4](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/state.ts#L35)。已实现的 [intake 与报告完成说明](2026-10-25-conductor-intake-and-report-completion.md)记录准入；本决策记录新增的批评。

## 决策

所有分析运行都必须经过 Devil's Advocate 批评，不提供静默跳过选项。保留七个角色身份以及所需的 intake/准备步骤。六种已接纳组合按下表路由；当 Devil's Advocate 是入口角色时，Gate C 分别记录 `producer` 与 `critic` 两次事件。分析总是跳过 Gate D（Headsman）和 Gate F（Integrator）。

| 入口 | 交付物 | 生产者及必要准备 | 批评者 | 事实核验 | 决定 | 跳过的 gate |
| --- | --- | --- | --- | --- | --- | --- |
| Detective | recommendations | Detective（A）准备范围；Strategist（B）生产报告 | Devil's Advocate（C） | Auditor（E） | Arbiter（G） | D、F |
| Detective | answer | Detective（A） | Devil's Advocate（C） | Auditor（E） | Arbiter（G） | B、D、F |
| Strategist | recommendations | Strategist（B） | Devil's Advocate（C） | Auditor（E） | Arbiter（G） | A、D、F |
| Strategist | answer | Strategist（B） | Devil's Advocate（C） | Auditor（E） | Arbiter（G） | A、D、F |
| Devil's Advocate | recommendations | Devil's Advocate（C，producer） | Devil's Advocate（C，critic） | Auditor（E） | Arbiter（G） | A、B、D、F |
| Devil's Advocate | answer | Devil's Advocate（C，producer） | Devil's Advocate（C，critic） | Auditor（E） | Arbiter（G） | A、B、D、F |

两种入口 C 交付物都使用两个全新、不同的 Devil's Advocate 子会话。类型化派发模式（`producer` 或 `critic`）、不同 child ID、尝试次数、提示、源会话及持久化输出区分两者；批评者只收到候选报告和被引用材料，不接收生产者此前的完整对话。这是工作及上下文的分离，不能宣称同一角色具有独立观点。Arbiter 必须看到这些来源信息，不能接受仅由同一生产者子会话自审的候选报告。

批评发生在 Auditor 之前。批评者判断优先级、备选方案、遗漏风险、假设和建议是否由证据支持，而不重复核对每个文件和行号。Auditor 随后核验最终候选报告中的事实和准确引用，包括从批评中吸收的事实前提。无论新候选版本源自 Gate C、Auditor 还是 Arbiter 返工，每个新版本都必须先经过新批评，再接受新审计；Arbiter 只接受最新候选、匹配的批评和审计。候选报告中的引用缺陷走 Auditor 现有 Gate E `defect: analysis` 返工，返回生产者；新候选随后再次经过批评和 Auditor。仅限 Auditor 自身报告的缺陷走 Gate E `defect: report`，对未变的候选和有效批评重试 Auditor。两条 Auditor 返工路径均计入 Gate E；批评者返工计入 Gate C。这保持批评和事实核验的分工，避免审计立即会被批评推翻的候选报告。

### 批评结果与 Gate C

专用 `AnalysisChallenge` 结构化结果包含`run_id`、`purpose: analysis`、`candidate_hash`、`candidate_version`、有序 `material_ids`、`critic_child_id`、`critic_attempt`、包含稳定 ID、严重度（`minor`/`major`/`critical`）、主张、理由与材料 ID 的 `findings`、`conclusion: holds|does_not_hold`、经过验证的 `defect: scope|plan|report`，以及有长度限制的摘要。`does_not_hold` 必须带有 `defect`，`holds` 则禁止带有该字段。运行时对已验证的内容计算批评 hash。结果不含执行基线、实现批准或命令证据。Gate C 历史记录绑定 `critic` 模式、子会话/尝试、候选 hash、批评 hash 和决定。现有入口 C 的生产者通过显式标记为 `producer`；双方不能互相冒充。存在尚未解决的 major/critical 发现时，`holds` 自相矛盾，必须拒绝。

验证拒绝外部 run、未知材料 ID、过期候选版本/hash、重用的子会话或尝试、不匹配的派发模式、重复或矛盾的批评、同一 hash 下变化的发现内容、顺序错误的 Gate C，以及缺少匹配候选/批评/审计 hash 的 Arbiter 决定。缺失或禁止出现的 `defect`、生产者是 Detective 时的 `plan` 缺陷，或目标违反已接纳路线及类型化生产者/批评者顺序的缺陷，均使结果成为格式错误。格式错误的批评在批评者阶段视为报告验证失败，绝不合成为 `holds`。运行时在派发下一阶段之前持久化候选 → 批评 → 审计 → Arbiter 的精确关联；回放验证相同因果顺序，并拒绝部分 checkpoint 或矛盾记录。批评 checkpoint 前崩溃不能把未记录的结果当作通过；重启只恢复持久化阶段，派发状态不明时停下等待所有者审查。

`CONDUCTOR_RECORD_FORMAT_VERSION = 5` 为持久化分析批评定义完整含义。每个运行都必须有 `analysisChallenges: CapturedAnalysisChallenge[]`（实现运行为空）；每条记录保存已验证结果、运行时计算的 hash、候选 hash、批评子会话 ID 和尝试次数。每个 v5 分析候选还保存类型化 `material_spans`（`material_id`、首尾均包含的 `start_line`/`end_line`），用于其引用的已捕获材料；host 在构造批评输入前根据已接纳材料的 hash 验证这些区间。分析 Gate C 历史区分 `mode: producer|critic`；成功的生产者记录绑定候选 hash，批评记录绑定该候选、批评 hash 与子会话/尝试。分析 `ReportDecision` 除候选及审计 hash 外还必须有 `challenge_hash`。这些 v5 字段使生产/批评事件、回放顺序和 Arbiter 接受条件明确。v4 没有批评来源，按现有不支持格式的错误拒绝，不提供迁移或兼容层。仅实现用途的 v5 记录保留当前权限规则。[#30 第二阶段](https://github.com/Biyocon/biyocon-harness/issues/30) 必须使用下一个单调递增版本（若直接跟在 v5 后则为 v6），不能赋予 v5 新含义。

### 返工、所有者与权限

经过验证的 `does_not_hold` 记录批评者 Gate C 返工。只有类型化 `defect` 决定目标：`scope` → Detective、`plan` → Strategist、`report` → `reportProducer(admission)`。生产者是 Detective 时 `plan` 无效；运行时拒绝现有前置路线不允许的目标，绝不根据自由文本推断缺陷或目标。所选路径遵循现有前置规则及类型化模式顺序，包括入口 C 在同一 gate 的生产者与批评者；新的候选版本/hash 随后必须经过新的批评子会话和审计。有效批评中的 `report` 返工返回生产者，区别于格式错误的批评报告留在批评者阶段重试；运行时用不同的类型化转换表示这两种情况。格式错误的批评属于批评者的报告错误：驱动器记录 Gate C `defect: report`，针对同一候选派发新的批评子会话/尝试，不重跑生产者。它消耗一次 `maxReworkPerGate` 的 Gate C 返工额度，不消耗 Gate E 或所有者重新评估额度。同一运行的 Gate C 预算也计入实质性批评返工，以及入口 C 的生产者返工；新候选不会重置预算。当前可配置的默认值为两次返工，第三次 Gate C 返工请求连同未解决发现升级，不再派发子会话。Gate A/B/E/G 的计数独立。外部/过期身份或权限违规则立即关闭并升级。严重的安全或权限发现立即升级并说明原因；可修复的重大问题走返工。任何结论都不能静默跳过批评。

经过验证的实质性批评耗尽 Gate C 自动返工额度时，门禁记录保留类型化缺陷及目标，运行停放等待所有者问题。`answer_continue` 消费精确的所有者计划，继续该已验证目标，在 Auditor 之前生成新候选并重新批评，且不重置 Gate C 预算。批评者子会话启动后失败时，运行时保存终止性 Gate C 权限阻塞检查点，其中包含子会话 ID、运行级尝试编号及已知 token 用量；既不把失败当成格式错误的批评，也不提供所有者引导的修复。创建子会话之前启动失败，则不记录子会话或尝试。

运行时复用 [#37 的所有者 ledger 与续行机制](2026-10-30-conductor-owner-escalation-resumption.md)：现有 question/answer/consumed/rejected ledger 保存精确的 run、候选/批评 hash、gate 历史索引、精确子会话尝试，以及所需问题。`maxOwnerReassessmentsPerGate` 独立受限。它记录必需的 `conductor/owner-question-created`、`conductor/owner-response-recorded`、`conductor/owner-response-acknowledged`、`conductor/owner-continuation-consumed`、`conductor/owner-terminal-rejection` 事件及所有者卡片 `approve`、`reject`、`answer_continue`（Godkend / Afvis / Svar og fortsæt）。只有存在经 host 验证的具体方案时才提供 `approve`；分析的回答或获批准的澄清只能触发一次只读重新评估，绝非执行批准。所有者回答不能创建执行基线、批准实现、重置 Gate C 返工次数，或进入 Headsman、Ralph、Integrator、closeout。要实施建议，必须另开实现运行并取得相应批准。

### 输入、费用与呈现

批评者只收到最新候选报告、内容 hash/版本、验收标准、有长度限制的材料引用索引及确定性摘录。候选报告的类型化材料区间标识已捕获材料 ID 和首尾均包含的行范围。运行时而非模型根据不可变的 admission 捕获及其 hash 验证每个区间、选取准确行、执行 `maxCriticInputTokensPerAttempt` 上限，并在派发前将准确摘录与完整模型可见请求记入子会话日志。缺失、越界或超预算的区间会阻止批评派发，不会静默截断证据。不会回放 Detective 的仓库探索或完整子会话对话。Intake 在分析准入前拒绝图片附件；图片分析需要独立 issue 和设计。批评者只拥有 `structured_output`；不提供 `read`、`read_image`、`grep`、`glob`、write、edit、shell 或其他文件工具。[ToolRestriction](../../../../packages/conductor/tool-conductor/src/capability.ts) 只能按工具名称过滤，不能按材料 ID 限制路径；运行时选取摘录避开这一缺口。批评结果和 Gate C 状态写入 checkpoint；请求日志与已捕获材料 hash 可重建批评者看到的全部内容。

规范的 [Devil's Advocate 角色指令](../../../conductor/roles/03-devils-advocate.md) 与 [conductor-specialist skill](../../../skills/conductor-specialist/SKILL.md) 在现有 `producer` 模式之外定义类型化分析 `critic` 模式。在批评模式下，角色返回 `AnalysisChallenge`：绑定候选的结论、可证伪的推理发现、备选方案、遗漏风险及材料 ID；不生产替代候选，也不审计引用。两份规范文件在可解析的元数据中声明支持的分析模式；preset 验证检查其中的 `critic`，不从散文推断。[source launch](../../../../apps/cli/scripts/source-launch.ts) 按 #25/#59 在每次启动时重新生成安装的 skills。[preset 验证](../../../../packages/conductor/conductor-presets/src/index.ts) 拒绝缺少批评模式的角色或 specialist skill，即使资产文件存在，也不能挂载过时的仅生产者指令。

模型不可见的 `conductor/child` 事件携带角色、尝试及 gate；类型化派发/阶段数据增加生产/批评模式和精确子会话绑定，供 EN/DA 界面显示。[#56](https://github.com/Biyocon/biyocon-harness/issues/56) 负责浏览器标签和面包屑名称。新子会话不继承先前 gate 标记；界面以文字说明 `holds`/`does_not_hold` 或等待/升级状态，不只依赖颜色。 宿主按批评哈希、候选哈希、子会话 ID 和运行级批评尝试匹配，将完整的已验证批评及其摘要哈希复制到精确子会话的 gate 事件中。该事件在检查点前追加，两者通过同一次 flush 持久化。投影在发布视图前验证摘要哈希、发现的语义以及运行/子会话/尝试/结论关联。目录将摘要、主张和理由显示为纯文本，包括看似 HTML 或 Markdown 的内容；严重程度和未验证结果状态使用英/丹本地化文字。摘要与发现既属于可见内容，也属于树行的无障碍名称。原始模型输出不能作为这些发现的来源。

所有者报告的两次运行在列出的四个角色上分别消耗 648K 和 738K token。一次受限批评预计另耗 20–40K token，约占这些总量的 3–6%；两次返工可产生三次批评（额外 60–120K token），尚不包含生产者重跑。经过验证、可在 `cordis.yml` 覆盖的 `tool-conductor` Config 字段包括`maxCriticInputTokensPerAttempt`（默认 24,000）、`maxCriticOutputTokensPerAttempt`（默认 16,000，包含服务商报告的推理输出）和 `maxCriticTokensPerRun`（默认 120,000，统计服务商报告的全部输入、输出及推理 token，避免重复计数）。校验为正安全整数，且运行总限不低于已配置的每次输入与输出上限之和；无效 preset 配置在加载时拒绝。派发前预留该总额，并要求服务商的输出上限包含推理 token（否则拒绝用该服务商派发批评）；逐次记录实际用量，在用量缺失或超限时阻塞，并在剩余额度不足以容纳下一次尝试时以已消耗、预留和上限 token 数终止运行，不提出无法奏效的所有者问题。三个上限保存在准入时的运行记录中，部署 Config 变化不会改变该运行；缺失的用量按完整预留额度计费。派发逻辑不硬编码任何上限。批评是每次分析运行的必经步骤。未来如引入退出选项，必须按运行明确选择并记入日志，不能作为隐藏配置开关。[#58](https://github.com/Biyocon/biyocon-harness/issues/58) 负责降低 Detective 的消耗；本决策不扩大 Detective 输入，也不允许第二轮完整仓库探索。

## 考虑过的备选方案

**批评放在 Auditor 之后。** 它会重复检查引用，或在要求新候选报告时使昂贵的审计失效；先批评再审计更省资源，并保持职责分明。

**由 Auditor 单独承担批评。** Auditor 已负责事实和引用核验；与推理挑战合并会掩盖失败环节，无法弥补当前缺口。

**可选或静默跳过批评。** 这允许已接受的分析绕过所有者要求的角色，使重启语义依赖未记录的选项。强制批评具有可见 token 成本和稳定路由。

**把入口 C 的第二个 Devil's Advocate 子会话称为完全独立。** 新会话和独立模式能阻止同一子会话自审，却不能让相同角色/模型变成另一门独立专业；来源信息须说明此限制。

## 验证

浏览器 snapshot 等待由 descriptor 支持的待评估 critic 行；报告完成的分析还等待 Arbiter 完成行。主机 checkpoint 与浏览器目录的数据加载有各自的完成时刻。

回归测试暂缓首次包含 Arbiter 的真实目录响应，并验证两种语言下都必须等浏览器显示 Arbiter 完成行后，才能获取最终稳定 snapshot。

接受报告必须绑定最新候选、已验证批评结果、精确批评子会话及尝试、独立审计和 Arbiter 决定。每个新候选都须重新批评和审计。持久回放保留此顺序、已消耗的 Gate C/E 与所有者预算，以及分析的只读权限；所有者回答不能重置预算或授权实现。

组装后的应用在实时更新和重新加载时保留每个子会话的身份与判定。英/丹文字明确模式、待评估或升级状态、结论和发现的严重程度，不依赖颜色。摘要、主张和理由以纯文本显示，来自绑定该子会话的已验证批评结果；原始模型输出或较早尝试都不能提供这些内容。

可运行示例记录和两种 SDK 投影保留相同的记录事实。显示变化不改变模型请求、权限或无关 SDK 记录。已构建和打包消费者与源码启动遵守相同的来源绑定和只读要求。

## 后果

增加批评者会增加延迟和 token，返工时尤其如此；受限输入、用量上限和明确的所有者停止可防止成本静默上升，但不会降低 Detective 已有消耗。入口 C 的生产者和批评者共用角色/模型，因此运行时保证会话和证据绑定分离，不能保证独立专业判断。v4 运行不能在 v5 下继续；预发布拒绝是有意选择。该路线不改变 #30 第一阶段行为或实现授权。
