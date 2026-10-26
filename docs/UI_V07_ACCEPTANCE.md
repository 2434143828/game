# v0.7 主界面版式与信息层级验收

日期：2026-10-25。需求：`C:/Users/SEASUN/Downloads/wanggeng_ui_layout_patch_v0_7.md`。

## 实装结果

右栏拆分为三段：A / PERSONNEL 为 42px 高的轻员工条带；B / SELECTED ENTITY 为视觉主体，含 88×112 头像底板、名称阶级、编号、状态章、三项指标、独立操作区；C / NEXT TARGET 为轻索引板，显示下一对象、费用或升阶目标及条件标签。

顶栏改为品牌/资源/控制三组，资源使用胶囊；Home、跟随和帮助组成左侧垂直工具条，战斗期间保留帮助。底部五物槽位保留头像、编号、阶级、状态角标，选中项抬起，未解锁项使用锁定槽样式。

右栏仍在游戏坐标 x=1360、宽 224，场景视口、镜头映射、卡牌手牌区域不变；没有重绘房间或角色，也没有调整玩法、寻路、伤害、经营及存档规则。本轮无需生成位图；版式和组件示意使用原生 HTML/CSS，复用 v0.6 SVG 图标及场内角色部件。

## 交付与可视证据

- [对比、A/B/C 分区说明、主卡结构图、标签系统](art-style-v07/comparison.html)
- [总览前](art-style-v07/before-overview.jpg) / [总览后](art-style-v07/after-overview.jpg)
- [右栏前](art-style-v07/before-sidebar.jpg) / [右栏后](art-style-v07/after-sidebar.jpg)
- [主卡独立实机图](art-style-v07/selected-entity.jpg)

前后为相同 1280×720 视口、整合镜头、N01 II、64.1 E、06:23 暂停、三名员工；真实截图未添加伪造角色/动作。对比页的分区标记与结构图是明确标注的独立 HTML 示意，不冒充游戏运行结果。

## 文字密度

| 同一场景与统计口径 | v0.6 | v0.7 |
|---|---:|---:|
| 可见常驻文本条目 | 25 | 32 |
| 可见常驻字符 | 78 | 143 |

新增 7 条组织标记为 OPS-07、PERSONNEL、SELECTED ENTITY、PANEL-B、STABLE、NEXT TARGET、PANEL-C；指标增加 EGO 前缀，总计增加 65 字符。本轮不宣称文字更少，改善目标是明确权重与分区。原核心数值、操作入口及短标签保留，未增加大段常驻说明。

统计使用可见非空 DOM 文本节点，排除 toast、modal、闭合 details、tooltip/aria 标签及 Canvas 文本；员工列表展开、帮助关闭。原始值在 `text-before.json` 和 `text-after.json`。

## 实际运行检查

独立测试来源为 `http://127.0.0.1:5190/`，没有操作用户 4173 来源的正式进度。浏览器操作未注入模拟状态。

| 检查 | 观察结果 |
|---|---|
| N01 主卡与右栏三段 | 同屏完整可见，焦点卡与员工条带权重明显不同 |
| N05 长名称、锁定槽和禁用行动 | 名称及条件未溢出；显示 LOCKED、前置 3×II；[截图](art-style-v07/locked-target.jpg) |
| 主卡档案、员工箭头、装备 | 实际打开 N05 档案、A-01 详情、装备页，均能关闭回设施 |
| 员工折叠与左侧帮助 | 员工条带可收起，帮助面板完整；修正展开帮助时 tooltip 遮挡首行；[截图](art-style-v07/help-and-collapse.jpg) |
| NEXT 跳转 | 聚焦 N02，主卡显示 READY，50 E 外勤确认页可打开；[截图](art-style-v07/ready-target.jpg) |
| 真实 N02 外勤入场 | 64.1 E→14.1 E，场景切换外勤；战斗保留帮助，Home/跟随隐藏，既有卡牌排布保留；[截图](art-style-v07/combat-help.jpg) |
| 暂停预备卡牌 | 简易格挡可预备；恢复后显示 A-02 施放中；[预备截图](art-style-v07/combat-prepared.jpg) |
| 收容确认与受伤显示 | 目标剩 36 进入可收容阶段，启动装置显示 8%；员工重伤与需关注数量随真实状态变化；[战斗截图](art-style-v07/combat-after-card.jpg) |
| 外勤结果 | 该次未成功抓捕，三名员工重伤后自动回设施，N02 仍未收容；不能据此宣称抓捕通关或平衡通过 |
| 费用不足 | NEXT 原来重复显示两个 50 E，现分为“50 E”及“能量不足”；完整条件留在 tooltip；[截图](art-style-v07/insufficient-resource.jpg) |
| 保存恢复 | 测试进度保存后热重载恢复 22.6 E、08:31、N01 II、暂停及真实员工伤势；不是重开局伪造验证 |

## 检查结果与边界

- `npm run typecheck` 通过。
- `npm run test`：18 文件、372 项通过；最后一次增量仅改重复费用标签，随后复跑类型检查及生产构建。
- `npm run build` 通过，仅保留既有 Phaser 大 chunk 提示。
- `py -3 validation/validate_design.py`：760 项断言；公式 unittest：20 项通过。它们不替代实机验证。
- 生产预览 5192：真实 Canvas ready，奶龙档案打开/关闭正常；[生产图](art-style-v07/production-overview.jpg)。开发及生产测试页读取到的控制台 error 为 0。
- 核心 `engine.ts`、`save.ts`、`graphNavigation.ts` 和 `gameplay-v3.json` 本轮前后 SHA256 一致，见 `logic-before.json` / `logic-after.json`。既有未提交玩法修改全部保留。

本轮只验收桌面 1280×720 下的布局与相关入口，不宣称五物通关、全部卡牌、三日流程、触屏/跨设备或长时性能全部复验；外勤失败及既有房间风格差异没有在本轮通过改数值/背景掩盖。主观版式是否符合预期仍以用户实际游玩判断。

本轮代码范围：`HUD.ts` 的标记与展示文本、`main.ts` 样式导入、新增 `hud-v07.css`；另有本验收文档、对比页和真实截图。未提交或推送 Git。
