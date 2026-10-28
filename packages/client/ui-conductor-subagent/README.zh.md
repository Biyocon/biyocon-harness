# @deepseek-ai/dsh-client-ui-conductor-subagent

[English](README.md) | 中文

本客户端插件拥有子代理目录中的 Conductor 角色名称、尝试标签、生命周期和门禁文字。它向通用 subagent.catalog.content chain 提供内容；拥有者传入精确父子数据及文本样式标识，不解释 Conductor 阶段。选择器仅接受宿主 conductorChildren 投影归属的子会话。无匹配时保留普通子代理显示。

英/丹文本分别显示每次尝试。运行中的子会话不继承门禁；Ralph 没有专家门禁。精确子会话标识保留在次要文字中。目录通过 aria-labelledby 引用渲染文本及精确指标，让状态无需颜色也可访问。插件 fiber 释放时移除 slot 和词典注册。[决策](../../../.agents/notes/implemented/bug-fix/2026-10-28-conductor-child-role-status.md)拥有归属与持久化语义。

## 模型体验

### 目录文本

#### 模型看到的内容

该贡献读取 `conductorChildren`，仅改变浏览器文本。不增加提示、模型 token 或授权，不修改更早的模型请求。

#### Token 影响

不增加模型 token。

#### KV Cache 影响

无；模型请求不变。

## 已知限制与延期工作

- 无法归属的历史子会话保留通用显示。头像和团队视图是独立功能。
