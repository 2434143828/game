# 现代新媒体 v2 美术接入验收｜2026-10-23

**需求表307张已全部生成并导入：241张运行素材、66张定稿/动作参考，缺失0。默认设施和正式值班已使用新版美术；当前验证范围见下文，不等于整款游戏所有流程验收完毕。**

依据：`outputs/01a144a7-9b8e-7ec0-91c1-cb1e9446d500/网梗收容_美术素材需求_v2.0_现代新媒体_20261021.xlsx`。沿用用户最新的现代新媒体研究设施方向，冷蓝灰/冷白建筑和制服，五物保留动物辨识度，污染局限于平台主题。此前额度阻塞已解除。

## 已实现

- 五物拆件已齐并装配到真实实体，奶龙分身同样绑定敌方实体；大狗采用橙色垂耳比格犬，咕咕嘎嘎采用蓝白企鹅。头、嘴、四肢及局部污染随实际状态变化。
- 六名员工基型、发型、表情、四类岗位制服、五套武器防具已接入。岗位仅是外观，不新增职业属性。正式第一日仍为四人。
- 81个环境素材：74个建筑/设备模块和7个实际失效时启用的局部污染/碎片；五技能图标及工作、命中特效接入。
- 修正生成图极低alpha杂点撑大裁切框的问题：以alpha≥16定位可见边界并留2像素抗锯齿边缘，边界内RGBA保留；原图不改。导入尺寸、裁切框与原图SHA256均可追溯。
- 真实模拟时间继续驱动移动、工作、攻击和暂停；此次美术接入不修改原配置、伤害、寻路和存档。原有未提交改动保留。

| 分类 | PNG总数 | 已导入 | 缺失 |
|---|---:|---:|---:|
| personnel | 64 | 64 | 0 |
| abnormalities | 98 | 98 | 0 |
| equipment | 25 | 25 | 0 |
| environment | 81 | 81 | 0 |
| ui_vfx | 39 | 39 | 0 |

66张参考图用于核对形象与动作，不是逐帧动画sheet；实际动作由拆件驱动。图片来自内置imagegen，没有改用CLI或付费API。单图已检查，队列仍保留`generated_pending_runtime_review`，不把未经历的动作组合自动标成验收通过。

## 本轮已验证

- `npm run typecheck`、`npm run test`（153项/8文件）、`npm run build`通过；保留Phaser大包警告。设计760断言与公式20例通过，二者不代替实机。
- 真实Chrome连续操作：8检查点、63次输入、19张截图。途中改令 → 走入收容室到工作位才计时 → 实际产能12 → 奶龙主样本与两分身 → 主样本HP180降至174 → 撤退。移动、工作和攻击暂停时模拟与生成部件均冻结。
- 五物平静/失效截图、档案及1280×720布局已检查；五物缺件均为0，加载错误0。三个最后补齐的技能图标已在真实HUD显示。
- 五套装备通过真实工作赚取272能量、按原价开发并穿戴，钱包剩37；分散移动后逐套确认新版武器/防具纹理，检查握持与制服显示。
- 生产包15项通过：无开发桥、无外部请求，正式第一日四人且成功开始；暂停700ms后956160像素完全相同、时钟不变。连续报告与生产报告的脚本、控制台、HTTP及失败请求均0；装备报告记录的脚本和HTTP错误0。
- 连续实录75.92秒、1600×900、25fps；实际解码查看30秒与48秒帧。截图均由运行生成，showcase副本SHA256与来源一致。

## 当前真实证据

- [连续操作报告](nm-v2-evidence-2026-10-23/run-2026-10-23T08-42-24.881Z/report.json) · [完整录像](nm-v2-evidence-2026-10-23/run-2026-10-23T08-42-24.881Z/video/page@d70fe656045eae5e6e9dcaec9c3f6f21.webm)
- [五套装备报告](nm-v2-evidence-2026-10-23/equipment-2026-10-23T08-42-24.901Z/report.json)
- [生产包报告](nm-v2-evidence-2026-10-23/production-2026-10-23T08-46-05.647Z/report.json)
- [进室工作](showcase/nm-v2-work.png) · [失效](showcase/nm-v2-breach.png) · [镇压命中](showcase/nm-v2-combat.png) · [撤退](showcase/nm-v2-retreat.png)
- [五套装备](showcase/nm-v2-equipment.png) · [正式第一日](showcase/nm-v2-day-one.png) · [精简摘要与截图哈希](showcase/nm-v2-verification-summary.json)

