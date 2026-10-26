# v0.5 美术规范对照记录

对照源：`C:\Users\SEASUN\Downloads\wanggeng_gameplay_patch_v0_5\wanggeng_art_patch_v0_5`  
目标工程：当前 `wanggeng_demo_spec_v0_1` 工作区  
日期：2026-10-24

## 源包性质

`wanggeng_gameplay_patch_v0_5` 不是可 cherry-pick 的 gameplay 代码补丁。它包含：

- `网梗收容_v0.5_美术风格一致性优化方案.md`
- `CODEX_执行任务.md`
- `reference_screenshots/01_facility_current.png`
- `reference_screenshots/02_archive_current.png`
- `reference_screenshots/03_combat_current.png`

源包内容已原样复制到 `docs/art-style-v05/`，没有覆盖旧的 `docs/ART_STYLE_GUIDE.md`。

## 已对齐内容

| v0.5 要求 | 当前工程对应实现 | 结果 |
|---|---|---|
| 设施仍为真实 2D 剖面、房间、走廊、角色和收容物 | `src/scenes/facility/architecture.ts`、Phaser 场景和实时状态 | 已有，未改玩法 |
| 现代收容机构的克制冷深色板 | `src/v3/style.css` 的 `--nm-*` 令牌、HUD 覆盖层 | 已按 v0.5 色板修正 |
| 统一 E.G.O. 卡面模板 | `src/v3/CardHand.ts` 的 `face()` | 已有，来源/类别/主图/卡名/员工/阶级/状态来自实时状态 |
| 制式训练 + N01 三卡优先替换 | `public/art/cards-v2/t01–t03.png`、`n01_1–n01_3.png` | 已接入真实卡牌 ID |
| 公共冷却由模拟秒驱动，自上而下解冻 | `CardHand.render()` 的 `globalCooldown` 与 CSS `clip-path` | 已有，未新增 wall-clock 计时 |
| 档案左身份牌 + 右侧分层记录 | `src/v3/HUD.ts`、`src/v3/style.css` | 已有 |
| 设施背景降噪、底部目录轻量化 | `architecture.ts`、`style.css` | 已有 |
| 外勤保留现实场景 | `public/art/field-v1/` 与外勤场景映射 | 已有 |

## 本轮实际改动

- `src/v3/CardHand.ts`：将来源色对齐为 v0.5 方案：T `#65B8CD`、N01 `#E6BE65`、N02 `#C9767A`、N03 `#E98D69`、N04 `#E7B853`、N05 `#AA9ACF`。
- `src/v3/style.css`：将基础中控令牌对齐为 v0.5 提议稿：`#121820`、`#202B34`、`#2B3943`、`#52636B`、`#E2E8E7`、`#9BAFB4`、`#65B8CD`，并保留异常强调色的局部使用。
- `ART_STYLE_CHANGELOG.md`、`STATUS.md`：更新来源、映射和验证边界。

## 尚未达到全量验收的项目

- `cards-v2` 目前只有 6 张；N02–N05 的 12 张牌继续使用已有 nm-v2 技能图，统一模板已覆盖但图形素材未全量重绘。
- v0.5 基线截图已归档，但尚未生成同场景同尺寸的正式 Before/After 截图报告。
- 尚未逐张实机施放全部 18 张卡，也未完成五物全量外勤、触屏和长期性能矩阵。
- 不把源包截图、静态素材预览或概念图当作真实游戏截图。

## 保护范围

本次对照没有修改战斗数值、员工寻路、卡牌效果、产能、升阶、挑战/抓捕规则或存档格式，也没有覆盖 `cards-v1` 和已有用户改动。
