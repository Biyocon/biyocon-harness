# Agent Note: Conductor 角色头像元数据

Status: proposed

[English](2026-10-17-conductor-role-avatar-metadata.md) | 中文

## Problem

Conductor 角色文件提供 persona 指令和持久名称，但没有把角色与已提供的资料图片关联起来。Host 若不依赖角色目录以外的文件名，就无法发现预期图片。ChatGPT Desktop 没有公开 avatar 字段，而 Harness 需要一条明确、持久的展示路径，把角色元数据经过 subagent 发现传递给渲染客户端。

## Proposal

把提供的图片存放在 `.agents/conductor/roles` 的角色文件旁，为每个活动 specialist skill 添加相对 `metadata.avatar` 和 `metadata.displayName`，并使用 `profiles.yml` 记录父 Conductor profile 和完整的活动角色映射。相对头像路径通过 filesystem skill 已有的 `resourceBase` 解析；图片经过校验后注册为持久 attachment，并在 Conductor 启动 specialist 时作为 host 拥有、模型不可见的 `{ displayName, avatar }` presentation 传入。

将 presentation 持久化到 subagent descriptor version 3，通过 child catalog 投影，并允许 descriptor 中的图片引用使用已有的 session attachment read。Workflow 与 Ralph child composition 传递同一份可信 presentation，但不向模型编写的脚本公开。客户端 renderer 随后可按 session 和 attachment id 请求图片；presentation 或图片数据缺失时，继续使用现有的生成图标。

将方形 `07-the-arbiter.png` 作为活动 Arbiter 图片。保留提供的非方形 Arbiter 备选图片，但把它标记为未分配资源，不把它显示为活动 profile。

该机制是一份可移植的 Harness 展示约定，但不会覆盖 ChatGPT Desktop 由客户端控制的 subagent 图标。在 Conductor resolver 和 Harness renderer 消费新字段之前，仓库资源仍只是可发现元数据，而不是可见头像。

## Alternatives considered

**嵌入绝对 Windows 路径。** 绝对路径会把 profile 绑定到单个 checkout，无法跨进程、机器、浏览器、package 或 worktree 使用。

**把图片字节嵌入角色 prompt。** Base64 数据会向模型可见内容增加数兆字节、污染 session log，而且仍然不会创建客户端 avatar 字段。

**把图片字节放入 lifecycle event。** 在事件与 catalog frame 中重复二进制 payload 会扩大日志和 wire 流量。持久 attachment reference 可保持 descriptor 精简，并复用 session 作用域的读取授权。

**修改 ChatGPT Desktop。** 它的 subagent protocol 和客户端拥有这些图标。仓库文件无法添加不受支持的字段，修改已安装并签名的应用也不在本功能范围内。

## Acceptance criteria

- 父 Conductor 和全部七个活动 specialist profile 都映射到 `.agents/conductor/roles` 下存在的 PNG 文件。
- 每个 specialist 角色都在已解析的 skill 元数据中携带显示名称和相对头像路径。
- 测试会拒绝缺失、重命名、非 PNG 或非方形的活动头像。
- Conductor 在 specialist 发布前把每个活动角色图片解析为持久 attachment，并向每次 fresh spawn（包括 Ralph round）提供匹配的 presentation。
- Descriptor 持久化、projection、API schema、workflow transport 与 session 授权图片读取会保留有效 presentation 数据并拒绝损坏的持久数据。
- Harness subagent UI 会显示已提供的头像，并在缺少 presentation 或图片数据时继续使用当前生成图标。
- 文档明确区分仓库关联与实际客户端渲染支持。
- 任何图片路径都不依赖原始 `temp` 目录或绝对 checkout 路径。

## Risks

图片文件会显著增加仓库体积。只有在资源已经过校验并为对应 child session 注册后，descriptor 才能授权 attachment 读取。在客户端实现匹配的 renderer 之前，客户端可能忽略这些元数据。如果消费者忽略 manifest 的未分配分类，保留的 Arbiter 备选资源可能被误认为活动头像。