## 未验证与保留

本轮未重跑完整三日、全部技能及五武器逐项攻击组合、恐慌/倒地全组合和跨设备长期性能。原三日流程仍在，不把历史测试冒充本轮验证。旧`?slice=1`调试入口保留原程序美术；默认设施及正式值班共用新版。没有PSD分层源文件、配音或音乐，不声称官方IP形象还原。实际血条、路径、文字和命中范围仍由程序绘制。

## 文件位置和复现

- `art_delivery/nm_v2/`：307张按需求尺寸交付PNG。
- `public/art/nm-v2/`：241张实际运行PNG。
- `art-production/nm-v2/originals/`：原图；`generation-queue.json`：来源、规格、裁切及SHA256；`records/`：实际生图提示与候选记录。
- 本地运行：`npm run dev -- --port 4173`；连续验证：`node scripts/nm-v2-art-proof.mjs`；装备验证：`node scripts/nm-v2-equipment-proof.mjs`。
- 生产验证：`npm run build`、`npm run preview -- --port 4174`，设置`FACILITY_URL=http://127.0.0.1:4174`和`FACILITY_EVIDENCE_ROOT=docs/nm-v2-evidence-2026-10-23`后运行`node scripts/large-facility-production-smoke.mjs`。

本段取代下方2026-10-22的部分接入状态；下方及原始记录保留作历史对照。

---

# 历史快照：现代新媒体 v2 美术部分接入｜2026-10-22

**当前为部分接入，整体美术验收未完成。功能检查通过不代表全部素材替换通过。**

来源为 `outputs/01a144a7-9b8e-7ec0-91c1-cb1e9446d500/网梗收容_美术素材需求_v2.0_现代新媒体_20261021.xlsx`。307张中221张已导入；含173张运行素材、48张参考图。运行需求共241张，还缺68张；参考需求共66张，还缺18张。导入只是通过单图检查，不等于所有组合已实机验收。

## 实现与保留

- 81个环境素材已接入：74个建筑/设备模块，7个表面污染与局部碎片仅在实际失效状态显示。
- 员工基型、发型和表情读取真实移动、工作、受击等状态。制服和装备部件未齐，不以缺件拼成完整新造型；缺失武器保留制式外观占位，伤害仍取实际装备配置。
- 新UI、工作/命中特效和五物污染叠层已接入。S01/S03/S05图标暂用已有语义图标；未通过的错误角色图不导入。
- 五物新版拆件均未齐，当前五物仍使用原程序角色，完整绑定真实实体与动作。它们不计作v2已替换。
- 加载清单只包含已检查、已落盘的素材；开发只读状态报告明确列出覆盖率及缺件。缺失图片不再产生404。
- 本轮接入不修改模拟、数值、存档和导航；保留此前工作区改动。

## 实际验证

- `npm run typecheck`、153项测试、`npm run build`通过；构建仍有Phaser包体提示。设计760断言与公式20例通过。
- 真实Chrome鼠标/键盘连续操作：63次输入、8个检查点、19张截图。途中改令 → 抵达工作位后计时 → 实际生产12能量 → 主样本与2分身 → 主样本HP180降至174 → 撤退。移动、工作、战斗暂停时实际状态和部件冻结。
- 其他四物平静与失效、档案、1280×720布局完成浏览器检查；截图显示的收容物仍为旧程序占位。
- 生产包15项检查通过，无开发桥、无外部资源请求；正式第一日四人并成功开始。暂停700ms后956160像素全部相同。
- 两份报告的脚本、控制台、HTTP及失败请求错误均为0。完整连续录像56.4秒、1600×900、25fps；已解码查看20秒和35秒帧。
- 未重跑完整三日、全部技能/装备组合与跨设备性能。未验收新版五物完整装配、全部服装与武器动作；不要将这些标记完成。

## 证据与复现

- [连续操作报告](nm-v2-evidence-2026-10-22/run-2026-10-22T01-42-19.780Z/report.json)
- [连续录像](nm-v2-evidence-2026-10-22/run-2026-10-22T01-42-19.780Z/video/page@086239e334643a638ca638a6bbbbe90d.webm)
- [生产包报告](nm-v2-evidence-2026-10-22/production-2026-10-22T01-44-33.423Z/report.json)
- [工作实机图](showcase/nm-v2-work.png) · [战斗实机图](showcase/nm-v2-combat.png) · [撤退实机图](showcase/nm-v2-retreat.png)

