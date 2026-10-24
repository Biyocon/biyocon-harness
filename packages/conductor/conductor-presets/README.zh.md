# @deepseek-ai/dsh-conductor-presets

[English](README.md) | 中文

此包为[随附的应用预设](../../../apps/cli/config/agent-presets/conductor/agent.cordis.yml)安装并验证 Conductor 的角色与协议 skill（技能）。此包还导出 [Conductor 工具](../tool-conductor/README.md)使用的正典角色目录名与阶段到 skill 的映射元数据。

## 安装与配置

CLI（命令行界面）构建将[正典角色目录](../../../.agents/conductor/roles/profiles.yml)和[仓库 skills](../../../.agents/skills/README.md)中的 `conductor-*` 包复制到应用预设生成的 `skills/` 目录。这些副本是分发产物，不是额外的人工维护源文件。在源代码检出中挂载 Conductor 预设前运行 `pnpm run build`；发布的 CLI 包含这些生成文件。

| 配置 | 必填值 |
|---|---|
| `rolesDirectory` | 包含七个角色 Markdown 文件及其资源的绝对安装目录。 |
| `protocolDirectory` | 包含 `conductor-*` 协议 skill 目录的绝对安装根目录。 |

应用通过 `!!js` 相对于预设的 `baseUrl` 解析这两个路径。预设的私有 `skills` 注册表与 Conductor 工具共享，不与任务的项目或用户 skill 目录共享。提供方直接在宿主上读取这些随附安装文件，不经过任务文件系统。加载会在预设发布 agent（智能体）之前拒绝相对目录、缺失或格式错误的必需 skill，以及空指令正文。提供方注册随预设一同释放。

父级角色指令要求 agent 在 Conductor 报错或受阻时报告结果并停止，不得自行实现任务。父级的文件系统工具仍然可用；此指令不能代替执行器权限。[安装决策](../../../.agents/notes/implemented/bug-fix/2026-10-24-conductor-installed-skills.md)说明分发与所有权。

## 模型体验

间接通过 [Conductor 工具](../tool-conductor/README.md)影响模型：该工具将选定的角色与协议正文注入全新的专家请求。

#### KV Cache 影响

修改随附指令会改变对应专家请求的前缀；安装或验证这些指令不会向父级对话添加消息。

## 已知限制和后续工作

- 修改正典角色或协议后，必须通过 CLI 构建重新生成安装产物；运行中的预设不监听这些文件。
- 挂载验证只确认指令可用，不保证模型遵守指令；能力限制由阶段执行器负责。
