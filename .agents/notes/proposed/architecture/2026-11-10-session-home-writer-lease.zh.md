# Agent Note: 每个主目录与会话存储只允许一个写入者

Status: proposed

中文 | [English](2026-11-10-session-home-writer-lease.md)

## Problem

[#51](https://github.com/Biyocon/biyocon-harness/issues/51)要求在会话追加或修复之前持有独占主机所有权。[JSONL 后端](../../../../packages/session/session-persistence-jsonl/src/index.ts)只解析一次根目录，[协调器](../../../../packages/session/session-persistence/src/coordinator.ts)在可选后端 `close()` 之前排空写入，但协调仅限当前实例。两个主机仍能修改同一存储。启动器警告不能阻止另一个参与协议的主机，也不能迫使官方桌面应用遵守新锁。

## Proposal

### Scope and primitive

同时对解析后的 Harness 主目录和配置的会话根目录持有生命周期租约。主目录标识阻止两个主机在同一 home 下使用不同会话子目录；存储标识阻止两个 home 指向同一会话目录。主目录与存储均不同的实例保持独立。此机制保护遵守协议的会话写入者，不保护 settings、credentials 或忽略租约的应用。

建议每个资源使用独立 SQLite 锁文件，设置 `PRAGMA busy_timeout=0`，并在回滚日志模式下保持 `BEGIN EXCLUSIVE` 事务。使用仓库其他位置已采用的内置 [Node 22.19 DatabaseSync](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html)，不依赖更新的 API。[SQLite 事务语义](https://www.sqlite.org/lang_transaction.html)与[操作系统文件锁](https://www.sqlite.org/lockingv3.html)提供竞争排斥及进程退出释放。整个写入者生命周期保持连接；不使用周期计时器、PID 存活推断、增加超时、重试或自动删除陈旧锁。会话仍为 JSONL/Zstandard，记录格式不变。

在每个规范目录中使用 `.session-writer-lease.sqlite`；home 与存储相同时只获取一次。持久锁文件是协调状态，不能证明写入者存活。正常获取与释放不得删除、重命名、替换、迁移或重置它。数据库损坏或日志模式不符合预期时明确拒绝。关闭或回滚连接释放所有权。锁数据库不保存会话内容、密钥、prompt 或所有者 PID 元数据。

### Canonical paths and acquisition

通过现有 home-path 工具解析主目录，并基于启动 cwd 一次性解析存储。创建不存在的目录后，对每个根执行 `realpath` 再选择锁文件。目录与锁文件可以在获取所有权前创建，但两项租约都成功前不得改变会话日志或执行修复。symlink/junction 别名必须归一到同一资源。路径比较应适应平台，不能在区分大小写的文件系统上统一转小写；独占性依赖文件系统标识，而非传入路径的哈希。

按确定顺序获取不同资源。busy/locked 立即失败；后一个资源失败时关闭此前获得的所有连接。进程内注册表按规范资源标识阻止重复后端，避免再打开已拥有锁的 SQLite 句柄。拒绝锁文件 symlink 和多个硬链接，保留文件/目录标识；观察到替换或根变化导致所有权失效时，后续操作必须失败。旧写入仍可能执行时不得静默重新获取。

支持经 OS 测试矩阵验证锁语义的本地文件系统。SQLite 明确记录了[文件系统与锁文件替换风险](https://www.sqlite.org/howtocorrupt.html)。网络文件系统不在保证范围内。实现获批之前，必须明确各平台如何识别并拒绝远程或不支持的根；仅看路径拼写无法识别挂载共享。主机运行时手动替换锁文件或目录不受支持，不能宣称安全。

### Lifecycle and package ownership

实现一个通用会话租约 helper，提供显式 acquire/close API，不导入 Conductor。JSONL provider 在发布可写 persistence service 或构造写入协调器之前同步获取租约；配置无效或初始化失败时释放已获取资源。租约绑定精确的 provider 实例。第二个主机不隐式降级为只读；检查可以使用当前运行主机的 API。

关闭时先停止接收新操作，排空写入、修复及活动存储操作，再通过协调器现有 backend `close()` 顺序释放租约。必须验证所有直接 API 操作均参与排空；如现有协调器遗漏某项，只做最小通用生命周期修正。排空失败时，只要仍有操作存活就不能释放租约。OS 终止进程后会释放 SQLite 锁；新所有者随后可在自身租约下执行现有崩溃修复。暂停但仍存活的进程无限期保有所有权。

预计实现文件为 `packages/session/` 下的新通用 helper、JSONL provider 的 Config/获取/close、对应 README 双语文件，以及 persistence coordinator 中经证实缺失的操作跟踪。默认 home 解析仍属于 `home-paths`。如 Conductor 依赖这些公共能力，应在其依赖清单登记实际文件与 PR 编号。不计划修改 agent-loop、模型、工具策略、会话事件或 Conductor record。

目前在活动存储上创建第二个后端的测试与种子工具，应改用主机 persistence API，或等原实例完全释放。尤其浏览器 scaffold 的独立 seed context 不能绕过租约。同一 home 的跨端口测试应验证第二个写入者被拒绝，而非同时写入。诊断只说明选定 home/store 已被使用，建议关闭另一个 Biyocon 主机或选择独立 home，不终止它，也不暴露存储内容。

### Evidence and implementation test plan

未提交的 Windows/Node 24 合成探针验证了：竞争进程被拒绝、不同锁文件保持独立、正常关闭和终止所有者之后可获取。这只是原语级证据，不证明集成或其他平台。未使用所有者 home 或应用。

实现需要通过真实子进程入口和确定性 IPC 屏障验证：同时获取恰好一个胜者；失败者不改变会话文件；独立 home/store 可并行；规范别名冲突；不同 home 共享存储冲突；同进程重复实例失败；正常关闭在延迟写入/修复完成前保持所有权；崩溃终止后允许现有尾部恢复；初始化失败释放先前租约。还需覆盖损坏/替换的锁文件、文件系统权限拒绝和不支持的远程根，且不接管锁。通过真实可运行示例做无密钥 snapshot，覆盖拒绝和成功重启，确认失败主机没有模型调用。执行聚焦 unit coverage、构建后 provider 冒烟、doc-sync，并在原生 Windows、Linux、macOS 上运行跨进程场景；若现有工作流未覆盖 macOS，则增加针对该场景的任务。

## Alternatives considered

**PID 文件或按陈旧时间恢复的独占目录。** PID 可复用，暂停的存活写入者也可能超过 heartbeat 时间。删除其锁会允许并发写入；永久拒绝陈旧文件则每次崩溃都需要手动恢复。

**原生 flock/LockFileEx addon。** 可实现生命周期锁，但增加原生构建与平台发布维护。如果 SQLite 原语或本地文件系统检测无法通过要求的测试，再重新评估。

**只锁 home。** 不同 home 仍能指向同一会话根。**只锁存储**则允许两个主机在同一 home 使用不同存储。双资源规则覆盖两项标识要求。

## Acceptance criteria

两项租约都持有前不得修改会话。关闭时停止接收新操作，并在保持所有权期间完成已接收工作。每个规范 home/store 只有一个参与协议的 provider；第二个实例明确拒绝且不改变日志。上述每项实现测试都要在指定平台有证据，包括 macOS。helper 不引入重试、陈旧接管、格式迁移、内容泄露或 Conductor 依赖。实现通过审查之前，必须解决远程根检测并证明所有存储操作均排空。

## Risks

SQLite 与文件锁依赖底层平台；路径并不证明正确的锁语义。意外替换锁文件可能破坏协作，观察到时必须明确失败。现有测试假设重复后端访问，需要有意转换。启动时创建协调目录改变后端延迟创建根目录的行为，必须记录。官方桌面应用仍是不遵守协议的写入者，启动器警告仍然必要。