运行 `npm run dev -- --port 4173` 后执行 `node scripts/nm-v2-art-proof.mjs`。生产包使用 `npm run build`、`npm run preview -- --port 4174`，设置 `FACILITY_URL=http://127.0.0.1:4174` 后执行 `node scripts/large-facility-production-smoke.mjs`。完整证据目录留在本机；代表图和摘要位于showcase。

## 当前阻塞与后续

生图接口返回429 `usage_limit_reached`，12个岗位拆件纠正任务均未生成成功。接口报告额度重置时间为北京时间2026-10-22 19:27:37，届时是否可用仍需重新确认；没有改用付费API。原图和候选均保留。

优先补齐五物关键部件和岗位/装备独立拆件，尤其禁止肩部件带整件衣服、身体件带完整四肢。大狗沿用已确认的橙红比格犬参考，咕咕嘎嘎沿用蓝白企鹅参考。之后校正装配、武器握点和动作，再做全套实机验证。纠正任务在 `art-production/nm-v2/corrective-jobs-20261022.json`，原始提示及参考路径在generation-queue.json。尚需处理S01/S03/S05图标与压缩碎片。

| 分类 | 总数 | 已导入 | 待补/待重做 |
|---|---:|---:|---:|
| personnel | 64 | 52 | 12 |
| abnormalities | 98 | 48 | 50 |
| equipment | 25 | 5 | 20 |
| environment | 81 | 81 | 0 |
| ui_vfx | 39 | 35 | 4 |

## 待补明细

