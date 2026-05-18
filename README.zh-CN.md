# pi-gui

[English](./README.md)

`pi-gui` 是一个面向本地 [`pi`](https://github.com/earendil-works/pi) 编码会话的 Codex 风格 Electron 桌面应用。

本仓库基于 [`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui) 项目修改而来。上游项目提供了围绕 `@earendil-works/pi-coding-agent` 的基础桌面壳；这个 fork 延续该产品方向，并围绕本地桌面工作流增加了产品、打包、Git、模型管理和界面体验方面的改进。

## 项目定位

`pi-gui` 不是一个独立的 agent runtime。它是上游 `pi` runtime 的桌面界面，并使用 `@earendil-works/pi-coding-agent` 处理会话、模型/Provider 认证、工具执行、技能、扩展和 transcript 数据。

这个应用面向本地使用 `pi` 的开发者，提供一个聚焦的桌面界面，用于：

- 打开本地工作区
- 创建和恢复 agent 会话
- 查看 transcript 和工具活动
- 通过 composer 发送消息并附加文件/图片
- 查看 Git 变更和 diff
- 提交并同步代码变更
- 管理 Provider、模型、技能和扩展
- 在 agent 工作流旁使用集成终端

## 主要功能

- **工作区与会话管理**：添加本地目录、切换工作区、创建/恢复会话，并持久化桌面 UI 状态。
- **会话优先的界面结构**：transcript、工具时间线、composer 和会话状态是主要界面区域。
- **Composer 工作流**：模型选择、推理强度选择、斜杠命令、队列消息、附件预览和上下文用量展示。
- **Git 面板**：已暂存/未暂存列表、内联 diff、暂存/取消暂存、撤销变更、AI 生成 commit message、提交历史、push/sync 状态和可拖拽调整宽度。
- **模型管理**：基于 `~/.pi/agent/models.json` 管理 Provider/模型，支持模型拉取/测试、用量查询、enabledModels 同步和 API 类型选择。
- **Provider 配置**：通过桌面设置界面配置 OAuth 或 API key。
- **技能与扩展**：查看并启用/禁用已发现的 `pi` skills/extensions，包括扩展命令、工具和诊断信息。
- **通知**：macOS 通知引导，以及后台完成、失败、需要关注等通知偏好。
- **打包脚本**：根目录 `package.json` 暴露 macOS、Windows、Linux 和全平台打包命令。

## 当前状态

- 主要桌面目标平台：macOS。
- 支持本地构建 Linux AppImage，并可用于 CI 风格检查。
- 已提供 Windows 打包脚本，但平台特定验证需要 Windows 环境。
- live runtime 行为依赖你的本地 `pi` 配置和模型凭据。

## 环境要求

- 与本 workspace 兼容的 Node.js。当前本地开发使用 Node `v24.15.0`。
- 通过 Corepack 使用 `pnpm`。
- 可用的 `pi` Provider/模型认证。
- 如果需要真实 agent 工作流，本地 `pi` CLI 应能正常运行。

安装依赖：

```bash
corepack enable
pnpm install
```

## 开发

启动桌面应用开发模式：

```bash
pnpm dev
```

等价的包级命令：

```bash
pnpm --filter @pi-gui/desktop dev
```

构建所有包：

```bash
pnpm build
```

运行类型检查：

```bash
pnpm typecheck
```

运行测试：

```bash
pnpm test
```

桌面端测试 lane 和验证说明见 [`apps/desktop/README.md`](./apps/desktop/README.md)。

## 打包

根目录打包脚本：

```bash
pnpm build:desktop:mac
pnpm build:desktop:win
pnpm build:desktop:linux
pnpm build:desktop:all
```

桌面包级打包脚本：

```bash
pnpm --filter @pi-gui/desktop package:mac
pnpm --filter @pi-gui/desktop package:win
pnpm --filter @pi-gui/desktop package:linux
pnpm --filter @pi-gui/desktop package:all
```

也提供仅生成目录的打包命令：

```bash
pnpm --filter @pi-gui/desktop package:mac:dir
pnpm --filter @pi-gui/desktop package:win:dir
pnpm --filter @pi-gui/desktop package:linux:dir
```

打包产物输出到 `apps/desktop/release`。

## 仓库结构

- `apps/desktop`：Electron main/preload/renderer 应用、桌面端测试、打包配置和 native helper 构建脚本。
- `apps/website`：网站应用脚手架。
- `packages/session-driver`：共享 session driver 类型和 runtime 侧契约。
- `packages/catalogs`：workspace/session/worktree catalog 存储类型。
- `packages/pi-sdk-driver`：基于 `@earendil-works/pi-coding-agent` 的适配层。
- `docs`：README 媒体和项目文档。
- `scripts`：发布和安装验证辅助脚本。

## 模型与生图说明

高级模型管理可以在 `~/.pi/agent/models.json` 中保留并编辑 `compat.openaiProviderTools` 元数据，包括模型级 `imageGeneration` 标记。这只是配置层支持。真正的 provider-native 生图能力仍依赖兼容的 `pi` runtime、插件和 Provider。

截至本 README 更新时，`omp-openai-provider-tools` npm 版本 `0.1.0` 到 `0.1.4` 均已在本地 `pi 0.74.1` 上测试，都会在扩展加载阶段失败，因此这个 fork 不会自动安装该插件。

## 已知限制

- 桌面应用依赖上游 `pi` 行为和本地 auth/session 状态。
- live E2E 测试需要可用的模型凭据，并可能随 Provider 表现不同而变化。
- macOS 原生文件选择器/剪贴板测试需要前台权限和相应系统权限。
- 开发模式可能出现 Electron CSP 警告，打包后不会显示。

## 上游与致谢

本项目基于 [`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui) 修改。

同时依赖：

- [`@earendil-works/pi-coding-agent`](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
- [`earendil-works/pi`](https://github.com/earendil-works/pi)

## License

MIT. See [LICENSE](./LICENSE).
