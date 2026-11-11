# Conductor 公开成本测量

[English](README.md) | 中文

本文档说明[Detective 结果成本](../../.agents/notes/proposed/feature/2026-11-05-conductor-detective-evidence-budget.md)的可复现公开实验。测量覆盖整个 Conductor 分析，包括父 agent（智能体）、生产者、批评者、Auditor、Arbiter、被拒绝的调用和返工。实验不改变产品运行时或记录格式。

## 前提条件

使用 Node 24、PowerShell 7、pnpm、ripgrep、两个干净且已构建的运行时 worktree，以及进程环境中继承的 `DEEPSEEK_API_KEY`。凭据始终保留在进程环境；执行器既不读取根目录 `.env`，也不写入密钥。实验使用 DeepSeek 官方端点，以 high 推理强度、原生工具和禁用 provider 自动重试的配置请求 `deepseek-flash`。provider 可能改变该模型别名实际指向的权重。

在每个 worktree 中正常执行 `pnpm install --frozen-lockfile` 和 `pnpm run build`，构建选定版本。测量期间，基线和候选 worktree 必须保持干净且停留在固定提交。执行器通过真正的 Loader 启动各自已构建的 headless 示例，并挂载随版本提供的 Conductor 预设；不会注入专家答案或使用 mock 模型响应。

## 准备并运行

[生成器](prepare-world.mjs)接收基线目录、候选目录以及可选输出父目录。它创建全新的随机目录，其中包含两个公开工作区、独立的源文件/答案 manifest（元数据清单），以及为每次试验隔离的 home、agent、配置、临时文件和会话目录。它不会生成或使用所有者会话数据。完整源文件 manifest 和精确任务保留在本地。

```powershell
$baseline = Join-Path $HOME 'worktrees\conductor-cost-baseline'
$candidate = Join-Path $HOME 'worktrees\detective-capture-index'
$prepared = node scripts/conductor-cost/prepare-world.mjs $baseline $candidate |
  ConvertFrom-Json
$experimentRoot = $prepared.root

foreach ($caseName in 'capture','discovery') {
  $order = @('baseline-1','candidate-1','candidate-2',
    'baseline-2','baseline-3','candidate-3')
  foreach ($attempt in $order) {
    $manifest = Join-Path $experimentRoot "$caseName-$attempt\manifest.json"
    & pwsh -NoProfile -File scripts/conductor-cost/launch-cost.ps1 -Manifest $manifest
    if ($LASTEXITCODE -ne 0) { throw 'Inspect the preserved trial before proceeding.' }
  }
}
pnpm run measure:conductor:report $experimentRoot
```

[启动器](launch-cost.ps1)设置全新的 `DSH_HOME`、`DSH_AGENTS_HOME`、home/配置和临时目录环境变量。它不会启动浏览器或服务器，也不会访问所有者的应用 home。每个工作区包含一个空 `.git` 目录，用于停止向上查找指令；用户预设被禁用。额外的读取路径检查将访问范围限制在合成工作区和本次试验的状态目录。产品原有的只读分析和审批检查仍然生效。

[观察器](cost-run.mjs)将每次模型请求及其最终用量保存在本地，原样传递流块，并刷写真实父子会话日志。唯一的 `started.json` 防止意外重复使用同一试验目录。外部停止条件为十分钟、64 次调用或已观测到的 0.50 美元；这些条件用于限制实验，不是原子化产品预算，可能在一次响应后超出阈值，且按非高峰价格等值计算。停止、模型失败或等待所有者交互均保留为未完成尝试，包含已发生费用。未知用量会停止实验，并保持未定价状态。不得删除 `started.json` 来重试失败尝试；应创建新的、具有明确身份的实验。

## 案例与独立检查

| 案例 | 公开输入 | 必需发现 | 目的 |
|---|---|---|---|
| `discovery` | 300 个文件、30,216 字节正文、长路径、六个子目录；不接纳文件 | 三条关键记录及精确路径和行号 | 广泛搜索压力和源头结果限制 |
| `capture` | 三个已接纳文件、165,614 字节、每个 1,200 行 | 每个来源各一条关键记录，附精确的已保存区间 | 每个来源均重要时的 capture 索引 |

运行顺序交替为基线/候选、候选/基线、基线/候选。无法重置远端 provider 缓存，因此报告实际命中，而不宣称缓存为冷缓存或两组预热程度相同。这些受控文本任务检验特定的来源选择行为，不复现私人分析，也不证明任意项目上的表现。

