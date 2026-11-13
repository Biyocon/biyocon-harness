# Agent Note: 隔离的 Conductor 质量演练

Status: proposed

[English](2026-11-13-conductor-isolated-quality-rehearsal.md) | 中文

## 问题

覆盖所有角色的实现测试需要已注册命令、真实独立的质量执行和宿主批准。所有者的自由文本回答不能补齐默认空目录。测试不得修改生产 preset、使用私有会话，或为得到绿色结果而弱化沙箱执行。

## 提案

本演练作为独立测试工作，绝不成为[共享视图路线图](../architecture/2026-11-13-conductor-shared-process-view-and-rollout.md)中 R1 的依赖。本注记是计划，不授权调用提供方或改变活动应用。

### 隔离及精确命令

在 `C:/Users/Biyocon/worktrees/conductor-quality-rehearsal` 下使用专用 worktree，在其内部建立全新的任务专用 `DSH_HOME`，使用隔离合成工作目录，并仅监听 `127.0.0.1:3090`。启动前检查端口归属；若被占用，停止准备而不是终止占用进程。绝不触碰 10822、所有者的 `~/.dsh`、保留的桌面会话文件或现有 PI 会话。无密钥阶段禁用遥测及继承的提供方凭据。证据／刷新完成后，仅可停止任务拥有的进程；保留产物供评审，不予删除。

唯一命令目录定义位于测试配置的 `cordis.patch.yml`，属于其中唯一、由测试拥有的 `tool-conductor` 配置。以现有[质量 snapshot 组合](../../../../examples/headless-agent/conductor.cordis.snapshot.yml)为结构参考，组装带 Web 界面及正常宿主 UI 批准的专用配置。不要编辑已交付 preset，也不要增加与其竞争的 Conductor 挂载。宿主配置补丁不会自动修改常驻 agent preset（智能体预设）的子树，因此必须先通过真实 loader 组合证明所选测试会话及子会话看到的正是这个作用域配置项；任何重复挂载或仍为空的有效目录，都须在模型工作前拒绝。此测试专用组合不验证打包 preset 的安装。

精确配置一个命令如下；`!!js` 在目录计算精确 argv 哈希前解析宿主固定的 Node 可执行文件。记录 Node 版本／路径／哈希，并拒绝漂移。不允许 shell、额外参数或网络。

```yaml
qualityCommands:
  - id: selftest-node
    modelSafeDescription: Run the synthetic arithmetic self-test without writes or network.
    argv: [!!js "process.execPath", --test, --test-isolation=none, conductor-selftest/selftest.test.mjs]
    cwd: .
    allowedStages: [headsman, auditor]
    sandboxMode: read-only
    timeoutMs: 5000
    maxOutputBytes: 8192
    graceMs: 250
```

以上涵盖所有必需 [QualityCommandConfig](../../../../packages/conductor/tool-conductor/src/quality-catalog.ts) 字段。其余可选字段 `writeRoot` 有意省略：只读模式会拒绝它，且 Auditor 要求只读限制。对解析后的命令计算哈希；Gate C 绑定该定义及必需的 D/E gate。Headsman 和 Auditor 各自仅按 id 调用 `conductor_quality_check`，不得提供命令文本或伪造证据。

合成任务在 `conductor-selftest/` 内实现一个微型算术模块；预先声明的 Node 测试检查其真实行为，并包含失败的负向对照。Integrator 文档放入 `docs/`，符合当前路径守卫。新测试授权仅提议这两个写入根及精确排除项；所有者在 Gate C 评审精确基线。这是新的合成范围，不是对现有私有运行的修改。打印角色名单不能证明 dispatch 或功能。

### 无密钥预检及证据

首先使用回环地址的确定性提供方 fixture（测试前置数据）及真实组合服务。证明有效目录、支持子工具贡献的子执行提供方、原始根归属、宿主批准显示／绑定、过期／被拒绝批准行为，以及适用时的独立文件工具许可。实际质量执行要求真正选定的沙箱对精确只读／禁止网络策略报告完整执行保障。仅声称完整保障的测试包装器不证明操作系统沙箱有效。若原生保障仅部分可用或不可用，记录 `sandbox-unavailable`，保持运行阻塞且零花费；任何隔离替代宿主都须单独验证其设置。

在 D 和 E 分别运行自测并真实返回退出码 0，记录有上限的输出摘要及绑定到运行、子会话、阶段、周期、基线和定义的新证据 id。拒绝错误 id、额外 argv、变化的定义、缺失证据、过期基线或跨运行复用；故意失败的断言不得通过。将实际 dispatch 对应到全部七个专家角色，并呈现对应 UI。重新加载／启动必须保留回执，不能重复执行。日志／fixture 不含会话内容或秘密；fixture 均为合成数据。这些检查是计划，不声称已通过。

### 用量估计及付费运行停止条件

当前计划及无密钥演练的提供方费用上限为 **USD 0**；不得为它们加载真实凭据。后续付费尝试要求所有者分别明确批准路由、模型、数据、计数器和最大值，不能从本注记或 Gate C 推断批准。

仅为规划，估计 20 次模型尝试、100,000 个未命中缓存的输入 token 和 10,000 个含推理的输出 token。拟定最大范围为 32 次实际尝试（含重试）、500,000 个输入 token、50,000 个含推理的输出 token，且没有计费 Web 工具。按 2026-11-13 核实的 DeepSeek V4 Pro 官方高峰价格：未命中输入 USD 1.32/M、缓存读取 0.044/M、输出 3.96/M，全未命中的估计为 USD 0.1716，最大范围为 USD 0.858；拟定所有者支出上限为 USD 1.00。[官方价格](https://api-docs.deepseek.com/quick_start/pricing/)仅用于特定路由的示例计算，不证明 rc.7 提供方目前支持该模型。批准前须确认实际路由及最新价格；缓存命中改变费用而不是消除 token，推理不能重复计费。

当前 v5 运行预算不能强制执行该累计范围。任何付费 dispatch 前，必须验证宿主／提供方预留或等效硬支出控制，统计每次尝试，并安全限制请求输入及剩余输出。用量未知或余量不足时拒绝进一步 dispatch。人工计数器、估计、计时器或花费后的终止均不能保证最大值。缺少已验证的控制及所有者批准时，付费阶段保持阻塞且费用为 USD 0；不得在本次文档任务内实现 v6 或虚构限制器。

## 考虑过的替代方案

**修改生产目录。** 这会扩大部署权限并触碰用户状态；命令仅保留在隔离配置中。

**伪造完整沙箱保障。** 它可以测试执行器连接，但不能验证限制；仅可作为单独标明的底层 fixture，绝不算预检通过。

**先运行付费测试。** 它可能为可预测的设置错误付费，且没有经过证明的累计上限；应先验证无密钥设置及受限费用。

## 验收标准

书面设置明确主目录、工作目录、端口、配置、所有命令字段及不可变 argv。真实组合证明只有一个预期目录；完整保障／批准的负向用例、真实独立 D/E 执行、角色来源链及不重复执行检查均有明确回执。付费阶段必须等到独立授权及硬上限均可证明后才能开始。本工作不能拖住 R1。

## 风险

打包 preset 与配置级挂载属于不同作用域；文件中显示的目录不一定能传递到实际子执行。原生 Windows 限制可能拒绝所需策略。提供方／模型限制及计费可能无法保证付费上限。须将这些情况显式显示为阻塞，而不是悄悄切换组合、放宽策略或对失控尝试计费。[质量／所有者运行时决策](../../implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md)和可移植安装提案继续有效；本演练不替代任何已实现保证。
