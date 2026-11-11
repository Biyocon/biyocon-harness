# Agent Note: 可移植的 Conductor bundle 与客户端适配器

Status: proposed

[English](2026-11-11-portable-conductor-bundle.md) | 中文

## Problem

Conductor 运行引擎已分为可复用的软件包，但已安装的产品还不是独立插件。CLI 拥有 `conductor` preset，并在启动前从仓库复制角色和协议文件。基础与 Web bundle 无条件安装 Conductor，通用问题 UI 和宿主 API 也包含 Conductor 专属的所有者交互。因此，只把当前 `dsh-conductor-presets` 包安装到另一个 DeepSeek Harness fork，并不会安装 preset、指令和全部必需的宿主行为。所有者需要一套完整的 Conductor 运行时，供 Biyocon Harness 和另一个 Harness fork 安装；随后提供其他桌面及 CLI 客户端的适配器，并在今后经单独批准后公开发布。

## Proposal

建立一套可选的 Conductor 发行包，规范运行时仍位于 `packages/conductor/*`。bundle 包声明 `dsh.bundle`，持有宿主呈现行、Conductor 工具、preset 组合及元数据，以及完整的角色、协议、模板和图像资源。另一个可选 Web UI bundle 持有 Conductor 专属的子代理及所有者问题呈现。Biyocon 的 profile 安装同一套包；另一个 Harness fork 无需复制 Biyocon 源码，即可安装打包产物。通用基础包、Web bundle、源码启动器、preset 列表、会话读取器及问题 UI 只在必要处增加小型、可复用的插件扩展点。核心绝不导入 Conductor。[核心依赖清单](2026-11-05-conductor-core-dependencies.md)记录每项宿主改动的文件、用途和 PR。

### Package and composition ownership

| 当前绑定 | 建议的归属及行为 |
|---|---|
| [`apps/cli/config/agent-presets/conductor/`](../../../../apps/cli/config/agent-presets/conductor/preset.yml) 与 [`generate-conductor-skills.ts`](../../../../apps/cli/scripts/generate-conductor-skills.ts) | Conductor 发行包打包原始资源及完整 preset。preset 从已安装包的相对位置解析资源，绝不从任务工作区或源码 checkout 解析。通用 preset 列表通过声明的包／根目录输入发现它；资源缺失时，在发布 Agent 前拒绝安装。 |
| [`dsh-base`](../../../../packages/bundle/base/cordis.patch.yml) 与 [`dsh-web-app`](../../../../packages/bundle/web-app/cordis.patch.yml) | 可选的 Conductor 宿主及 UI bundle 持有自身的行与依赖。移除 bundle 后，通用 Harness 仍可正常工作。启用 bundle 时，必须在读取 Conductor 会话前安装投影。 |
| [`ui-user-questions`](../../../../packages/client/ui-user-questions/README.md) 与 [`apiproxy`](../../../../packages/host/apiproxy/README.md) | 将 Conductor 卡片与回执移至可选 UI 插件。保留通用、类型化的所有者意图注册及服务端验证路径；外部客户端不能仅靠模型文字或猜出的 question id 伪造批准。 |
| [`known-event-types.ts`](../../../../packages/core/session/src/known-event-types.ts) | 会话读取器必须在回放前识别已安装 Conductor 的必需事件。用经验证的已安装包事件声明或等效的组装目录输入，替代只扫描仓库路径的生成器假设。未知的必需事件仍须拒绝；不可用的旧 Conductor 运行不能遮蔽无关聊天历史。 |

bundle 的公开包名必须位于发布者控制的命名空间。现有 `@deepseek-ai/*` 名称和指向上游的 repository 字段，不能视为在该命名空间发布的许可。公开 tarball 前须确定并验证发布身份；本地原型可使用未发布的包说明符。Cordis 与共享 Harness 服务须保持 peer 身份，避免安装 bundle 时加载第二套核心。固定受支持的宿主版本；每个更新的上游版本都要做显式兼容性检查。Biyocon Harness 本身继续使用 rc.7。

### Host security and lifecycle

