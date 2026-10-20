# 技术来源与事实边界

核对日期：2026-10-16。以下仅支撑工程文档的工具用法；所有游戏机制、参数和档案文案是本项目设计草案，不把第三方游戏机制或网络梗来源当成已经核验的事实。

## Phaser 固定版本

Phaser官方保留v3.90.0发布页。此包有意选择该固定主版本以缩小实现分歧，不宣称它是当前最新版本。已有工程优先沿用。

来源：
`https://phaser.io/download/release/v3.90.0`

Phaser官方安装说明提供npm方式及内置TypeScript定义。配置选择本地依赖而非运行时远程CDN（内容分发网络），是本项目的离线可复现偏好。

来源：
`https://docs.phaser.io/phaser/getting-started/installation`

## Vite 与环境版本

Vite官方入门说明用于开发时核对所选版本与本地Node.js的兼容要求。本包没有假定Codex机器已满足某个最新版本条件，要求实际核对并锁定。

来源：
`https://vite.dev/guide/`

## Codex 项目说明

OpenAI官方文档说明Codex会读取AGENTS.md作为项目指令，因此本包将稳定边界和阅读顺序写在该文件中，详细策划单独放docs，避免根指令过长。

来源：
`https://developers.openai.com/codex/agent-configuration/agents-md`
`https://developers.openai.com/codex/learn/best-practices`

## 未做的核验

未核实五个网络梗的确切形象来源、原声、权利关系或角色官方设定。本包不附这些素材，也没有相关法律结论。未实现游戏、未做真实玩法试玩、未验证运行性能或正式版本经济平衡。
