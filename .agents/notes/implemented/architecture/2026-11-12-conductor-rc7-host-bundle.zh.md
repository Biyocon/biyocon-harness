# Agent Note: Conductor rc.7 宿主 bundle

Status: implemented

[English](2026-11-12-conductor-rc7-host-bundle.md) | 中文

## 问题

CLI 的 Conductor preset 副本与基础 bundle 无条件安装的投影阻碍独立安装。移除其中任一项而不提供对应安装资源和宿主注册，可能隐藏现有运行或阻止创建会话。

## 决策

可选的 `conductor-host-rc7` bundle 持有宿主级 Conductor 挂载及生成的 preset 树。`conductor-presets` 持有两份原始 preset 文件与准备代码。其字面正面清单读取 27 个规范资源，不遍历运行目录。生成树随代码提交，使源码启动、测试及静态检查在 prepack 前即可运行。静态 CI 与 doc-sync 不生成文件，而是验证精确正面清单及规范 SHA-256；npm tarball 检查独立验证打包字节。这以一个生成的 git 投影换取不依赖准备顺序；规范来源仍是唯一原始输入。构建与源码准备共享[源码启动决策](../bug-fix/2026-11-01-conductor-source-launch-assets.md)规定的原子发布及失败时拒绝启动行为；这些保证继续有效。[静态角色配置决策](../feature/2026-10-24-conductor-role-profile-assets.md)继续规定图像关联与相对元数据。包自身的资源取代 CLI 生成与 CLI preset 副本。

通用 rc.7 `dsh.bundle.presetRoot` 声明解析包内相对路径的真实目录。路径逃逸或非目录在挂载前失败。只有 profile 显式列出的层才提供可信根目录，依赖项不提供。CLI 合并具有 system 信任的自身根目录及 bundle 声明根目录，并将所有补丁配置根目录强制设为 user 信任。补丁根目录不会触发 system/system 重复 id 拒绝。发现逻辑跨所有 system 根目录拒绝重复 id，即使 user 根目录先遮蔽该 id。

Biyocon 为新 profile 显式选择宿主 bundle。安装方提供的通用拆分迁移向包含 base 的现有 profile 添加此 bundle 一次，并记录迁移身份。这保留自定义 profile 行与现有会话访问，并尊重之后的明确退出选择。核心不包含 Conductor 导入或迁移名称。bundle 在回放前注册两种 Conductor 投影；严格的 record 解析保持不变。

## 考虑过的替代方案

**保留 CLI 副本或基础挂载。** 任一做法都会使 Conductor 继续成为必需项，并保留两个安装所有者。

**每次启动都追加 bundle。** 这阻止用户明确退出。记录一次性迁移可保留现有行为，而不持续撤销用户配置。

**复制整个规范目录。** 这可能发布未列出或私有的文件。字面路径与 tarball 验证明确规定发布集合。

## 后果

打包的 preset 与现有不可用运行回放通过真实 Loader 组合及可运行的无密钥快照验证。本次交付不声称完成外部干净安装；读取前事件注册及停止门禁 4a/4b 仍由[可移植 bundle 提案](../../proposed/architecture/2026-11-11-portable-conductor-bundle.md)规定，该提案保持 proposed。UI 拆分、适配器、v6、锁与公开发布仍单独处理。
