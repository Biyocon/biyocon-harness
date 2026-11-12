# @deepseek-ai/dsh-conductor-host-rc7

[English](README.md) | 中文

Biyocon Harness rc.7 的可选 Conductor 宿主 bundle。须在 profile 的 `dsh.profile.bundles` 列表中，显式放在 `dsh-base` 与界面 bundle 之间。它在会话回放前注册 subagent 与不可用运行两种投影，并通过 `dsh.bundle.presetRoot` 提供包内的 `presets` 目录。

## 资源与安装

已提交的 preset 树是生成投影，在安装或构建前即可使用。`pnpm run verify-conductor-resources` 不重新生成资源，而是检查精确正面清单与规范 SHA-256；静态 CI 与 doc-sync 执行此检查。包构建通过 [conductor-presets](../conductor-presets/README.md) 准备正面清单中明确列出的 27 个资源与两个 preset 文件，不递归复制任何规范来源目录。生成清单记录每个资源的 SHA-256；`pnpm run verify-conductor-pack` 对照规范字节验证实际 npm tarball，并拒绝缺失、额外或修改过的资源。CLI 不包含 Conductor preset 副本，也不导入准备逻辑。

Biyocon 的源码命令在启动前准备相同资源。包含 `dsh-base` 的现有 profile 通过安装方的一次性拆分迁移添加此 bundle；之后用户明确移除它的选择会得到尊重。严格的运行格式检查及不可用运行行为保持不变，不改写会话文件。

## 模型体验

preset 保留相同的工具、persona 与角色指令。打包不改变模型请求字段、token 预算或缓存行为。

#### KV Cache 影响

资源迁移保留相同的稳定请求前缀；编辑规范指令会按 conductor-presets 文档所述改变前缀。

## 已知限制与后续工作

- 此 bundle 仅支持 rc.7。读取前事件注册、打包安装停止门禁 4a、固定版本上游停止门禁 4b 及可选 UI 拆分另行交付。此包未公开发布；安装到另一宿主不能证明兼容性。
