# 生成素材与实际接入

当前版本以v2需求表为准：307张交付PNG（241运行素材、66定稿/动作参考），已接入现代新媒体研究设施风格。批准原图在`nm-v2/originals/`，需求尺寸交付在`../art_delivery/nm_v2/`，运行文件在`../public/art/nm-v2/`；提示与来源记录在`nm-v2/prompts/`、`nm-v2/records/`和`nm-v2/generation-queue.json`。本轮真实验证见[验收报告](../docs/NM_V2_ART_ACCEPTANCE.md)。

Git包含上述v2原图、交付、运行素材和记录；临时候选、旧版原图、检查图、进程PID和完整录像留在开发机。历史工具中的本机源路径用于追溯，不是游戏运行依赖。下文为v1制作历史。

本目录保存按《网梗收容_美术素材生成需求_v1.0_20261021.xlsx》生产的素材原图、处理记录和检查结果。生成方式为内置 `image_gen`；当前员工参考图是本批人物、设施和界面的风格基准。

## 交付结构

| 目录 | 内容 |
|---|---|
| `generated/personnel/` | 员工、六种发型、四表情、五武器/防具、员工单姿态参考，共77个命名单元 |
| `generated/abnormalities/` | 五物各自平静/失控定稿与58件动画零件，共68个命名单元 |
| `generated/abnormalities-references/` | 五物工作及战斗的49张单姿态制作参考 |
| `generated/environment/` | 收容室、走廊、门窗、梯道、设备和远景的67个独立模块 |
| `generated/ui_vfx/` | 19张面板/图标与8张状态特效关键图 |
| `contact-sheets/` | 自动汇总的素材检查图；不是游戏截图 |
| `revisions/` | 本轮定向修订前的人员源图留存 |

`production-index.json` 对照105组需求、288个PNG单元记录实际文件、生成状态、SHA256、透明通道、原图及运行时尺寸。`production-index.csv` 可直接用Excel打开。82张定稿/动作参考用于制作检查，206张拆件/模块/UI/VFX才是实际运行素材；参考图不作为游戏动作或结算逻辑。

UI_014的工作表自动命名与备注存在差异：实际采用备注明确要求的 `ui_status_walk_badge.png` 和 `ui_status_retreat_badge.png`；索引同时保留两种名称供追溯。

## 运行时

实际PNG位于项目的 `public/art/generated/`。员工和五物由 `src/art/generated/HumanRig.ts`、`CreatureRig.ts` 按原员工/敌人状态组装；环境由 `EnvironmentArt.ts` 与 `architecture.ts` 按原设施坐标拼接；特效由 `EffectsArt.ts` 接收真实事件和模拟时间。字体、数字、HP/SP填充、选中圈、路径、碰撞与射程范围仍由程序精确绘制。

原图保持图像模型实际输出尺寸；运行时仅透明边界裁切、等比缩小和有记录的部件隔离，不把模型输出当作可编辑PSD或已经完成的逐帧动画。关节、脚底与武器握柄挂点在真实骨架中登记；左向由镜像实现。奶龙分身复用同样零件，由真实独立实体决定位置和生命值。

技术处理与索引工具：

```text
docs/art-brief-work/staff-production.mjs
art-production/scripts/prepare-abnormalities.mjs
scripts/process-environment-art.py
scripts/prepare-ui-vfx-art.py
docs/art-brief-work/build-production-index.mjs
```

各生成清单保存原始来源与提示需求。原始生成服务文件另保留在Codex的生成图片目录，项目内已有可移交副本。

## 验证边界

素材检查图只能证明素材与命名。实际画面和连续操作必须查看 `docs/generated-art-evidence-2026-10-21/` 内的浏览器报告、PNG和录像；最终通过范围写在 `docs/GENERATED_ART_ACCEPTANCE.md`。旧 `?slice=1` 是保留的程序绘制回归入口，默认设施与正式三日共用本轮生成美术。
