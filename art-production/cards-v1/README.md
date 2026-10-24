# E.G.O. 战斗卡牌美术 V1

依据用户提供的《E.G.O. 战斗卡牌美术方案 V1》，映射到 `config/gameplay-v3.json` 的真实 18 张卡牌：15 张五物专属卡与 3 张制式训练卡。此批仅改变展示，不改卡牌名称、伤害、范围、冷却或出手时长。

## 交付

- `requirements.json`：逐卡需求、真实机制、英文生成提示词、运行路径和制作状态。
- `generated-imports.json`：内置 imagegen 输出原文件与运行资源的对应关系。
- `manifest.json`：18 张 PNG 的 SHA-256、尺寸、字节数及原图一致性记录。
- `public/art/cards-v1/`：18 张 1254 × 1254 方形卡面动作插图，总计 38,516,532 字节。均由内置 imagegen 生成并原样导入，没有裁改或重绘原文件。
- `outputs/cards-v1/网梗收容_EGO卡牌美术需求_V1.xlsx`：素材需求、完整提示词、动效验收三页。

## 运行接入

`src/v3/CardHand.ts` 按实际卡牌 ID 加载 `art/cards-v1/{id小写}.png`，显示真实名称、效果、持有员工与来源。`src/v3/style.css` 负责 144 × 212 竖版卡框、信息区、冷却灰化与扫描线等程序绘制层。

方形原画在手牌的横向插图区居中裁显，在预览区放大查看。中文、数值和状态由游戏实时排版，图片不烘焙文字。

`src/v3/CardEffects.ts` 读取真实施放事件及实体坐标，组合五种污染母题；部分透明特效复用 `src/art/generated/EffectsArt.ts` 已加载的 `public/art/nm-v2/ui_vfx/` 资源。卡框、类别标记、来源符号、目标圈、轨迹和冷却遮罩属于程序绘制，不计入新生成图片数量。

## 验证范围

`py -3 art-production/cards-v1/verify-assets.py` 只读 PNG 与原始生成文件，检查 18 个实际卡牌 ID 的覆盖、方形尺寸、逐字节一致性和 SHA-256，再更新清单。

Excel 已用 artifact-tool 重算、扫描公式错误并渲染检查三页。清单中的“已接入代码”表示资源路径已有实际引用，不替代实机验证；游戏交互与暂停、出牌、冷却等结果以本轮主任务验收记录为准。
