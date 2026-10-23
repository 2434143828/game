# 美术命名规范

所有新资源ID使用英文小写`snake_case`。沿用已有TypeScript文件和导出名，避免为重命名破坏程序引用；资源ID与实现位置由`public/art/asset_mapping.json`对应。

格式：`类别_对象_状态或用途_版本`，同类首版使用`a`或`01`。文件扩展名表示实际格式，不给程序资源伪造`.png`引用。

| 类别 | 示例 |
|---|---|
| 员工 | `agent_base_idle_01`、`agent_base_walk_01`、`agent_panic_idle_01`、`agent_incapacitated_01` |
| 五物 | `abn_nailong_idle_01`、`abn_maodie_breach_01`、`abn_big_dog_work_01` |
| 房间 | `room_containment_a`、`room_control_a`、`room_medical_a`、`corridor_industrial_a` |
| 界面 | `ui_brand_seal`、`ui_terminal_icons`、`ui_archive_rule`、`ui_alert_breach_red` |
| 特效 | `vfx_hit_ink_a`、`vfx_panic_smear_a`、`vfx_breach_frame_a`、`vfx_pressure_danger_a` |

五物词根固定为`nailong`、`maodie`、`big_dog`、`dingdong_chicken`、`gugu_gaga`。人物头发/制服/装备可以复用同一个绘制基底，通过真实员工ID和装备ID选择拆件，不为每种组合复制全部代码。

以后新增资源先登记ID、用途、状态来源、实现位置、锚点和替换关系，再接入真实渲染。不得把概念海报命名为`gameplay_screenshot`或作为验收实机图。
