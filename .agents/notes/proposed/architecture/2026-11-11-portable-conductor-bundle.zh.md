# Agent Note: 可移植的 Conductor bundle

Status: proposed

[English](2026-11-11-portable-conductor-bundle.md) | 中文

## 问题

Conductor 运行引擎已分为可复用的软件包，但已安装的产品还不是独立插件。CLI 拥有 `conductor` preset，并在启动前从仓库复制角色和协议文件。`npm pack --dry-run --json --ignore-scripts` 检查显示，`dsh-conductor-presets` 包只有八个文件，没有角色或协议资源，而 CLI 包含 29 个 Conductor preset 文件。基础与 Web bundle 无条件安装 Conductor，通用问题 UI 和宿主 API 也包含 Conductor 专属的所有者交互。因此，只把当前 `dsh-conductor-presets` 包安装到另一个 DeepSeek Harness fork，并不会安装 preset、指令和全部必需的宿主行为。所有者需要一套可供 Biyocon Harness 和另一个 Harness fork 安装的 Conductor 运行时；客户端适配器与公开发布分别另行设计和决定。

## 提案

建立一套有版本的 Conductor 引擎发行物，规范运行时仍位于 `packages/conductor/*`。针对每条受支持的 Harness 宿主版本线，以轻量宿主 bundle 组合相同的引擎及打包好的角色、协议、模板和图像资源。另一个可选 Web UI bundle 持有 Conductor 专属的 subagent 及所有者问题呈现。Biyocon 与另一个 Harness fork 安装同一套引擎包，无需复制源码；各自选择兼容的宿主 bundle。通用基础包、Web bundle、preset 列表、会话读取器及问题 UI 只在必要处增加小型、可复用的插件扩展点。核心绝不导入 Conductor。[核心依赖清单](2026-11-05-conductor-core-dependencies.md)记录每项宿主改动的文件、用途和 PR。

[共享视图更新提案](2026-11-13-conductor-shared-process-view-and-rollout.md)在此交付顺序中补充规范版本化投影及跨应用验证；改变适配器 v1 的所有者操作限制前，必须完成其独立的 R5 所有者／安全决策。外部协调文件不授予批准。本打包提案继续有效。

### 软件包与组合的归属

| 当前绑定 | 建议的归属及行为 |
|---|---|
| [`packages/conductor/conductor-presets/presets/conductor/`](../../../../packages/conductor/conductor-presets/presets/conductor/preset.yml) 与 [`generate-conductor-skills.ts`](../../../../packages/conductor/conductor-presets/scripts/prepare-assets.ts) | `conductor-presets` 持有 preset 文件及其包内 build/prepack 资源生成步骤。角色和协议的唯一原始来源仍是 `.agents/conductor/` 与四个指定的 `.agents/skills/conductor-*` 目录。包构建只按显式文件正面清单生成安装资源，绝不遍历 `.agents/conductor/runs/` 或其他私有数据。包自身的源码准备任务维持源码启动行为。CLI 生成器及其生成的 preset 副本在同一变更中移除；CLI 构建和启动不再导入 Conductor 准备逻辑。打包门禁要求全部清单文件，并逐一比较包内 SHA-256 与原始文件；缺失或额外的资源文件都拒绝发布或挂载。 |
| [`dsh-base`](../../../../packages/bundle/base/cordis.patch.yml) 与 [`dsh-web-app`](../../../../packages/bundle/web-app/cordis.patch.yml) | 可选的 Conductor 宿主及 UI bundle 持有自身的行与依赖。宿主 bundle 在回放前同时注册 `conductorChildrenProjection` 和 `conductorUnavailableRunsProjection`；后者目前由基础 bundle 的 `conductor-presentation` 提供。没有宿主 bundle 时，通用 Harness 可处理不含 Conductor 历史的会话。 |
| [`ui-user-questions`](../../../../packages/client/ui-user-questions/README.md) 与 [`apiproxy`](../../../../packages/host/apiproxy/README.md) | 将 Conductor 卡片与回执移至可选 UI 插件。保留通用、类型化的所有者意图注册及服务端验证路径；外部客户端不能仅靠模型文字或猜出的 question id 伪造批准。 |
| [`known-event-types.ts`](../../../../packages/core/session/src/known-event-types.ts) | 七种 Conductor 事件为读取时必需事件，不可忽略。通用事件注册器在会话加载前，将内置名称与所选宿主 profile 显式启用的 bundle 所声明的名称组合。持久化读取器使用这份有效集合，而不是把仓库生成的名称一概视为可用。未知的必需事件仍须拒绝。 |

