# v0.2 单室两人场景：实际运行验收

2026-10-16。默认入口已替换为二维设施剖面。当前交付是一间奶龙收容室、连续走廊、安全室与两名员工的独立调试场景，不代表五物三日版本完成。

## 已实现

- Phaser真实场景：工业墙体、地板、门、观察窗、工作设备、可攀爬梯井、安全室。设施视区1328×720，占1600×900画幅66.4%。
- 两名66逻辑像素高的分部件小人，有头、躯干、四肢、制服与武器。行走、攀梯、作业、前摇、挥击和受击都由同一Simulation状态驱动。
- 场内点选、Shift加选、跨室拖框；右键移动与镇压；工作必须走进收容室到工作位；S原地停止，R撤退。
- 奶龙主样本与两分身是真实独立实体；员工进入射程后攻击；撤退取消未命中的前摇；安全室到位后延时恢复。
- 暂停冻结移动、工作、攻击和关联动作，可修改命令后恢复执行。梯井中停止保留抓梯姿态。

保留原模拟、伤害、存档和测试。七份config与原v0.1包SHA256全部相同。正式日1仍4人；新调试入口不读取、不写入正式存档。位置显示使用统一仿射映射与固定前后景偏移，不改变模拟路程、速度、射程或伤害。

## 已验证：真实连续操作

[最终录屏：1600×900、115秒、VP9/25fps](spatial-evidence/video/page@c2dd0dcf33ea4b5faec28550fe4f7d44.webm) · [完整命令、状态与采样](spatial-evidence/continuous-proof.json) · [视频元数据](spatial-evidence/video-verification.json)

采用实际Chrome渲染、Playwright鼠标键盘输入及真实运行时间；DEV桥只读。没有调用step快进、注入生命/能量、直接改位置或播放预录角色动画。最终一轮26检查点、1127次只读采样，浏览器错误0。以下时间为模拟秒，暂停期间不推进；录屏为连续实际操作。

| 模拟秒 | 真实操作与结果 | 截图 |
|---:|---|---|
| 0.25 | 设施、房内样本和两名可选员工 | [正常设施](spatial-evidence/01-normal-facility.png) |
| 2.95→3.60 | E01行走中改目的地，实际转向；随后框选两人移动 | [途中改令](spatial-evidence/04-midwalk-redirect.png) |
| 10.50→11.55 | 暂停派遣，恢复走一段，再暂停改为撤退；工作取消且收入0 | [暂停改令](spatial-evidence/07-paused-midtravel-retreat.png) |
| 20.40 | 员工抵达工作位后才开始观察，显示室内记录动作 | [进室作业](spatial-evidence/08-inside-room-working.png) |
| 44.45 | 完整24秒观察完成：累计0→12，钱包50→62 | [实际收入](spatial-evidence/10-actual-work-income.png) |
| 47.55 | 门口附近E02到位开工；近程1.65秒，E01远程7.20秒 | [近处员工抵达](spatial-evidence/11-near-worker-arrival.png) |
| 50.35 | 调试按钮调用原失效函数，生成可分别点选的一主两分身 | [真实失效](spatial-evidence/13-real-main-and-two-clones.png) |
| 57.20→57.40 | 先移动拉开，再下镇压命令主动接近：距离141.83→102.83，仍大于射程65，主样本HP保持180 | [射程外接近](spatial-evidence/17-approaching-before-weapon-range.png) |
| 61.55 | 进入射程完成真实前摇后攻击，主样本HP降至132；员工受到白伤 | [实际出手受击](spatial-evidence/18-real-attacks-and-hit-feedback.png) |
| 62.50→69.95 | 前摇中暂停改撤退；恢复后沿路撤离并进安全室，主样本HP维持132 | [场内撤退](spatial-evidence/21-retreating-through-facility.png) |
| 80.40 | 安全室到位并经过延时恢复后两人满HP/SP，再次派出 | [恢复完成](spatial-evidence/23-free-recovery-after-arrival.png) |
| 94.90→104.95 | 主样本镇压完成，分身立即清除，10秒后重新收容；累计/钱包仍12/62 | [重新收容](spatial-evidence/25-ten-second-recovery-complete.png) |

暂停分别检查移动、作业和攻击前摇，前后模拟时钟、位置及动作状态逐项相同。选择与改令仍可用。测试还实际检查了室内起拖的跨区域框选、独立点选三个敌人、待命员工不会自动反击、撤退后不再伤害敌人。

首次运行发现并修复了重叠目标点击被员工拦截、梯井被墙覆盖等问题；首次失败保存于[attempt-01](spatial-evidence/attempt-01/continuous-proof.json)，第二轮通过记录保存于[attempt-02](spatial-evidence/attempt-02/continuous-proof.json)。最终录像在最后一次源码修复后重新完整录制。

## 已验证：专项与工程检查

| 实际命令 | 结果及边界 |
|---|---|
| `py -3 validation/validate_design.py` | 459断言通过，仅设计数据校验 |
| `py -3 -m unittest discover -s validation -p 'test_*.py'` | 20公式例算通过，不是游戏测试 |
| `npm run typecheck` | 通过 |
| `npm run test` | 6文件、101测试通过；90项保留测试＋11项调试隔离/空间命令测试 |
| `npm run build` | 通过；Phaser vendor约1.48MB，有包体提示 |
| `node scripts/spatial-slice-proof.mjs` | 最终26连续检查点通过，115秒实际录像 |
| `node scripts/spatial-ladder-stop.mjs` | 安全室连接梯与收容室连接梯中STOP、暂停改令、工作取消专项通过 |
| `node scripts/spatial-production-smoke.mjs` | 实际生产包1280×720，收起详情后框选/移动/暂停通过；无滚动、无DEV桥、无外部请求或页面错误 |

本机python3为WindowsApps占位入口，因此实际使用py -3。完整专项结果：[梯井停止](spatial-evidence/ladder-stop-proof.json)、[生产包](spatial-evidence/production-smoke.json)、[1280实际截图](spatial-evidence/production-1280-collapsed.png)。

## V项边界与未验证内容

| 项目 | 本轮判定 |
|---|---|
| V01 | 调试场景形态和66.4%设施视区已实际检查；正式日1接回新场景尚未完成 |
| V02 | 1280×720收起详情/日志后，场内点选及调度通过 |
| V03 | 点选、Shift加选、拖框与真实受命对象对应通过 |
| V04 | 工作途中暂停改撤退、取消不入账通过 |
| V05 | 两员工远近行程不同、到位起工与室内动作通过 |
| V06 | 单室一主两分身、独立点选与停产通过；其他房间继续产能未接入新场景 |
| V07 | 射程外接近、出手、受击、撤退停止追击与安全室恢复通过 |
| V08 / V09 / V11 | 大狗范围、五技能、换装画面尚未接入，未验证 |
| V10 | 暂停冻结移动、工作、攻击及动作；暂停改令通过 |
| V12 | 同一轮连续录像、26截图检查点、命令与采样记录齐全 |

M0单室空间操作与M1单室闭环已验证。正式四人日1、其余四物、装备/技能、三日流程的新场景接入仍待做；旧逻辑测试不能代替这些画面的验收。也未完成其他浏览器、低端设备性能和非开发者易用性试玩。

## 占位素材

设施、员工、奶龙主样本/分身、武器与动作均为程序绘制的可替换原创概念占位，不声称官方角色还原。本场景没有角色原声、背景音乐或外部IP下载，不请求摄像头或麦克风。