| 素材名 | 分类 | 用途 |
|---|---|---|
| `nm_v2_role_security_parts_torso.png` | personnel | 运行素材 |
| `nm_v2_role_security_parts_shoulder_near.png` | personnel | 运行素材 |
| `nm_v2_role_security_parts_shoulder_far.png` | personnel | 运行素材 |
| `nm_v2_role_research_parts_torso.png` | personnel | 运行素材 |
| `nm_v2_role_research_parts_shoulder_near.png` | personnel | 运行素材 |
| `nm_v2_role_research_parts_shoulder_far.png` | personnel | 运行素材 |
| `nm_v2_role_technical_parts_torso.png` | personnel | 运行素材 |
| `nm_v2_role_technical_parts_shoulder_near.png` | personnel | 运行素材 |
| `nm_v2_role_technical_parts_shoulder_far.png` | personnel | 运行素材 |
| `nm_v2_role_medical_parts_torso.png` | personnel | 运行素材 |
| `nm_v2_role_medical_parts_shoulder_near.png` | personnel | 运行素材 |
| `nm_v2_role_medical_parts_shoulder_far.png` | personnel | 运行素材 |
| `nm_v2_abn_nailong_base_parts_body.png` | abnormalities | 运行素材 |
| `nm_v2_abn_maodie_base_parts_body.png` | abnormalities | 运行素材 |
| `nm_v2_abn_maodie_base_parts_calm_face.png` | abnormalities | 运行素材 |
| `nm_v2_abn_maodie_pollution_parts_outburst_face.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_body.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_head_ears.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_eyes.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_upper_muzzle.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_lower_muzzle.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_tongue.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_front_leg.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_hind_leg.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_tail.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_base_parts_collar_tag.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_work_reference_greet.png` | abnormalities | 参考 |
| `nm_v2_abn_big_dog_work_reference_relax.png` | abnormalities | 参考 |
| `nm_v2_abn_big_dog_pollution_identity_approved.png` | abnormalities | 参考 |
| `nm_v2_abn_big_dog_pollution_parts_hype_eyes.png` | abnormalities | 运行素材 |
| `nm_v2_abn_big_dog_combat_reference_walk_left_support.png` | abnormalities | 参考 |
| `nm_v2_abn_big_dog_combat_reference_walk_right_support.png` | abnormalities | 参考 |
| `nm_v2_abn_big_dog_combat_reference_windup.png` | abnormalities | 参考 |
| `nm_v2_abn_big_dog_combat_reference_attack_peak.png` | abnormalities | 参考 |
| `nm_v2_abn_big_dog_combat_reference_hit_recoil.png` | abnormalities | 参考 |
| `nm_v2_abn_dingdong_chicken_base_parts_body.png` | abnormalities | 运行素材 |
| `nm_v2_abn_dingdong_chicken_base_parts_head_neck.png` | abnormalities | 运行素材 |
| `nm_v2_abn_dingdong_chicken_base_parts_lower_beak_wattle.png` | abnormalities | 运行素材 |
| `nm_v2_abn_dingdong_chicken_base_parts_wing.png` | abnormalities | 运行素材 |
| `nm_v2_abn_dingdong_chicken_base_parts_tail_feathers.png` | abnormalities | 运行素材 |
| `nm_v2_abn_dingdong_chicken_pollution_identity_approved.png` | abnormalities | 参考 |
| `nm_v2_abn_dingdong_chicken_combat_reference_windup.png` | abnormalities | 参考 |
| `nm_v2_abn_gugu_gaga_base_parts_body_belly.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_head_face_patch.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_upper_beak.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_lower_beak.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_flipper_left.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_flipper_right.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_foot_left.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_foot_right.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_scarf_collar.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_scarf_long.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_base_parts_scarf_short.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_work_reference_flippers_up.png` | abnormalities | 参考 |
| `nm_v2_abn_gugu_gaga_work_reference_settled.png` | abnormalities | 参考 |
| `nm_v2_abn_gugu_gaga_pollution_identity_approved.png` | abnormalities | 参考 |
| `nm_v2_abn_gugu_gaga_pollution_parts_cry_eyes.png` | abnormalities | 运行素材 |
| `nm_v2_abn_gugu_gaga_combat_reference_walk_left_support.png` | abnormalities | 参考 |
| `nm_v2_abn_gugu_gaga_combat_reference_walk_right_support.png` | abnormalities | 参考 |
| `nm_v2_abn_gugu_gaga_combat_reference_windup.png` | abnormalities | 参考 |
| `nm_v2_abn_gugu_gaga_combat_reference_attack_peak.png` | abnormalities | 参考 |
| `nm_v2_abn_gugu_gaga_combat_reference_hit_recoil.png` | abnormalities | 参考 |
| `nm_v2_armor_nailong_torso.png` | equipment | 运行素材 |
| `nm_v2_armor_nailong_shoulder_near.png` | equipment | 运行素材 |
| `nm_v2_armor_nailong_shoulder_far.png` | equipment | 运行素材 |
| `nm_v2_armor_maodie_torso_collar.png` | equipment | 运行素材 |
| `nm_v2_armor_maodie_shoulder_near.png` | equipment | 运行素材 |
| `nm_v2_armor_maodie_shoulder_far.png` | equipment | 运行素材 |
| `nm_v2_armor_maodie_scarf_long.png` | equipment | 运行素材 |
| `nm_v2_armor_maodie_scarf_short.png` | equipment | 运行素材 |
| `nm_v2_armor_big_dog_torso.png` | equipment | 运行素材 |
| `nm_v2_armor_big_dog_shoulder_near.png` | equipment | 运行素材 |
| `nm_v2_armor_big_dog_shoulder_far.png` | equipment | 运行素材 |
| `nm_v2_armor_dingdong_torso.png` | equipment | 运行素材 |
| `nm_v2_armor_dingdong_shoulder_near.png` | equipment | 运行素材 |
| `nm_v2_armor_dingdong_shoulder_far.png` | equipment | 运行素材 |
| `nm_v2_weapon_gugu_held.png` | equipment | 运行素材 |
| `nm_v2_armor_gugu_torso_collar.png` | equipment | 运行素材 |
| `nm_v2_armor_gugu_shoulder_near.png` | equipment | 运行素材 |
| `nm_v2_armor_gugu_shoulder_far.png` | equipment | 运行素材 |
| `nm_v2_armor_gugu_ribbon_long.png` | equipment | 运行素材 |
| `nm_v2_armor_gugu_ribbon_short.png` | equipment | 运行素材 |
| `nm_v2_ui_skill_icon_s01_stun.png` | ui_vfx | 运行素材 |
| `nm_v2_ui_skill_icon_s03_howl.png` | ui_vfx | 运行素材 |
| `nm_v2_ui_skill_icon_s05_calm.png` | ui_vfx | 运行素材 |
| `nm_v2_show_compression_shard_key.png` | ui_vfx | 运行素材 |
