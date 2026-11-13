# Agent Note: 可选插件的必读会话事件

Status: implemented

[English](2026-11-13-plugin-required-session-events.md) | 中文

## 问题

仓库级事件允许列表在没有 Conductor 宿主 bundle 时仍允许读取其历史。必读的所有者及运行事件因此可能在缺少解释逻辑时呈现为可读。独立打包的可选插件也需要声明宿主构建以外的事件，同时保留未知事件拒绝机制。

## 决策

[会话存储](../../../../packages/core/session/README.md)允许内建类型及挂载插件通过 `registerEventTypes` 注册的声明。注册归调用方 fiber 所有，按引用计数，最后一个注册方退出后移除。注册仅允许解释事件类型，不证明 payload 有效、不授予所有者权限，也不允许迁移。可信进程内插件通过 TypeScript 声明类型；不可信 envelope 仍须通过存储及领域验证。

目录生成器把 manifest 中声明 `dsh.sessionEventRegistration: true` 的包排除在无条件运行时集合之外，但仍将其声明保留在文档目录中。不解析领域名称前缀。[rc.7 bundle](../../../../packages/conductor/conductor-host-rc7/README.md)用 `SessionStore` 子类替换基础会话提供方，在服务激活之前同步注册七个 Conductor 事件及两个投影。因此，即使 Web 监听器已启动而其他插件仍待加载，依赖 `sessions` 的消费方也不能在注册前读取。仅导入类型或磁盘上存在包并不获得准入。现有 Biyocon profile 保留显式 bundle。

共享[持久化协调器](../../../../packages/session/session-persistence/README.md)在构建冷会话、合成或提交恢复、发布 agent 或回放投影之前检查准入。保留的 preparation 和活动会话检查也重新核验注册。SQLite 后缀读取报告前缀中的必读类型及其首次序号，使投影 watermark 无法隐藏更早的不支持事件。JSONL 检查完整解析前缀。缺少注册时，错误指出事件并要求启用兼容 bundle 或升级宿主，绝不返回部分历史。`ignorable: true` 保持原有语义。

启用 bundle 时，不支持或无效的 Conductor 运行记录仍保留聊天及不可用运行投影；实际运行访问继续严格拒绝。会话及 Conductor 格式版本均不变。只读检查不改变存储字节。首次 agent resume 可追加原有 `session/end-seed` 标记而不修改原始字节；本次验证的冷重启不再追加内容，也不重复模型或工具工作。

## 考虑过的备选方案

**核心无条件包含可选事件名称。** 知道名称不等于安装解释逻辑；保留必需 bundle 的规则，核心不导入 Conductor。

**跳过未知事件或重写旧记录。** 这可能丢失权限事实或破坏历史；应在回放前拒绝并保留原始记录。

**只验证缓存后缀。** watermark 之前的必读事件会绕过准入；携带前缀类型见证，无须再次解码前缀 payload。

## 验证

[无密钥可运行示例](../../../../examples/headless-agent/conductor-event-admission.cordis.snapshot.yml)及其 [snapshot 套件](../../../../examples/headless-agent/tests/conductor-event-admission.snapshot.ts)覆盖真实 bundle patch 的启用与缺失、无 bundle 的普通聊天、启用 bundle 时的格式 4 及无效记录，以及独立进程重启。[Web 启动回归测试](../../../../apps/web/tests/conductor-event-admission.e2e.ts)证明宿主启动尚未完成时即可正确准入历史与 resume，且拒绝不会发布会话、改变存储字节或持久化投影缓存条目。提供方释放、元数据拒绝及冷／缓存／后缀读取在 JSONL 与 SQLite 上均有测试。不执行模型或工具。

## 后果

可选事件生产方须在会话访问前安装并挂载注册插件。SQLite 后缀读取增加一次前缀类型分组查询。打包安装门禁 4a／4b、UI 拆分及适配器另行交付；本次不是公开发布或付费测试资格验证。

替代审计：本决策部分替代[会话格式决策](2026-08-10-session-log-version-mechanism.md)中仅依赖生成列表的准入及推迟注册的备选方案；其格式、ignorable 标记及完整日志拒绝规则仍有效。[不可用历史决策](../bug-fix/2026-11-06-conductor-unsupported-record-history.md)保留严格运行访问，[rc.7 bundle 决策](2026-11-12-conductor-rc7-host-bundle.md)保留资源、信任与迁移规则。没有完整已实现三件套被替代或归档。
