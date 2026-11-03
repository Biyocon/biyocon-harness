# @deepseek-ai/dsh-conductor-presets

[English](README.md) | 中文

此包为[随附的应用预设](../../../apps/cli/config/agent-presets/conductor/agent.cordis.yml)安装并验证 Conductor 的角色与协议 skill（技能）。此包还导出 [Conductor 工具](../tool-conductor/README.md)使用的正典角色目录名与阶段到 skill 的映射元数据。

## 安装与配置

CLI（命令行界面）构建将[正典角色目录](../../../.agents/conductor/roles/profiles.yml)、其[共享协议](../../../.agents/conductor/README.md)和链接的模板，以及[仓库 skills](../../../.agents/skills/README.md)中的 `conductor-*` 包复制到应用预设生成的 `skills/` 目录。这些副本是分发产物，不是额外的人工维护源文件。每次 `pnpm dsh` 源码启动都会在 profile 启动前准备这些资源，因此下一次启动可使用已完成的正典编辑，无需单独构建。字节不变时不写入。变更文件暂存于活动目录旁，再逐文件原子替换，包括 Windows 上普通 Node 读取者仍打开文件的情形；最后删除过期文件。生成错误会停止启动，必需内容校验仍会拒绝预设挂载。现有预备定义不热重载。发布的 CLI 包含生成文件，不需要源码检出。[发布决策](../../../.agents/notes/implemented/bug-fix/2026-11-01-conductor-source-launch-assets.md)说明并发与失败语义。

| 配置 | 必填值 |
|---|---|
| `rolesDirectory` | 包含七个角色 Markdown 文件及其资源的绝对安装目录。 |
| `protocolDirectory` | 包含 `conductor-*` 协议 skill 目录的绝对安装根目录。 |
| `sharedProtocolFile` | 包含角色 Markdown 所引用共享角色协议的绝对安装文件。 |

应用通过 `!!js` 相对于预设的 `baseUrl` 解析这些路径。预设的私有 `skills` 注册表与 Conductor 工具共享，不与任务的项目或用户 skill 目录共享。安装文件直接在宿主上读取，不经过任务文件系统。加载会在预设发布 agent（智能体）之前拒绝相对路径、缺失或格式错误的必需 skill，以及无法读取或正文为空的指令。验证后的角色成为预备定义，其前方附上完整共享协议作为参考；专家使用分派和结构化 schema，而不是从任务工作区读取仓库链接。注册随预设一同释放。

Devil's Advocate 角色和 `conductor-specialist` skill 均要求 `metadata.analysisCritic` 包含 `dispatchMode: critic` 及非空 `instructions`；缺失或无效的批评模式会使预设挂载失败。批评指令与 Markdown 中的报告生产者正文分离，不会注入当前分析分派。相应路由启用后，类型化的批评分派才会选用它们。[指令决策](../../../.agents/notes/implemented/feature/2026-11-03-conductor-analysis-critic-instructions.md)记录了这种分离。

应用启用工具的 `routeTasks` 策略：父级的每项新任务都先调用 `conductor`，包括未提及该模式的分析任务。分派之前，其他工具既不向模型展示，也会被执行器拒绝。返回任何结果之后（包括 Arbiter GO），父级的所有工具仍被隐藏并拒绝执行；只能报告最终结果，不得自行调查、实现任务或自动重新分派。专家仍可读取工作区指令，但这些指令不能绕过执行器策略。待答所有者问题将新用户任务保留在可见队列，不开放普通工具；只有宿主预留的同运行继续执行才能推进。没有待处理交互时，下一项用户任务仅允许再次分派 Conductor。[路由决策](../../../.agents/notes/implemented/bug-fix/2026-10-25-conductor-mode-routing.md)说明该策略；[安装决策](../../../.agents/notes/implemented/bug-fix/2026-10-24-conductor-installed-skills.md)负责指令交付。

## 模型体验

间接通过 [Conductor 工具](../tool-conductor/README.md)影响模型：该工具将选定的角色与协议正文注入全新的专家请求。

#### KV Cache 影响

共享协议为每个角色提供稳定前缀。修改它会改变全部专家前缀；修改单个角色只改变该角色的前缀。安装或验证指令不会向父级对话添加消息。

## 已知限制和后续工作

- 已完成的正典指令编辑在下一次源码启动时生效；运行中的预设不监听或重新加载安装产物。
- 已安装路径的文件与目录类型变更会在发布前被拒绝；此类资源布局变更需使用新的源码检出。不会为了类型变更提前删除活动路径。
- 挂载验证只确认指令可用，不保证模型遵守指令；能力限制由阶段执行器负责。
- 随附预设启用 Conductor 工具的 `ownerQuestions`。Web 应用提供类型化所有者问题卡片；没有用户问题提供者的部署保持可恢复问题停放，不授予权限。
