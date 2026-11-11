# Agent Note: 每个主目录与存储只允许一个主机写入者

Status: proposed

中文 | [English](2026-11-10-session-home-writer-lease.md)

## Problem

[#51](https://github.com/Biyocon/biyocon-harness/issues/51)要求在持久修改或修复前取得独占所有权。[JSONL 后端](../../../../packages/session/session-persistence-jsonl/src/index.ts)、[SQLite 后端](../../../../packages/session/session-persistence-sqlite/src/index.ts)和[协调器](../../../../packages/session/session-persistence/src/coordinator.ts)只协调单个实例，不能协调独立主机。仅在 JSONL 加锁也保护不了使用其他后端、但共享 home 的进程。启动器警告无法迫使官方桌面应用遵守新锁。

## Proposal

### 主机范围与原语

boot/host 在挂载任何可写 home 服务前，持有规范 DSH_HOME 的生命周期租约，不依赖 persistence 后端。每个持久后端还须在发布 persistence、打开会话数据库、追加或修复前取得主机拥有的存储租约。JSONL 使用规范根目录；SQLite 使用数据库文件所在的规范目录，同目录数据库有意串行化。内存后端也不能绕过可写 home 的所有权。home 与存储目录均不同的实例保持独立。

使用不导入 Conductor 的通用 acquire/close 服务。[公共 boot](../../../../packages/boot/app-boot/src/index.ts)在插件启动前获取 home 所有权；绕过该入口的 host launcher 也须在 home 写入前使用同一服务。provider 向该 host 请求存储所有权。home 与存储为同一资源时复用主机连接，不能重新打开锁文件。进程内注册表在第二个句柄打开前拒绝另一个 host 或重复存储 provider。直接构造 provider 的测试显式挂载所有权，并使用独立 home。

建议每个资源使用独立 SQLite 锁数据库 `.session-writer-lease.sqlite`，通过内置 [Node 22.19 DatabaseSync](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html)、回滚日志模式、`PRAGMA busy_timeout=0` 和持续 `BEGIN EXCLUSIVE` 实现。[SQLite 事务语义](https://www.sqlite.org/lang_transaction.html)提供即时竞争拒绝和操作系统退出释放。整个所有权周期保持连接。锁数据库初始创建后，不再写入、更新元数据、记录 heartbeat/owner/PID 或改变日志模式；只以持有事务作为信号。会话 JSONL/Zstandard 和 SQLite 数据格式保持不变。

进程中除拥有锁的 SQLite 连接外，任何代码都不得打开该锁文件。身份检查尤其禁止 `open`、`readFile`、`fstat`、文件头探测、备份复制或临时 fd。锁文件身份和链接数只能通过路径 `lstat`/`stat` 检查。[SQLite 的 POSIX 警告](https://www.sqlite.org/howtocorrupt.html#_posix_advisory_locks_canceled_by_a_separate_thread_doing_close_)说明，为同一文件关闭另一个 fd 会释放进程的锁。此禁止也覆盖辅助线程和诊断代码，不只是租约 helper。

持久锁文件是协调状态，不是存活证明。获取/释放时不得删除、重命名、替换、迁移或重置。数据库结构只能经拥有锁的 SQLite 连接验证；日志模式不符或损坏则拒绝。锁数据库不保存会话内容、密钥或 prompt。暂停但仍存活的进程无限期保持锁；不依靠 PID 推断、加长超时、重试或自动接管陈旧锁。

### 路径与尽力而为的网络拒绝

通过现有 home-path 工具解析主目录，存储配置相对启动 cwd 一次性解析。创建缺失的协调目录后，对资源执行 `realpath` 再选择锁文件。持久 home/会话修改不能早于相应租约；目录/锁初始化是明确例外。symlink/junction 别名归一；比较必须尊重区分大小写的文件系统。拒绝锁文件 symlink/多个硬链接，以及硬链接的 SQLite 数据文件。保留通过路径观察的目录/文件身份；检测到替换时使后续操作失效，不静默重新获取。运行期间手动替换仍不受支持。

挂载服务前先获取 home，随后按确定顺序获取存储租约。竞争不等待；启动失败时，要等所有已启动操作排空后才释放已有租约。第二个 host 不隐式降级为只读，也不静默选择其他 home。

所有者批准的是**尽力而为**检测，不是完整网络文件系统识别。Linux 对每个解析后的资源调用 [`fs.statfsSync(path).type`](https://nodejs.org/download/release/v22.19.0/docs/api/fs.html#fsstatfssyncpath-options)，将无符号文件系统类型与[内核常量](https://github.com/torvalds/linux/blob/master/include/uapi/linux/magic.h)比较：NFS `0x6969`；CIFS/SMB `0xFF534D42`、`0xFE534D42`、`0x517B`；FUSE `0x65735546`。所有这些类型均拒绝，包括看起来是本地路径的 FUSE 挂载；检查失败也拒绝启动。Windows 在 `realpath` 后拒绝 UNC，包括扩展 UNC 路径。macOS 上的网络文件系统和映射网络驱动器不受支持，可能无法被这些检查识别。未知类型或非 UNC 拼写不能证明是本地存储，也不能证明锁有效。支持范围限于 OS 矩阵已验证的本地文件系统；其他远程文件系统和忽略本协议的应用没有保证。

### 参与进程

所有能写 home 的主机都参与，包括从 agent bash 工具启动的进程。端口、后端、传输或父进程不同都不是豁免。主机不终止另一个所有者，也不静默选择临时 home。

| Web host 已占用 home 时的进程 | 决策 |
|---|---|
| Web host | 持有 home/store 租约直到所有可写服务排空。另一个使用任一资源的 web host 被拒绝。 |
| Headless CLI，包括 agent bash 启动 | 拒绝继承的已占用 home。独立运行必须显式选择不同 home/store；对现有 home 的操作改用活动 host API。 |
| ACP CLI，包括 agent bash 启动 | 相同拒绝和显式独立 home 规则。ACP 传输不授权第二个本地写入者。 |
| 继承 DSH_HOME 的 [subagent-acp 子进程](../../../../packages/subagent/subagent-acp/README.md) | 启动/dispatch 前拒绝共享 home 子进程。支持的子进程须显式配置不同 home/store，并在 resume 时固定；父子协调走 ACP，不在父存储创建第二个后端。不复制 home 凭据，也不随机制造 resume 身份。 |
| SDK server | 独立 server 拥有自身租约，资源被占用时拒绝。连接现有 host API 的 SDK client 不获取写入租约，也不构造后端。 |
| [Python runtime](../../../../python/sdk-runtime/README.md) | 自动启动 server 并继承已占用 home 时拒绝。独立 runtime 必须配置不同 home/store，或通过已支持的 client 连接活动 host API。不能假定尚未实现的 attach 模式已经存在。 |
| Seeder 与直接后端测试 | 使用所属 host persistence API，或等待 host 完全关闭。独立 browser seed context 和共享 home 的跨端口写入者不能绕过租约。 |

实现必须按表逐项审计 launcher、环境继承和后端工厂。不打开本地 home 的远程 client 不是额外本地写入者；同一 host 内已有的 worker-thread 子 agent 复用主机所有权，不获取竞争租约。

### 生命周期与诊断

所有权位于 boot/host，不再局限于 JSONL provider。两个持久 provider 都须在初始化前证明 host/store 所有权，并参与主机关闭。先停止接收新操作，再排空写入、修复、会触发修复的直接读取及活动存储操作，经协调器关闭后端数据库，最后依次释放 store 和 home 租约。排空失败时，只要还有活动操作就不能释放所有权。初始化失败遵循同一顺序。OS 终止进程会释放 SQLite 锁；新所有者在自身租约下进行现有崩溃恢复。

预计修改通用所有权 helper、公共 boot/host 生命周期、两个 persistence provider、参与的 CLI/ACP/SDK/Python 启动路径和 seeder、对应 README 双语文件，以及经证实缺失的 coordinator 跟踪。默认 home 解析仍归 home-paths。必要时在 Conductor 清单登记实际通用依赖和实现 PR。核心从不导入 Conductor；本提案不修改 agent-loop、模型策略、会话事件或 Conductor record。

拒绝只指出所选资源，并解释 **“En anden proces bruger datamappen. En proces på pause beholder låsen. Luk den anden vært, eller vælg en separat datamappe.” / “Another process owns this data directory. A paused process retains the lock. Close the other host or choose a separate home.”** 不披露存储内容，不根据时间称锁为陈旧，不终止进程，也不宣称能防护官方桌面应用。

### 证据与实现测试计划

保留的 Windows/Node 24 合成探针证明原语级竞争、独立锁文件、正常关闭和终止所有者释放。它不证明 host 集成或跨平台支持；没有使用所有者 home/app。

在原生 Windows、Linux、macOS 上，通过真实子进程入口和确定性 IPC 屏障测试：恰好一个获取胜者，失败者数据不变，独立 home/store，规范别名，不同 home/后端共享存储，同进程重复实例，延迟写入/修复排空，初始化失败和崩溃恢复。覆盖 JSONL/SQLite 和表中每项参与者，包括 bash 启动 headless/ACP，以及 subagent-acp 继承 home 的拒绝。SDK/Python client 场景必须走实际支持的传输。

Linux 和 macOS 获取租约后，执行所有路径身份/链接/替换检查，再证明原连接保持打开时另一个进程仍被拒绝。仪器化 helper，证明这些检查从不另开锁数据库 fd，并在重复检查后验证此不变量。通过拥有锁的 SQLite 连接实际执行的操作，以及路径上的大小/mtime 检查，验证创建后不可修改，不能为此打开额外 fd。覆盖全部列出的 Linux 类型、statfs 错误、Windows realpath 后的 UNC 变体及已记录的不支持情况。暂停的存活所有者仍排斥竞争者；恢复它不能产生第二个所有者。

增加真实可运行示例的无密钥拒绝/重启 snapshot，证明被拒绝 host 没有模型调用；运行聚焦 coverage、构建后 provider 冒烟和 doc-sync。如现有任务未执行要求的 POSIX 场景，则增加针对性的 macOS CI lane。

## Alternatives considered

**仅由 JSONL provider 拥有租约。** 拒绝：其他后端和 boot 时 home 服务会绕过协议。主机与存储所有权分别覆盖两类资源。

**PID 文件或 heartbeat 接管。** 拒绝：PID 重用和暂停写入者使自动删除不安全。

**原生 flock/LockFileEx addon。** 仅在 SQLite 原语无法通过平台测试时重新评估；它增加原生发布维护。

**完整识别网络驱动器。** 不作承诺。获批识别器拒绝已知类型；未识别远程文件系统仍不受支持。

## Acceptance criteria

任何参与 host/backend 都不能在没有所需所有权时修改持久状态。两个 provider 和进程表全部场景满足其决策。关闭时持续持有 home/store 所有权，直到完全排空。Linux/macOS 身份检查不能额外打开锁文件 fd，且仍保持竞争拒绝。锁数据库创建后不可修改。网络拒绝符合已批准的尽力而为策略；暂停所有者诊断明确。三个 OS 的测试证明所支持本地文件系统场景。不引入陈旧接管、格式迁移、私人内容或 Conductor 依赖。

## Risks

建议锁不能阻止不合作应用或任意文件系统写入。未识别网络存储、外部文件替换和不支持文件系统均无保证。目录初始化改变延迟启动；同目录 SQLite 存储有意串行化。现有重复后端测试、继承 home 的子进程和 launcher 需要有意转换。启动器警告仍然必要。
