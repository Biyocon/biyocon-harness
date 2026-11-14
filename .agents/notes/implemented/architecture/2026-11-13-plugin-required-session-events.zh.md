# Agent Note: 可选插件的必读会话事件

Status: implemented

[English](2026-11-13-plugin-required-session-events.md) | 中文

## 问题

仓库级事件允许列表在没有 Conductor 宿主 bundle 时仍允许读取其历史。必读的所有者及运行事件因此可能在缺少解释逻辑时呈现为可读。独立打包的可选插件也需要声明宿主构建以外的事件，同时保留未知事件拒绝机制。

## 决策

[会话存储](../../../../packages/core/session/README.md)允许内建类型及挂载插件通过 `registerEventTypes` 注册的声明。注册归调用方 fiber 所有，按引用计数，最后一个注册方退出后移除。注册仅允许解释事件类型，不证明 payload 有效、不授予所有者权限，也不允许迁移。可信进程内插件通过 TypeScript 声明类型；不可信 envelope 仍须通过存储及领域验证。

目录生成器把声明 `dsh.sessionEventRegistration: true` 的包排除在无条件运行时集合外，文档目录仍保留其声明。显式 profile bundle 用 `dsh.bundle.sessionEventTypes` 声明名称；[app-boot](../../../../packages/boot/app-boot/README.md)验证数组、合并去重并在普通 SessionStore 激活前传入 Config。传递依赖及 patch 不授予名称，声明没有启用的会话提供方时拒绝。现有 rc.7 Loader 支持这一配置流程，无须替换提供方。

只有字面量 `disabled: true` 将会话行排除在 Config 准入之外。表达式行在 Loader 对 `!!js` 求值前获得 Config，因此 false 表达式不会丢弃必需类型集合。

Conductor 事件准入由 bundle manifest 通过会话 Config 唯一拥有。[Conductor](../../../../packages/conductor/conductor/README.md)仅拥有两个投影及其 `conductorPresentation` 可用性；bundle 通过现有行级 `inject` 依赖，在投影注册前阻止会话激活。元数据和投影均无重复注册。仅导入类型或磁盘存在包不授予准入。现有 Biyocon profile 保留显式 bundle。

生产方在挂载工具／控制器 effect 前检查全部七种必需类型，拒绝没有准入的纯 patch 挂载。已附加会话的 append 在改变日志或发送通知前拒绝未准入的必读事件；暂存 seed 在进入存储发布前被验证。注册改变后，已附加的缓存历史读取重新检查准入。独立会话只支持纯暂存，不授予运行权限。这些检查封闭活动读取路径，无须在每次访问时重扫不变历史。

共享[持久化协调器](../../../../packages/session/session-persistence/README.md)在构建冷会话、合成或提交恢复、发布 agent 或回放投影之前检查准入。保留的 preparation 和活动会话检查也重新核验注册。SQLite 后缀读取报告前缀中的必读类型及其首次序号，使投影 watermark 无法隐藏更早的不支持事件。JSONL 检查完整解析前缀。缺少注册时，错误指出事件并要求启用兼容 bundle 或升级宿主，绝不返回部分历史。`ignorable: true` 保持原有语义。

启用 bundle 时，不支持或无效的 Conductor 运行记录仍保留聊天及不可用运行投影；实际运行访问继续严格拒绝。会话及 Conductor 格式版本均不变。只读检查不改变存储字节。首次 agent resume 可追加原有 `session/end-seed` 标记而不修改原始字节；本次验证的冷重启不再追加内容，也不重复模型或工具工作。

## 考虑过的备选方案

**核心无条件包含可选事件名称。** 知道名称不等于安装解释逻辑；保留必需 bundle 的规则，核心不导入 Conductor。

**跳过未知事件或重写旧记录。** 这可能丢失权限事实或破坏历史；应在回放前拒绝并保留原始记录。

**只验证缓存后缀。** watermark 之前的必读事件会绕过准入；携带前缀类型见证，无须再次解码前缀 payload。

## 验证

[无密钥可运行示例](../../../../examples/headless-agent/conductor-event-admission.cordis.snapshot.yml)及其 [snapshot 套件](../../../../examples/headless-agent/tests/conductor-event-admission.snapshot.ts)覆盖真实 bundle 启用／缺失的历史、普通聊天、不可用记录及冷重启。[已安装预设 snapshot](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts)证明生产方在任何模型请求前拒绝。[Web 回归测试](../../../../apps/web/tests/conductor-event-admission.e2e.ts)证明启动顺序、活动写入拒绝及撤销后已附加历史读取拒绝，不改变存储或缓存。真实 CLI 组合覆盖多个显式 bundle、排除传递／patch 授权及表达式／字面量禁用。Unit 覆盖注册释放、seed／append 拒绝及读取恢复。不执行模型或工具。

## 后果

可选事件生产方须在挂载及会话访问前获得准入。SQLite 后缀读取增加一次前缀类型分组查询。打包安装门禁 4a／4b、UI 拆分及适配器另行交付；本次不是公开发布或付费测试资格验证。

替代审计：本决策部分替代[会话格式决策](2026-08-10-session-log-version-mechanism.md)中仅依赖生成列表的准入及推迟注册的备选方案；其格式、ignorable 标记及完整日志拒绝规则仍有效。[不可用历史决策](../bug-fix/2026-11-06-conductor-unsupported-record-history.md)保留严格运行访问，[rc.7 bundle 决策](2026-11-12-conductor-rc7-host-bundle.md)保留资源、信任与迁移规则。没有完整已实现三件套被替代或归档。
