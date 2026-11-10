# Agent Note: 包引用与运行时标识

Status: implemented

中文 | [English](2026-11-10-rescope-runtime-identifiers.md)

## Problem

[#62](https://github.com/Biyocon/biyocon-harness/issues/62)报告 28 个 hygiene 失败：包改名工具误判 Cordis 事件名及 UI/preset 标签。改写它们会改变产品路由或命名空间。PR 静态 CI 也未执行 rescope 检查。

## Decision

[codemod](../../../../scripts/rescope-vendor.ts)保留精确的事件值、命名空间过滤前缀和文档通配符。裸 `cordis` 标签只在指定 UI/preset 所有者文件中保留。分类作用于 token：同一文件内的 import、export、动态 import、require、require.resolve 与模块声明仍按包名映射改写。TypeScript scanner 穿过注释和换行识别源码上下文。生成目录中已转义的事件签名保留原拼写。

[共享静态 CI](../../../../scripts/run-gates.ts)执行 `rescope-vendor:check`。[原包改名决策](../process/2026-08-10-vendor-package-rescope.md)及精确编辑继续有效。codemod 回归文件中的改写前后字面量示例与映射源码一样不参与重写。其他包引用和 manifest 继续检查。

## Alternatives considered

**改写所有报告值。** 这 28 个文件使用事件或标签标识；改写会破坏语义或生成源码一致性。

**排除全部受影响文件。** 这会隐藏新增包引用。显式值及指定标签所有者可保留同一文件内的模块检查。

## Consequences

修正只改变分类，不改变产品源码或生成事件目录。回归覆盖运行时标识、同一所有者中的模块引用、注释、多行引用、反向映射及幂等性。其他历史标识已有的文件级例外不变。新增事件拼写或标签所有者需要显式分类及回归覆盖。
