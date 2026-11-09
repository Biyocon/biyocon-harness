# Agent Note: 存在不可用 Conductor 运行时仍可打开聊天

Status: implemented

[English](2026-11-06-conductor-unsupported-record-history.md) | 中文

## Problem

已保存的 Conductor 检查点可能采用不支持的格式或包含无效数据，而周围的 Session 日志仍有可读的聊天历史。此前 owner controller 在 `agent/created` 时解析检查点；解析失败会阻止整个会话打开。这把运行恢复规则误用于聊天读取。

## Decision

只读检查按 runId 将每个最新检查点分类为当前或不可用，仅提取安全的整数格式号；不能读取时为 `null`。owner controller 重建问题状态及判断当前阶段时跳过不可用运行，只记录 runId 和格式，不记录内容。Conductor 投影只发布不可用运行的 id 和格式；状态经过种子会话 replay 后仍保留，后续有效检查点或 tombstone 会移除条目。Conductor UI 在输入框上方的面板以及切到 Forløb 后仍可见的会话标题栏显示本地化状态；不会提供对旧运行的操作控件。

实际使用仍通过严格的 `SessionConductorRunStore` 加载最新检查点，并以 `ConductorRunUnavailableError` 失败；恢复、所有者回答和继续执行都不能使用无效状态。控制器不会为其创建所有者问题，因此没有可取消的陈旧问题。新的 Conductor 任务取得未占用的 runId，把不可用的已存记录也视为占用，不修改旧检查点。不迁移，也不回退到更早的检查点。invariant companion 容忍安装之前已有的无效检查点，以便会话打开，但拒绝新追加的无效检查点。

## Alternatives considered

**打开时迁移旧记录。** 不采用：旧格式没有兼容承诺，推断转换可能从未验证状态授予操作或所有者权限。

**隐藏整个会话。** 不采用：聊天历史可独立于 Conductor 运行状态读取。

**从上一个有效检查点恢复。** 不采用：同一 runId 的最新检查点才具权威性；跳过它会悄然倒退运行。

## Consequences

旧运行仍可见但标为不可用；当前格式的无效记录也会显示其可读取的格式号。投影只收到 `SessionEvent`，无法取得所属会话 id，因此结构有效但 owner 不匹配的记录可能没有不可用提示；严格的 store 仍拒绝使用。实际操作明确失败，日志不含记录内容。基础 bundle 独立于 agent preset 安装 Conductor 呈现。状态显示于 Conductor 面板和持久会话标题栏，选择 Forløb 时仍可见；不会写入模型可见聊天或历史 Forløb 事件表。合成格式 4 测试覆盖打开、聊天保留、拒绝、脱敏日志、投影及独立新运行；无密钥的随附 preset snapshot 覆盖组装后的模型流程。原始记录保留，供所有者稍后决定。
