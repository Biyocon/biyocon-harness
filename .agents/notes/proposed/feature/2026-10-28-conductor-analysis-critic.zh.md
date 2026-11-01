# Agent Note: Devil's Advocate 对分析报告提出质疑

Status: proposed

[English](2026-10-28-conductor-analysis-critic.md) | 中文

## 问题

当前分析在 Auditor 和 Arbiter 审查生产者报告后即可被接受，但没有独立质疑其推理。Auditor 核验事实及文件、行号引用；这并不能证明优先级、备选方案、风险取舍或建议由证据推出。所有者报告，CON-2026-0687（CustomAgents）和 CON-2026-7660（biyocon-harness）均未经过 Devil's Advocate 批评而获得 Arbiter 接受。两次运行各角色的报告 token 消耗依次为 Detective 303K/378K、Strategist 150K/138K、Auditor 165K/196K、Arbiter 30K/26K。这些是所有者报告的观察，并非重新回放的会话；不附带任何私有会话内容。

在 [biyocon/master 45d316f](https://github.com/Biyocon/biyocon-harness/tree/45d316f852a7ad104375e07a148a48ca67f3b730)，[admittedRoute 与 reportProducer](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/intake.ts#L159-L179) 仍将 Detective 入口的 recommendations 路由为 Detective → Strategist → Auditor → Arbiter，而 answer 走入口角色 → Auditor → Arbiter。Devil's Advocate 能作为入口 C 的报告生产者，却不会额外批评另一生产者的报告。[driveAnalysis](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/analysis.ts#L153) 驱动这些只读阶段。[recordGate](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/state.ts#L235) 仅对 implementation 的 Gate C pass 要求已批准的执行基线；[parseAnalysisState](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/analysis-persistence.ts#L14) 拒绝分析记录携带执行权限。当前记录格式是 [v4](https://github.com/Biyocon/biyocon-harness/blob/45d316f852a7ad104375e07a148a48ca67f3b730/packages/conductor/conductor/src/state.ts#L35)。

## 提案

所有分析运行都必须经过 Devil's Advocate 批评，不提供静默跳过选项。保留七个角色身份以及所需的 intake/准备步骤。Detective 入口的 recommendations 走 Detective → Strategist（生产者）→ Devil's Advocate（批评者）→ Auditor → Arbiter。answer 走入口角色（生产者）→ Devil's Advocate（批评者）→ Auditor → Arbiter。入口 C 的 answer 使用两个全新、不同的 Devil's Advocate 子会话：第一个生产候选报告，第二个提出批评。类型化派发模式（`producer` 或 `critic`）、不同 child ID、尝试次数、提示、源会话及持久化输出区分两者；批评者只收到候选报告和被引用材料，不接收生产者此前的完整对话。这是工作及上下文的分离，不能宣称同一角色具有独立观点。Arbiter 必须看到这些来源信息，不能接受仅由同一生产者子会话自审的候选报告。

批评发生在 Auditor 之前。批评者判断优先级、备选方案、遗漏风险、假设和建议是否由证据支持，而不重复核对每个文件和行号。Auditor 随后核验最终候选报告中的事实和准确引用，包括从批评中吸收的事实前提。推理不成立时退回生产者，重新形成候选报告、批评和审计；单纯引用错误仍走 Auditor 现有的修复路径。Arbiter 只接受最新候选报告、有效批评和新审计的精确组合。这避免先审计随后被批评推翻的报告。

### 批评结果与 Gate C

建议专用的 `AnalysisChallenge` 结构化结果：`run_id`、`purpose: analysis`、`candidate_hash`、`candidate_version`、有序 `material_ids`、`critic_child_id`、`critic_attempt`、包含稳定 ID、严重度（`minor`/`major`/`critical`）、主张、理由与材料 ID 的 `findings`、`conclusion: holds|does_not_hold`，以及有长度限制的摘要。运行时对已验证的内容计算批评 hash。结果不含执行基线、实现批准或命令证据。Gate C 历史记录绑定 `critic` 模式、子会话/尝试、候选 hash、批评 hash 和决定。现有入口 C 的生产者通过显式标记为 `producer`；双方不能互相冒充。存在尚未解决的 major/critical 发现时，`holds` 自相矛盾，必须拒绝。

验证拒绝外部 run、未知材料 ID、过期候选版本/hash、重用的子会话或尝试、不匹配的派发模式、重复或矛盾的批评、同一 hash 下变化的发现内容、顺序错误的 Gate C，以及缺少匹配候选/批评/审计 hash 的 Arbiter 决定。格式错误的批评在批评者阶段视为报告验证失败，绝不合成为 `holds`。在派发下一阶段之前持久化候选 → 批评 → 审计 → Arbiter 的精确关联；回放验证相同因果顺序，并拒绝部分 checkpoint 或矛盾记录。批评 checkpoint 前崩溃不能把未记录的结果当作通过；重启只恢复持久化阶段，派发状态不明时停下等待所有者审查。

这改变持久化运行的含义：建议 `CONDUCTOR_RECORD_FORMAT_VERSION = 5`。每个运行都必须有 `analysisChallenges: CapturedChallenge[]`（实现运行为空）；每条记录保存已验证结果、运行时计算的 hash、候选 hash、批评子会话 ID 和尝试次数。分析 Gate C 历史必须有 `mode: producer|critic` 和精确候选 hash；批评记录还必须有批评 hash 与子会话/尝试。分析 `ReportDecision` 除候选及审计 hash 外还必须有 `challenge_hash`。这些 v5 字段使生产/批评事件、回放顺序和 Arbiter 接受条件明确。v4 没有批评来源，按现有不支持格式的错误拒绝，不提供迁移或兼容层。仅实现用途的 v5 记录保留当前权限规则。[#30 第二阶段](https://github.com/Biyocon/biyocon-harness/issues/30) 必须使用下一个单调递增版本（若直接跟在 v5 后则为 v6），不能赋予 v5 新含义。

### 返工、所有者与权限

`does_not_hold` 记录批评者 Gate C 返工，目标为 `reportProducer(admission)`；范围缺陷回到 Detective，计划缺陷回到 Strategist，并经过现有前置条件。生产者必须产生新版本/hash，随后由新批评子会话重新评估 Gate C。前两条 Gate C 返工记录消耗 `maxReworkPerGate: 2`；第三次请求记录为 Gate C 升级，并附未解决发现，不再派发生产者。Gate A/B/E/G 的计数独立。格式错误的批评消耗同一个 Gate C 报告返工预算；外部/过期身份或权限违规则立即关闭并升级。严重的安全或权限发现立即升级并说明原因；可修复的重大问题走返工。任何结论都不能静默跳过批评。

重用 [#37 的所有者 ledger 与续行机制](../../implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md)：现有 question/answer/consumed/rejected ledger 保存精确的 run、候选/批评 hash、gate 历史索引、子会话尝试和所需问题。`maxOwnerReassessmentsPerGate` 独立受限。重用必需的 `conductor/owner-question-created`、`conductor/owner-response-recorded`、`conductor/owner-response-acknowledged`、`conductor/owner-continuation-consumed`、`conductor/owner-terminal-rejection` 事件及所有者卡片 `approve`、`reject`、`answer_continue`（Godkend / Afvis / Svar og fortsæt）。只有存在经 host 验证的具体方案时才提供 `approve`；分析的回答或获批准的澄清只能触发一次只读重新评估，绝非执行批准。所有者回答不能创建执行基线、批准实现、重置 Gate C 返工次数，或进入 Headsman、Ralph、Integrator、closeout。要实施建议，必须另开实现运行并取得相应批准。

### 输入、费用与呈现

批评者只收到最新候选报告、内容 hash/版本、验收标准、有长度限制的材料引用索引及这些引用中的选定摘录。不回放 Detective 的仓库探索或完整子会话对话。仅允许对已接纳引用材料使用 `read` 和 `read_image`，另加 `structured_output`；对本次批评派发禁用 `grep`、`glob`、write、edit 和 shell。派发及使用工具时验证路径/ID；在普通 session 消息/请求头中记录精确的选定摘录及模型可见请求，在 `conductor/checkpoint` 中记录批评结果与 Gate C 状态。现有 `conductor/child` 事件已有角色、尝试及 gate；扩充类型化派发/阶段数据，加入生产/批评模式和精确子会话绑定，以便 [#56](https://github.com/Biyocon/biyocon-harness/issues/56) 从类型数据展示角色，而不是在浏览器标签和面包屑里展示派发提示及 UUID。本提案不实施 #56。新子会话不继承先前 gate 标记。Web UI 使用 EN/DA 文本展示角色、尝试及 `holds`/`does_not_hold` 或等待/升级状态，不能只靠颜色。

所有者报告的两次运行在列出的四个角色上分别消耗 648K 和 738K token。一次受限批评预计另耗 20–40K token，约占这些总量的 3–6%；两次返工可产生三次批评（额外 60–120K token），尚不包含生产者重跑。建议验证每次输入/输出上限及每次运行 120K 批评 token 的总限，包括服务商报告的推理 token；预算耗尽时明确停下并升级到所有者，不能跳过批评。每次记录用量，在默认启用前通过无密钥及服务商测试比较真实成本。[#58](https://github.com/Biyocon/biyocon-harness/issues/58) 负责降低 Detective 的消耗；本设计不扩大 Detective 输入，也不允许第二轮完整仓库探索。

## 考虑过的备选方案

**批评放在 Auditor 之后。** 它会重复检查引用，或在要求新候选报告时使昂贵的审计失效；先批评再审计更省资源，并保持职责分明。

**由 Auditor 单独承担批评。** Auditor 已负责事实和引用核验；与推理挑战合并会掩盖失败环节，无法弥补当前缺口。

**可选或静默跳过批评。** 这允许已接受的分析绕过所有者要求的角色，使重启语义依赖未记录的选项。强制批评具有可见 token 成本和稳定路由。

**把入口 C 的第二个 Devil's Advocate 子会话称为完全独立。** 新会话和独立模式能阻止同一子会话自审，却不能让相同角色/模型变成另一门独立专业；来源信息须说明此限制。

## 验收标准

- 通过真实 `conductor-installed` 示例更新 `examples/headless-agent/tests/conductor-installed.snapshot.ts`，尤其是 `conductor-intake/recommendations`、`answer`、`plan`、`rework`、`source-repair`、`criteria-rework`，以及 `examples/headless-agent/tests/fixtures/conductor-owner-snapshots.ts` 中的 Gate C/所有者场景（`conductor-owner/analysis-answer`、`analysis-unavailable`）。增加无密钥 `challenge-holds`、`challenge-rework`、`challenge-budget`、`entry-c`、`challenge-resume`、`stale-candidate` 和 `no-execution` 场景，包含预期 parent/child JSONL。验证浏览器投影的精确角色/尝试/gate 以及 EN/DA 文本。
- 单元/属性测试覆盖每种 answer/recommendations 入口、Gate C 生产者与批评者身份、两次返工和第三次升级、格式错误/严重/权限结果、各 gate 与所有者预算、过期候选/hash/材料/尝试、checkpoint 中断和 v4 拒绝。已构建/发布路径保留各自的冒烟测试；本设计 PR 不更改第一阶段行为。
- 若加入建议的类型化模式，`conductor/child` 的 SessionEventMap payload 将变化。运行两个 SDK 投影：TypeScript 的 `examples/jsonrpc-agent/tests/snapshots/` 和 Python 的 `scripts/snapshots/python-sdk-single-exe/`。当前通用 expected outputs 不含 Conductor 子会话，可能保持逐字节不变；若任一投影包含新字段，则在实施 PR 更新其 expected outputs。本设计 PR 不更改 SDK expected outputs。

## 风险

增加批评者会增加延迟和 token，返工时尤其如此；受限输入、用量上限和明确的所有者停止可防止成本静默上升，但不会降低 Detective 已有消耗。入口 C 的生产者和批评者共用角色/模型，因此本设计保证会话和证据绑定分离，不能保证独立专业判断。v4 运行不能在 v5 下继续；预发布拒绝是有意选择。本提案不包含 runtime、schema 或 #30 第一阶段改动。
