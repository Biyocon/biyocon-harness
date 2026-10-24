# Agent Note: Conductor 静态角色 profile 资源

Status: implemented

[English](2026-10-24-conductor-role-profile-assets.md) | 中文

## Problem

Conductor 角色 skill 需要以可移植的方式关联已提供的 profile 图片，同时避免引入尚未完成的头像 API 或改变 specialist 的执行方式。

## Decision

[角色 profile manifest](../../../conductor/roles/profiles.yml) 将 The Conductor 和七个 specialist 映射到八个本地 WebP 文件。每个 specialist 现有的 skill frontmatter 重复记录其显示名称与相对头像文件名。Filesystem skill provider 将这些字段保留为 metadata，并以 `resourceBase` 提供角色目录；角色指令与调用标志保持不变。

图片来自备份 commit `79d3518f04b831e832fccdc9fc3c450ddec2cf0e` 中的八张方形 PNG。FFmpeg 使用 Lanczos 缩放、WebP quality 90、compression level 6，将完整图片编码为 512×512，并移除源 metadata。总大小为 460,586 字节，而非 23,872,437 字节。备份保留原图及未使用的非方形 Arbiter 备选图片。

这些文件是静态仓库资源。Runtime 不会加载 manifest、在 dispatch 时解析头像、持久化 presentation 字段或渲染这些图片。Specialist 的执行方式仍以 [Conductor runtime 决策](2026-09-11-conductor-runtime-layer.md)为准。

## Alternatives considered

**携带尚未完成的 runtime 修改。** Descriptor、attachment、workflow 和客户端 API 修改需要完整的消费方及独立验证；静态角色关联不需要这些修改。

**提交完整尺寸 PNG 和备选图片。** 它们会增大仓库，却不能改善活动 profile 映射。备份保留已提供的源图片集。

**使用绝对图片路径。** 绝对路径将 metadata 绑定到某台机器和某个 checkout。相对文件名可通过 skill 现有的资源目录解析。

## Consequences

Profile 图片易于发现且体积较小，但缩小尺寸和有损 WebP 编码以完整分辨率细节换取仓库体积。Manifest 与角色 metadata 刻意重复记录同一关联，因此测试固定两者的一致性、图片格式、尺寸和大小限制。

真实 filesystem provider 测试检查已解析的 metadata、相对资源及未改变的角色正文。由于模型可见指令、tool 输出和客户端渲染均未改变，组装应用的 snapshot 不作修改。可见头像需要单独的实现决策。