第一项 rc.7 拆分交付是打包的宿主 bundle 与 preset，不包含客户端适配器或 record 变更。[`composeProfile`](../../../../apps/cli/src/profile-boot.ts) 目前在组合 bundle 之后，用 CLI 自带目录覆盖 `agent-presets.roots`，因此 bundle patch 无法注册自己的 preset。增加可选的 `dsh.bundle.presetRoot`，相对于各已安装 bundle。通过 realpath 解析目录，并拒绝逃出包目录的路径，包括符号链接逃逸。只有宿主 profile 明确列出的 bundle 才获得 system 信任；传递依赖不获得。跨全部 system 根目录（包括 CLI 自身目录）拒绝重复 id，而不是静默遮蔽。三项规则都须测试。在同一变更中把 Conductor 从 CLI 自带目录及基础 bundle 移入新 bundle，再在 Biyocon profiles 中明确列出该 bundle。

包的资源正面清单包含 `.agents/conductor/README.md` 与 `roles/profiles.yml`；Conductor 角色仅包含 `00-conductor.webp`；角色文件名基干为 `01-detective`、`02-strategist`、`03-devils-advocate`、`04-headsman`、`05-auditor`、`06-integrator`、`07-the-arbiter`，每个基干恰有 `.md` 和 `.webp` 两种文件；模板为 `baseline.md`、`closeout.md`、`dispatch.md`、`gate-decision.md`、`run.md`、`specialist-envelope.md`；技能只取 `conductor-closeout`、`conductor-orchestration`、`conductor-ralph`、`conductor-specialist` 四个目录中的 `SKILL.md`。这 27 个资源文件加上 `preset.yml` 和 `agent.cordis.yml`，与当前 CLI preset 的 29 个文件一致。清单逐项映射原始路径、包内资源路径及哈希；新增文件必须显式修改清单。包构建使用该清单，`npm pack` 验证完整资源子树及其哈希。

### 事件回放与现有会话

选择“必需 bundle”规则：打开含 Conductor 历史会话的宿主 profile 必须启用 Conductor 宿主 bundle。七种必需事件为 `conductor/checkpoint`、`conductor/child` 及五种所有者交互事件；[所有者事件测试](../../../../packages/conductor/conductor/tests/owner-events.spec.ts)确认这些事件都不带 `ignorable: true`。任何会话打开、冷回放或投影开始前，宿主先组合所选宿主 profile 明确列出的 bundles，并注册经验证的事件声明。缺少该 bundle 时，读取器须指出所需事件并要求启用兼容 bundle，拒绝含 Conductor 事件的会话；不得静默展示不完整聊天或解释该运行。通用宿主仍能处理不含 Conductor 事件的会话；核心不保留固定的 Conductor 名称清单，也不导入 Conductor。

现有 Biyocon 会话不改写。Biyocon 宿主 profiles 继续明确列出该 bundle，因此其完整聊天及 Conductor 历史仍可读取。启用 bundle 后，不受支持的旧 Conductor run 格式仍通过[现有运行不可用行为](../../implemented/bug-fix/2026-11-06-conductor-unsupported-record-history.md)显示为不可恢复；对其运行操作仍严格拒绝。若在未启用 bundle 的宿主 profile 中打开这类会话，则在回放前拒绝。事件注册机制必须在两个干净 fork 的停止门禁之前实施并测试。