[独立分析器](../conductor-cost-report.ts)按会话/轮次/步骤，将流用量与日志中的 assistant 消息逐一核对。它检查已知 ID、报告中精确的单行来源定位、最终生产者实际接触的来源，以及已保存 capture 的哈希和区间。工作区发现仍是观察结果，不等于已接纳来源的验证。被拒绝的调用、当前请求和 `structured_output` 不构成来源支持。无法识别的报告布局需要人工审查，而不会自动通过。

[报告 CLI（命令行界面）](report.ts)重新计算来源哈希并检查完整文件清单。其独立答案检查仅覆盖上述必需发现，不证明每项语义断言、否定性覆盖声明或 Auditor 判断。尤其是，它没有实现 #75 后续的逐项声明验证阶段。宣称整体质量相当前，仍须单独审查已接受报告中缺乏支持的附带断言。

## 价格与发布

**2026-11-11** 核对的[官方价格页](https://api-docs.deepseek.com/quick_start/pricing/)列出 Flash 非高峰费率：每百万 token 的未缓存输入为 0.15 美元，缓存读取为 0.003 美元，输出为 0.60 美元。推理属于输出，不重复计费。此适配器未报告缓存写入数量，因此保持缺失，而不假定为零。总价是标准非高峰价格等值，不是账单或余额扣款；高峰时段和账户赠金可能改变实际费用。

检查后仅发布 `report.json`：它包含提交、来源/执行器哈希、逐调用用量、字符数、工具次数/大小、失败和汇总，不含源文本、文件名、会话 ID、提示词或推理文本。`raw.json`、`raw-incomplete.json`、完整会话和进程日志保留在本地。主要比较将**全部**尝试的费用除以通过独立答案检查的完成数；另列完成率、单次价格、输出和返工。未知用量使总价保持未知。两组各三次试验均存在后，才显示百分比比较。

小样本描述的是本次实验，不保证节省。停在等待状态或遗漏发现的便宜尝试，不是更便宜的完整分析。历史 12.58% 源头限制估算仍是独立的反事实情景。

## 已观测实验：2026-11-11

[生成的元数据](results/2026-11-11.json)比较基线 `879ab27bdd22203675d6f0cc678652779fc089cd` 与 A1+A2 候选 `41136d904cc28f8e528e7b14d6d6bcff9f34fd27`。全部 317 次调用均请求官方 Flash/high；流与日志用量相符，每个来源的文件清单和哈希均未变化，没有无法定价的用量。保留全部十二次试验，标准非高峰价格等值合计为 0.528625383 美元。发布的观察器与实际执行器逐字节相同，SHA-256 为 `79209899435feec7b7944addd07403a2fca8885ad605d51cddce4e443b6e76e7`。

| 案例 / 组别 | 合格 / 尝试数 | 模型调用 | 全部尝试美元数 | 每份合格报告美元数 |
|---|---:|---:|---:|---:|
| Discovery / 基线 | 3 / 3 | 74 | 0.131939802 | 0.043979934 |
| Discovery / 候选 | 3 / 3 | 77 | 0.096006795 | 0.032002265 |
| Capture / 基线 | 3 / 3 | 74 | 0.162989202 | 0.054329734 |
| Capture / 候选 | 2 / 3 | 92 | 0.137689584 | 0.068844792 |

Discovery 在此指标上**便宜 27.23%**；该案例未接纳文件，因此未启用 capture 索引分支。每份已接受报告都包含全部三项已知发现和已观测工作区来源。基线的 Detective 搜索结果达到 58,637 个字符，候选最多为 3,942 个字符。

Capture 的每份合格报告成本则**增加 26.72%**，尽管单次尝试均价更低。一次候选尝试在结构化区间错误和批评者返工后升级为等待所有者；其 0.036620082 美元计入总成本。未缓存输入减少，被更多输出和更少完成数抵消。候选 Detective 搜索/capture 结果均不超过 3,998 个字符。两份已接受候选报告中的三项已知正面发现及已保存区间均有来源支持；独立检查不证明其他断言。

此样本支持继续评估源头限制，并揭示 capture 密集场景的失败情况。它不证明普遍质量相当，不验证历史 12.58% 数字，也不满足 A2 的整体价格验收。修改指引或默认值前应审查区间/返工和完整性措辞问题，再将修订候选作为具有独立身份的新实验测量，不改写本次结果。
