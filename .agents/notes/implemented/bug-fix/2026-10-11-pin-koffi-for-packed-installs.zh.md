# Agent Note: 为打包安装固定 koffi 版本

Status: implemented

[English](2026-10-11-pin-koffi-for-packed-installs.md) | 中文

## 问题

打包 tarball 的消费方根据已发布包的 manifest（元数据清单）解析依赖，不使用工作区锁文件。因此，`koffi` 的 `^3.1.0` 声明可能选择比工作区更新的版本。`koffi` `3.3.2` 与 `3.3.3` 在 Linux 的 Node `24.21.0` 下无法从源码编译，因此即使源码 commit 与工作区锁文件没有变化，发布演练仍可能失败。

该故障可在 `node:24.21.0-bookworm` 容器中复现：安装 `koffi@^3.1.0` 会解析到 `3.3.3`，并在 `src/koffi/src/uv.cc` 中失败；相同条件下安装 `koffi@3.1.1` 成功。发布门禁必须测试已发布 manifest 选择的依赖，不能依赖注册表的时间状态。

## 决策

四个使用 `koffi` 的已发布包声明精确版本 `3.1.1`，对应的锁文件 importer 使用同一精确 specifier。工作区解析与打包消费方解析保持一致，直至后续依赖更新明确验证并选择另一个版本。

打包安装门禁保持不变，并继续使用 npm 安装已发布 tarball。门禁必须保留原生构建执行，不得通过省略失败依赖来获得绿色结果。

## 考虑过的替代方案

**保留 `^3.1.0` 并依赖工作区锁文件。** 不采用，因为外部 tarball 消费方不会收到工作区锁文件，导致源码测试依赖与发布安装依赖可能不同。

**仅添加根级 pnpm override。** 不采用，因为 npm 安装已发布 tarball 时不会读取仓库的 pnpm override。

**禁用原生构建脚本或从打包安装演练中删除 `koffi`。** 不采用，因为这会隐藏下游消费方可能遇到的安装故障。

**升级到满足范围的最新 `koffi` 版本。** 在该版本能够于受支持的 Node 24 Linux 发布路径中编译，并通过包自有原生行为测试之前不采用。

## 后果

打包消费方会确定性地选择与工作区相同的 `koffi` 版本。精确依赖不会自动获得兼容修复，因此 Dependabot 或有意的依赖变更必须先验证新版本，再同时更新四个 manifest。

该固定解决的是确定性依赖选择，而不是未来 Node 版本兼容性。打包安装矩阵仍负责发现 `3.1.1` 在受支持运行时上无法构建或加载的情况。

## 验证

- 在安装了 CMake 与 Ninja 的 `node:24.21.0-bookworm` 容器中，`npm install --omit=optional 'koffi@^3.1.0'` 解析到 `3.3.3`，并在 `src/koffi/src/uv.cc` 中失败；精确版本 `3.3.2` 与 `3.3.3` 复现该故障，而精确版本 `3.1.1` 在相同条件下安装成功。
- 四个已发布的 `koffi` 消费包及其锁文件 importer 声明精确版本 `3.1.1`。
- 针对四个消费包的聚焦 Vitest 运行通过 26 个测试文件，其中 589 项测试通过，2 项平台特定测试跳过。
- `pnpm run typecheck`、`pnpm run lint` 与 `pnpm run doc-sync` 通过，且 `git diff --check` 未报告错误。
- 在 commit `ad595f4` 上进行的本地仓库级演练在 `node:24.21.0-bookworm` 中复现了发布作业的打包与安装流程：验证 224 个 DSH 发布成员，构建仓库，打包 224 个 DSH tarball、9 个 vendor tarball 与 Landlock entry，再将 234 个 tarball 安装到外部消费方。已安装的 `@deepseek-ai/dsh` 可执行文件报告 `0.1.0-rc.7`，且该流程成功退出。GitHub Actions 上的 Ubuntu 仍是权威发布门禁。