每次运行及其会话日志由一台 Harness 宿主拥有。适配器连接该宿主；它们不得为同一 `DSH_HOME` 启动独立写入进程。多客户端运行前，[#87](https://github.com/Biyocon/biyocon-harness/pull/87) 的宿主级 home／会话存储所有权设计或经验证的等效机制必须拒绝竞争写入者。客户端断开连接不会完成、取消或重复运行。启动、状态、结果、恢复及所有者答复操作使用类型化的运行／会话身份，并执行宿主现有的授权。所有者答复须绑定当前问题、修订、提案哈希、运行和所有者会话；Gate C 仍是独立的明确批准。只读分析不授予写入或发布权限。任何适配器都不得开放任意文件、凭据或私有角色定义。

[已安装技能决策](../../implemented/bug-fix/2026-10-24-conductor-installed-skills.md)仍规定可信宿主读取、隔离的技能优先级，以及发布前拒绝失败安装。[运行时决策](../../implemented/feature/2026-09-11-conductor-runtime-layer.md)仍规定关卡与工具执行。本提案改变打包和宿主组合，不改变这些决策。#75 第二阶段、#30 第二阶段及 #58 阶段 B 的统一 v6 设计，须在任何 record 或运行时格式改动前单独审查；可针对当前格式验证打包，但这不能宣称最终运行时已完成。

### Client adapters

DSH bundle 是产品引擎；客户端适配器是独立发行部分。优先采用单一宿主 API 与狭窄的 MCP 外观，而不是复制 Conductor 逻辑。该外观提供启动、状态、已接受结果和恢复；仅当宿主能够认证所有者并展示准确的待处理提案时，才提供所有者答复操作。无法满足该条件的客户端可以读取暂停的运行，但不能批准。每个客户端都必须通过自身正常 UI，针对同一宿主和持久化运行接受测试。

| 客户端 | 实现前须验证的连接方式 | 独立验收 |
|---|---|---|
| ChatGPT Desktop | 官方[插件连接](https://developers.openai.com/plugins/deploy/connect-chatgpt)与[安全 MCP 隧道](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)说明私有 MCP 访问；[仅桌面插件](https://developers.openai.com/plugins/deploy/desktop-only)说明本地执行。须核对所有者实际账号、工作区权限及可用连接方式。 | 真正的 ChatGPT 桌面对话启动并读取运行；浏览器／API 或 Codex CLI 成功不能代替。隧道配置及任何密钥使用须由所有者另行决定。 |
| PI-Desktop | 确定准确的上游应用、版本及受支持的 MCP 或插件机制；不可从 Super-Desktop 推断。 | 其自身正常 UI 启动并读取宿主运行。 |
| Super-Desktop | 接线前重新核对所有者 fork 在固定修订上的 stdio／HTTP MCP 客户端。 | 正常聊天调用共用外观，而不是复制的运行时。 |
| Multica | 重新核对所选 Agent provider，以及其 daemon 在何处执行 MCP 命令。 | 正常 UI 到达同一宿主，返回真实 run id，并在重启后读取结果。 |

## Alternatives considered

**以独立 Conductor 服务作为主要产品。** 它可直接服务 MCP 客户端，却不能使 Conductor 作为 DSH 插件安装到另一个 fork，也会增加第二套宿主生命周期及会话存储所有者。独立服务或 MCP 外观可作为打包后 DSH 运行时前面的可选适配器。

**把 CLI preset 和源码资源复制到每个 fork。** 这可以快速进行本地试验，却重复原始角色、包接线和更新，也无法证明打包插件可独立安装。

**把所有 Conductor 专属宿主行为移入通用核心。** 这会使宿主依赖 Conductor，并增加未安装 Conductor 的部署负担。通用注册点加可选 Conductor provider 能保持正确的依赖方向。

## Acceptance criteria

第二个干净的 Harness 安装只使用真实打包的 Conductor 产物及文档化的 profile 命令；不依赖 Biyocon checkout、从源码树生成的复制品、私有数据或手工传输 preset 文件。选定的宿主版本须通过包内容、依赖身份、安装、重载、回放及未安装插件的测试。无密钥合成示例覆盖分析与关卡；另行获批的模型测试及所有者交互测试证明真实派发、拒绝过期或伪造答复、恢复，以及宿主重启后的状态读取。Biyocon 使用相同发行包并保留现有产品行为。四个目标客户端各自通过正常 UI 验收；一个客户端的试点不能替代另一个。公开发布还要求发布者拥有包名、许可／来源与秘密信息审计、安装文档、宿主兼容矩阵，以及所有者的单独发布决定。

## Risks

较新的上游宿主可能缺少 Conductor 依赖的通用子代理、输出上限、所有者问题或事件目录能力；仅安装包不能证明兼容。移动所有者 UI 与必需事件识别可能改变回放及授权，因此测试须覆盖无效和不受支持的 record，以及成功运行。隧道或 MCP 客户端改变的是访问路径，不是宿主的批准权限。实施适配器前，仍需验证 PI-Desktop 的准确产品及各客户端账号的权限。已有的活跃笔记仍对其已交付机制具有权威性；本提案与其打包描述部分重叠，但在代码交付前不取代任何一篇。
