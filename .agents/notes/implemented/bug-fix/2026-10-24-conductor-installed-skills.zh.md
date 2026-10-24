# Agent Note: Conductor 安装 skill 独立于任务工作区

Status: implemented

[English](2026-10-24-conductor-installed-skills.md) | 中文

## 问题

Conductor 的角色路径相对于启动目录解析，协议发现则依赖任务工作区。其他仓库中的会话无法找到 `conductor-detective`；任务文件系统的限制也可能隐藏安装文件。错误在运行开始后才出现，父级随后可能绕过专家继续执行。

## 决策

[CLI 构建](../../../../apps/cli/tsdown.config.ts)从[正典角色](../../../conductor/roles/profiles.yml)和[仓库 skills](../../../skills/README.md)中的四个 `conductor-*` 目录生成安装资源。生成的副本位于随附预设内，不纳入源代码管理。角色的相对资源与 Markdown 一同保留，以维持元数据而不增加头像行为。发布的 CLI 明确包含生成目录。

[预设](../../../../apps/cli/config/agent-presets/conductor/agent.cordis.yml)使用 `!!js` 相对于自身的 `baseUrl` 解析资源目录，并为其 Conductor 运行时创建私有 skill 注册表。[预设安装器](../../../../packages/conductor/conductor-presets/README.md)挂载通过宿主读取随附文件的文件系统提供方，并在发布 agent（智能体）之前验证全部七个角色名以及 specialist、Ralph 和 closeout 协议。任务 cwd、工作区文件系统权限、项目 skills 和用户 skill 优先级不参与这些指令的选择。缺失、格式错误或正文为空的必需 skill 会阻止挂载，并给出重新构建或安装的诊断；释放预设会移除其提供方。

父级角色指令要求报告 Conductor 错误和阻塞并停止，不得接管专家任务。这是模型行为指引，不是新的写入工具限制。[运行时决策](../feature/2026-09-11-conductor-runtime-layer.md)仍负责门禁、子级策略与授权；[角色资料资源决策](../feature/2026-10-24-conductor-role-profile-assets.md)仍负责图像关联。两项决策均未被取代。

## 曾考虑的替代方案

**相对于任务 cwd 解析源路径。** 无关仓库无法提供安装所拥有的指令，其 skill 名称也不能覆盖安装的协议。

**在配置中使用检出目录的绝对路径。** 移动或发布应用后这些路径会失效。

**在应用内维护另一套角色源文件。** 重复来源会产生漂移。生成副本有其必要性，因为 npm 无法将应用目录以外的文件打包；正典 Markdown 仍是唯一人工维护源。

**通过任务文件系统权限读取安装文件。** 这些权限管控任务数据，不管控可信安装指令。现有随附文件提供方的宿主读取路径分离这两项职责，不扩大任务访问范围。

**移除父级的写入工具。** 这是独立的能力策略决策，不是修复指令交付的必要条件。

## 后果

工具使用父 Agent 作为 scope key 选择 skills，而不是使用其 Context 对象。该 key 的预设祖先关系使安装的提供方可用于分派；任务 cwd 仅保留给有意依赖工作区进行发现的提供方。

在源代码检出中使用 Conductor 前，需要构建以准备安装资源。修改正典文件后必须重新构建；安装的提供方不监听文件。私有注册表阻止项目和用户 skills 覆盖此运行时的指令，普通父级 skill 发现仍然独立。

单元覆盖验证必需正文检查与提供方释放。无密钥的 [headless 快照](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts)将真实随附预设迁移到外部临时工作区，启动全新的 Detective，读取实际标记文件，拒绝项目协议覆盖，并在写入前有意停止。缺失资源变体验证首次模型请求之前的拒绝行为。包冒烟测试检查 CLI 打包清单中的完整资源集合及其与正典源文件完全相同的字节。这不证明真实提供方下的模型合规性，也不改变质量命令的沙箱要求。
