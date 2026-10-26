# v0.6 主界面 UI 实装与验收

日期：2026-10-25。依据：`C:/Users/SEASUN/Downloads/wanggeng_ui_art_patch_v0_6.md`。

## 本轮结果与边界

完成顶栏、员工概览、选中对象侧栏、底部五物 Dock，以及收容档案和员工详情的统一。保留 v0.5 奶龙收容室、医疗区和连接走廊样板；其余旧工业环境仍在，本轮没有批量替换，也不宣称全基地风格验收完成。

- 顶栏保留资源、总产能、时间、1×/2×、暂停和保存；模式、地图总览、跟随采用图标。
- 员工区可折叠，头像、状态图标与 HP/SP 条承接概览；详情使用独立按钮，员工行仍能选择单位及接收友方卡牌目标。
- 右栏只保留选中对象核心数值、挑战/抓捕、装备、档案及下一目标。锁定原因可展开查看，不隐藏规则。
- 五物导航改为五个头像槽，保留 ID、阶级、锁定/可行动图标、选中态及提示。
- 28 枚原创 SVG 使用 24×24 网格、1.7px 圆角描边和 currentColor。头像用真实场内 nm-v2 部件按 CreatureRig 静止姿势组合，避免档案与场内造型分裂。
- 档案为左身份右记录的独立页；行为记录、收容须知及员工卡组可展开。奶龙失效只在模式图标增加克制的重复暖黄影像。
- 说明、最近记录收在帮助页；瞬时提示自动淡出只影响 UI，不参与模拟结算。

没有新增生成式位图；本轮需要的是统一矢量图标与现有角色素材复用。没有用 CSS 滤镜替换场景美术。

## 对照截图与文字统计

[打开完整对比页](art-style-v06/comparison.html) · [28 枚图标板](art-style-v06/icons.html)

| 对照 | 优化前 | 优化后 |
|---|---|---|
| 主界面总览 | [before](art-style-v06/before-overview.jpg) | [after](art-style-v06/after-overview.jpg) |
| 奶龙右侧栏 | [before](art-style-v06/before-sidebar.jpg) | [after](art-style-v06/after-sidebar.jpg) |
| 底部 Dock | [before](art-style-v06/before-dock.jpg) | [after](art-style-v06/after-dock.jpg) |
| 常驻文本条目 | 52 | 25（减少 51.9%） |
| 常驻文本字符 | 405 | 77（减少 81.0%） |

同一 1280×720 视口、整合镜头、04:30 暂停、N01 I 阶、59.0 E、三名员工的真实游戏截图。文字条目按可见非空 DOM 文本节点计数，排除 Canvas 场景标签、tooltip/aria 标签、瞬时通知、隐藏模态页和闭合 details 内容；员工概览展开，帮助关闭。条目与字符是两种不同指标，40–60% 的要求按常驻条目衡量，不代表删掉相同比例的功能或完整文案。原始数据见 `text-before.json`、`text-after.json`。

## 真实操作记录

验收使用独立测试来源 `http://127.0.0.1:5190/`；没有覆盖用户 4173 来源的正式进度。全程使用浏览器实际点击，不注入模拟状态。

| 操作顺序 | 实际观察 | 证据 |
|---|---|---|
| 选中奶龙，打开档案、展开须知 | 左头像/身份，右档案与收容须知，E.G.O. 上限可见 | [档案](art-style-v06/profile.jpg)、[展开](art-style-v06/profile-expanded.jpg) |
| 打开装备，给 A-01 配 W01/A01；打开员工详情 | 装备操作保留，员工卡组可展开显示奶龙技能 | [装备](art-style-v06/equipment.jpg)、[员工](art-style-v06/employee-detail.jpg) |
| N01 I 阶时选择 N02 | 抓捕按钮禁用，显示 N01 II 前置 | [锁定](art-style-v06/locked-target.jpg) |
| 切换 2×、恢复、再暂停并切回 1×；保存 | 时间由 04:30 推进至 05:10，资源由 59.0 到 60.4；暂停按钮状态与模拟一致 | 浏览器操作记录；后续存档恢复图 |
| 折叠员工列表，展开操作帮助 | 列表收起，帮助仍保留场景调度、卡牌、暂停与日志说明 | [帮助](art-style-v06/help-collapsed-roster.jpg) |
| 主动挑战 → 确认出战 → 暂停 | 场内真实奶龙/分身/员工战斗；目标产能变为 0；05:24 奶龙余血 34，A-03 精神 60 | [战斗暂停](art-style-v06/combat-paused.jpg) |
| 暂停时选“紧急鼓舞”，点击 A-03 员工行 | 显示已预备，未扣手牌；暂停观察期间精神仍为 60 | [预备牌](art-style-v06/ally-card-prepared.jpg) |
| 恢复模拟 | 浏览器可见状态由 A-03 精神 60→66，弃牌 0→1，公共冷却显示 2.4s；首次短暂恢复尚未完成施放，再继续后执行 | 本轮浏览器可访问树记录；截图采集已晚于瞬时施放，因此不将截图冒称为命中瞬间 |
| 继续战斗至胜利 | 自动回设施，N01 II，产能 4/min，N02 可抓捕，下一目标改为耄耋 | [自动返回](art-style-v06/combat-auto-return.jpg) |
| 点击下一目标，再点外勤抓捕 | 正确聚焦 N02，显示 50 E 入场确认页 | [解锁](art-style-v06/unlocked-next-target.jpg)；本轮未确认开始 N02 外勤 |
| 保存并刷新 | 恢复 N01 II、64.1 E、06:23、暂停状态与三员工 HP/SP | [刷新恢复](art-style-v06/save-reloaded.jpg) |

## 自动检查与生产检查

- `npm run typecheck`：通过。
- `npm run test`：18 个文件、372 项通过。
- `npm run build`：通过，保留既有 Phaser 大包提示。
- `git diff --check`：通过（仅平台换行提示）。
- 生产预览 `http://127.0.0.1:5192/`：等待真实 Canvas ready，打开/关闭奶龙档案成功；[生产档案截图](art-style-v06/production-profile.jpg)。开发与生产测试页读取到的控制台 error 均为 0。
- `engine.ts`、`save.ts`、`graphNavigation.ts`、`config/gameplay-v3.json` 本轮前后 SHA256 一致，记录在 `logic-before.json` / `logic-after.json`。工作区中这些文件的既有修改仍保留，不能将累计 Git diff 当作本轮玩法变更。

## 未验证与保留事项

没有复验五物全部升阶、18 张卡牌逐张施放、触屏/跨尺寸、长时间性能、完整三日链；本轮没有重新测鼠标目标箭头。用户是否能更快理解图标仍需实际游玩反馈，不用自动测试替代主观可用性判断。环境样板外仍有旧工业资产；已有 SAFE/ROOM 直点移动、战后员工定位方式等历史空间限制没有在本轮改变。

本轮代码范围：`src/v3/HUD.ts`、`main.ts` 样式导入、新增 `hud-v06.css`、`icons.ts`、`portraits.ts`。其余交付为文档及真实截图；未提交或推送 Git。
