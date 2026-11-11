# Agent Note: Detective 捕获索引

Status: implemented

[English](2026-11-11-detective-capture-index.md) | 中文

## 问题

已批准的 [Detective 成本设计](../../proposed/feature/2026-11-05-conductor-detective-evidence-budget.md)在 v5 准入中保留完整捕获文件，但在检查前就把全部正文发送给 Detective。工作区读取可能看到另一个版本；缩短初始输入必须保留准入证据和后续审阅者的依据。

## 决策

Detective 收到不变的当前请求，以及从已有材料标识、selector、SHA-256 和内容派生的有序文件索引。UTF-8 字节数与可引用行数现场计算，不增加持久字段。完整文件正文保留在检查点中。其他专家、批评者摘录验证和 Auditor 保持已有的完整来源访问。

可信子 agent contribution 在 Detective 搜索工具旁安装 `conductor_read_capture`。只有包含捕获文件的 Detective 收到此定义和指导。安装器闭包保存精确捕获文本，每次读取都检查绑定 selector 的标识及内容哈希，并拒绝未知标识、过大范围和变化的哈希。它绝不访问工作区。运行恢复后的新子 agent 从保存的准入重建读取器；不需要私有 spill 或可继续子 agent 协议。

[工具注册表](../../../../packages/core/tools/src/index.ts)只限制继承的名称；子 agent 本地定义保持可见，不能在 `tools.restrict` 中列出。因此 `childToolFilter` 保持不变的继承读取允许列表，作用域 contribution 提供读取器，Detective 专用执行 guard 明确允许它。将此本地名称传入过滤器会在子 agent 创建前失败。这细化了设计的过滤器措辞，无需全局占位工具、扩大 `READ_TOOLS` 或修改核心。其他分析角色仍拒绝此名称。

[README](../../../../packages/conductor/tool-conductor/README.md)拥有经过验证的字符与行数上限。完整规范 JSON 在字符上限内包含标识、范围、行文本、截断状态和下一行。完整行绝不被静默裁剪；过大单行明确失败。渲染和最终处理限制策略替换、失败及反馈。通用 UI 卡片仅从调用参数派生文件位置。

分派包与工具调用/结果使用已有的已记录输入。不引入历史重写、事件类型、记录版本提升、预算台账、覆盖声明或 `incomplete` 状态。Provider 仍必须支持 contribution。

## 考虑过的替代方案

**读取工作区文件。** 拒绝，因为已变化文件无法证明保存的捕获哈希或行引用。

**注册全局占位工具或修改核心过滤。** 拒绝，因为已有子 agent 本地注册可提供所需能力，无需暴露全局读取器或改变其他角色。

**发送全部捕获正文。** 保留提前访问，但重复不必要的初始输入。索引以显式有界读取交换该成本，不能保证完整报告更便宜。

## 后果

单元测试覆盖索引顺序、不变捕获、换行形式、Unicode、完整结果上限、后部发现、损坏、角色 guard、注册回滚与释放。已安装的 headless Loader 场景在合成工作区文件变化后读取四页保存内容，获得最后的不利发现，并在接受的报告流程中保留批评者/Auditor 的原始证据。已有 Detective 快照按需包含索引分派与读取调用。

历史测量运行没有捕获文件，因此此部分在那次运行中的预估节省为零。净价格、额外调用和证据质量仍需公开材料的真实模型对比。统一 v6 提案保留预算与覆盖核算。不需要所有者会话数据。