截至 2026 年 11 月 11 日，上游 master [`e8f7b93a`](https://github.com/deepseek-ai/deepseek-harness/tree/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb) 用[声明式 preset 行](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/preset/agent-preset/README.md)取代目录 preset，且 [`dsh.bundle.patch`](https://github.com/deepseek-ai/deepseek-harness/blob/e8f7b93a344964de3dca1ace9e72b6e4d6de87cb/packages/bundle/web-app/package.json)支持有序文件列表。`presetRoot` 只属于 rc.7 宿主扩展点，不是上游安装机制。轻量的上游 bundle 必须通过该宿主的 preset 行声明相同引擎；其服务和 record 兼容性仍未得到证明。每条宿主版本线都须固定版本并分别验证打包安装。不能声称同一个宿主 bundle 可在两者上通用。

三个 Conductor 包（`conductor`、`conductor-presets`、`tool-conductor`）目前都使用 `@deepseek-ai/*` 名称，工具包还以另外两个包为 peer。本地 tarball 安装测试可沿用这些名称，但必须证明版本锁定的完整依赖闭包，不得依赖 workspace 链接。整套发行物改用发布者自有包名、许可／来源审查及所有者决定，属于日后的公开发布阶段；现有名称不授权在 `@deepseek-ai/*` 命名空间发布。若采用 `@deepseek-ai/dsh-*` 以外的包名，须在同一次公开发布决定中修订 [AGENTS.md](../../../../AGENTS.md) 的包命名规则；在此之前，各包保留现有名称。Cordis 与共享 Harness 服务须保持 peer 身份，避免安装时加载第二套核心。上游[插件安装指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)说明 `dsh plugin --profile <name> add <package>` 及 bundle 组合；测试须针对选定宿主版本的实际命令和打包后的完整依赖进行。Biyocon Harness 保持 rc.7；每个更新的上游宿主版本都要做显式兼容性检查。

### 宿主安全与生命周期

每次运行及其会话日志由一台 Harness 宿主拥有。在修订后的 [#87](https://github.com/Biyocon/biyocon-harness/pull/87) 设计获批并合并、其宿主级 home／会话存储锁得到实施和验证之前，不允许并发客户端；#87 目前尚未获批。适配器不得为同一 `DSH_HOME` 启动独立写入进程。客户端断开连接不会完成、取消或重复运行。第一版适配器只以类型化运行／会话身份提供启动、状态、结果和恢复。所有者答复及 Gate C 批准留在宿主自己的 UI；适配器不可提交两者。只读分析不授予写入或发布权限。任何适配器都不得开放任意文件、凭据或私有角色定义。

[已安装技能决策](../../implemented/bug-fix/2026-10-24-conductor-installed-skills.md)仍规定可信宿主读取、隔离的技能优先级，以及发布前拒绝失败安装。[运行时决策](../../implemented/feature/2026-09-11-conductor-runtime-layer.md)仍规定关卡与工具执行。本提案改变打包和宿主组合，不改变这些决策。#75 第二阶段、#30 第二阶段及 #58 阶段 B 的统一 v6 设计，须在任何 record 或运行时格式改动前单独审查；可针对当前格式验证打包，但这不能宣称最终运行时已完成。

### 后续客户端适配器

在两个干净安装停止门禁及可选 UI bundle 之后，为 ChatGPT Desktop、PI-Desktop、Super-Desktop 与 Multica 单独编写适配器设计。第一版只可通过一个宿主 API 和狭窄 MCP 外观提供启动、状态、结果和恢复；遇到待答所有者问题时，恢复操作必须拒绝，而所有者答复及批准留在宿主 UI。各客户端自身正常 UI 的验收及连接权限属于后续设计，不属于本次打包验收。

## 考虑过的替代方案

**以独立 Conductor 服务作为主要产品。** 它可直接服务 MCP 客户端，却不能使 Conductor 作为 DSH 插件安装到另一个 fork，也会增加第二套宿主生命周期及会话存储所有者。独立服务或 MCP 外观可作为打包后 DSH 运行时前面的可选适配器。

**把 CLI preset 和源码资源复制到每个 fork。** 这可以快速进行本地试验，却重复原始角色、包接线和更新，也无法证明打包插件可独立安装。

**把所有 Conductor 专属宿主行为移入通用核心。** 这会使宿主依赖 Conductor，并增加未安装 Conductor 的部署负担。通用注册点加可选 Conductor 提供方能保持正确的依赖方向。

**在核心保留固定的 Conductor 事件名称清单。** 这虽使没有 bundle 的宿主也能解析七种必需事件，却错误暗示所有者和运行语义仍可用，并迫使核心维护可选插件名称。含 Conductor 历史的会话应要求启用 bundle。

**将未来的 Conductor 事件标为可忽略。** 跳过未知的运行或所有者事件可能丢失授权和回放事实，却留下貌似完整的会话。现有七种事件均为必需事件；不改写存储日志就不能追溯添加可忽略标记。继续拒绝未知的必需事件。

## 验收标准

交付顺序：采用显式资源正面清单的 rc.7 宿主 bundle 与 preset；读取前事件注册机制；停止门禁 4a；固定版本上游兼容性与停止门禁 4b；可选 Web UI bundle；最后是另行审查的适配器设计与实现。不得合并会使现有 Biyocon 会话无法打开的中间拆分变更。新宿主 bundle 须注册两种 Conductor 投影。包构建及打包门禁证明必需文件与源文件哈希，拒绝额外／私有文件，CLI 生成的副本不再存在。preset 根目录测试证明 realpath 限制、仅显式 profile bundle 获得 system 信任，以及跨所有 system 根目录拒绝重复 id。事件测试证明 bundle 启用时可读取全部七种事件、缺少 bundle 时在回放前拒绝含 Conductor 历史的会话、普通聊天会话在无 bundle 时仍能打开。

停止门禁 4a 是完全无密钥的 rc.7 干净安装，只使用打包产物、文档化 profile 命令及合成会话 record：验证包与依赖身份、组合、分析／关卡回放、启用 bundle 时现有格式 5 与不受支持格式的运行可见性、缺少 bundle 时拒绝、重新加载及宿主重启。不得依赖 Biyocon checkout、源码树副本、私有数据或手工传输 preset。停止门禁 4b 在一个固定版本的较新上游 Harness 上重复相关的无密钥安装、回放及缺少 bundle 测试，证明其宿主服务与 record 处理，而非只凭包安装假定兼容。Biyocon 与另一个 fork 必须使用相同的规范引擎包及各自轻量宿主 bundle。付费模型调用必须另获所有者批准，不属于任一停止门禁。可选 UI bundle 与客户端适配器随后进行；公开发布还要求自有包名、许可／来源及秘密信息审查、安装文档、宿主兼容矩阵和所有者的另行发布决定。

## 风险

较新的上游宿主可能缺少 Conductor 依赖的通用 subagent、输出上限、所有者问题或事件目录能力；仅安装包不能证明兼容。移动所有者 UI 与必需事件识别可能改变回放及授权，因此测试须覆盖无效和不受支持的 record，以及成功运行。要求含 Conductor 历史的会话启用 bundle，意味着通用安装在明确启用 bundle 前不能显示这些会话的聊天；它必须给出清晰的拒绝，而非不完整的记录。客户端连接及账号权限留待独立适配器设计。只有在 bundle 交付时，两篇活跃笔记才被部分取代：[源码启动资源](../../implemented/bug-fix/2026-11-01-conductor-source-launch-assets.md)继续规定相对于安装位置读取、启动前准备、字节不变时不执行写入、原子发布及准备失败时拒绝启动，而包自身的准备步骤取代 CLI 生成；[角色配置资源](../../implemented/feature/2026-10-24-conductor-role-profile-assets.md)继续规定静态 WebP 关联、相对资源元数据及不提供运行时头像渲染，而打包的 bundle 资源取代 CLI 副本。两篇笔记均保持活跃，并继续对这些保留机制具有权威性。
