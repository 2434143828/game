# v0.5 美术风格替换记录

日期：2026-10-24  
范围：设施 HUD、E.G.O. 卡牌和已接入的卡牌插图。玩法数值、战斗结算、寻路、存档和卡牌效果均未改动。

## 本轮采用的风格

本轮按 `wanggeng_gameplay_patch_v0_5\wanggeng_art_patch_v0_5` 中的正式方案对齐：现代新媒体收容机构 + 平台污染型互联网失效。常态使用克制的冷深背景/面板层（`#121820`、`#202B34`、`#2B3943`、`#52636B`、`#E2E8E7`、`#9BAFB4`、`#65B8CD`），异常来源使用局部识别色（奶龙 `#E6BE65`、耄耋 `#C9767A`、大狗 `#E98D69`、叮咚鸡 `#E7B853`、咕咕嘎嘎 `#AA9ACF`）。卡牌边框、标题、状态和特效颜色都从同一来源主题读取。

仓库里的 `docs/ART_STYLE_GUIDE.md` 仍记录较早的“怪诞手绘收容风”。本轮以已找到并纳入 `docs/art-style-v05/` 的 v0.5 方案和任务文件为准，避免把旧纸张/墨线 UI 与现代中控 UI 混用；没有覆盖旧文档，以保留历史设计依据。

## 代码改动

- `src/v3/CardHand.ts` 使用统一 E.G.O. 卡面模板：来源、技能类别、技能名、描述、真实员工归属、阶级、目标和冷却状态均来自实时卡牌/模拟状态。
- 六张专用 v0.5 卡图优先从 `public/art/cards-v2/` 加载；其余 N02–N05 卡牌继续使用既有 `public/art/nm-v2/ui_vfx/` 技能图，保留原资源回退。
- `src/v3/style.css` 将卡区、预览卡、公共冷却、飞牌和 HUD 覆盖为现代蓝灰控制室风，并保留暂停、1×/2×、目标箭头和真实施放反馈。
- `src/v3/HUD.ts`、`src/scenes/facility/architecture.ts` 已完成档案页/设施远景的同风格降噪与层级调整。

## 新增素材与旧→新映射

| 卡牌 | 新运行资源 | 旧运行资源 | 说明 |
|---|---|---|---|
| T01 | `public/art/cards-v2/t01.png` | `public/art/cards-v1/t01.png` 或符号回退 | 制式训练·攻击/训练棍信号 |
| T02 | `public/art/cards-v2/t02.png` | `public/art/cards-v1/t02.png` 或符号回退 | 制式训练·防护盾 |
| T03 | `public/art/cards-v2/t03.png` | `public/art/cards-v1/t03.png` 或符号回退 | 制式训练·支援灯 |
| N01_1 | `public/art/cards-v2/n01_1.png` | `public/art/nm-v2/ui_vfx/nm_v2_ui_skill_icon_s01_stun.png` | 奶龙·自我介绍/黄色气泡 |
| N01_2 | `public/art/cards-v2/n01_2.png` | `public/art/nm-v2/ui_vfx/nm_v2_ui_skill_icon_s01_stun.png` | 奶龙·打断复读 |
| N01_3 | `public/art/cards-v2/n01_3.png` | `public/art/nm-v2/ui_vfx/nm_v2_ui_skill_icon_s01_stun.png` | 奶龙·复制粘贴 |
| N02_1–N05_3 | 既有 `public/art/nm-v2/ui_vfx/` 技能图 | 同左 | 本轮未生成重复素材，保持已有来源图和主题色 |

六张新图均为本地 PNG，1254×1254，随工程打包加载，无外部网络请求。原 `public/art/cards-v1/` 未覆盖，仍可作为回退和历史对照。

## 验证

已完成静态检查：

- `npm test`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

已重新打开真实 `http://127.0.0.1:5173/` 页面并检查设施默认页与 `?cardArtPreview=N01` 外勤战斗：设施、员工、现实商场外勤背景和底部卡区均正常显示；运行时 DOM 实际加载 `/art/cards-v2/n01_1.png`、`n01_2.png`、`n01_3.png`，控制台错误为 0。当前证据覆盖 N01 卡牌资源接入和统一风格画面，生成图和静态预览仍不能代替未执行项目的全量验收。

## 未完成与边界

- v0.5 方案与三张基线截图已复制到 `docs/art-style-v05/`，可用于后续同尺寸 Before/After 对照；本轮仍未把基线图冒充为实机截图。
- N02–N05 本轮沿用已有 nm-v2 技能图，未重复生成 12 张新卡图；五物外勤现实场景保持原 `public/art/field-v1/`，没有改回实验室背景。
- 本轮未声称完成全三日、18 张卡逐张浏览器施放、触屏或长期性能验收。
