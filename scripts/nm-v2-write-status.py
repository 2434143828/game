"""Write an evidence-backed partial delivery report; never label pending art accepted."""
raise SystemExit('Historical partial-report writer disabled. Current evidence: docs/NM_V2_ART_ACCEPTANCE.md; do not overwrite it with the 2026-10-22 snapshot.')
import json
import shutil
from pathlib import Path
root = Path(__file__).resolve().parents[1]
read = lambda p: json.loads(p.read_text(encoding='utf-8-sig'))
queue = read(root/'art-production/nm-v2/generation-queue.json')['tasks']
coverage = read(root/'src/art/generated/nm-v2-coverage.json')
run = root/'docs/nm-v2-evidence-2026-10-22/run-2026-10-22T01-42-19.780Z'
prod = root/'docs/nm-v2-evidence-2026-10-22/production-2026-10-22T01-44-33.423Z'
r, p = read(run/'report.json'), read(prod/'report.json')
assert r['status']=='PASS' and r['artAcceptance']=='INCOMPLETE' and p['status']=='PASS'
showcase=root/'docs/showcase'
copies={'01-default-generated-facility.png':'nm-v2-facility.png','05-employee-inside-room-working.png':'nm-v2-work.png','08-actual-suppression-hit.png':'nm-v2-combat.png','09-retreating-after-suppression.png':'nm-v2-retreat.png'}
for src,dst in copies.items(): shutil.copy2(run/src,showcase/dst)
summary={'artAcceptance':'INCOMPLETE','coverage':coverage,'functional':{'status':r['status'],'checks':len(r['checks']),'inputs':len(r['inputs']),'screenshots':len(r['screenshots'])},'production':{'status':p['status'],'checks':len(p['checks'])},'sources':[str((run/'report.json').relative_to(root)),str((prod/'report.json').relative_to(root))]}
(showcase/'nm-v2-verification-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
counts=[]
for scope in ['personnel','abnormalities','equipment','environment','ui_vfx']:
    ts=[t for t in queue if t['scope']==scope]
    counts.append(f"| {scope} | {len(ts)} | {sum(t['status']!='pending' for t in ts)} | {sum(t['status']=='pending' for t in ts)} |")
pending='\n'.join(f"| `{t['filename']}` | {t['scope']} | {'参考' if t['referenceOnly'] else '运行素材'} |" for t in queue if t['status']=='pending')
report='''# 现代新媒体 v2 美术接入验收｜2026-10-22

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
'''+ '\n'.join(counts)+ '\n\n## 待补明细\n\n| 素材名 | 分类 | 用途 |\n|---|---|---|\n'+pending+'\n'
(root/'docs/NM_V2_ART_ACCEPTANCE.md').write_text(report,encoding='utf-8')
status=root/'STATUS.md'
old=status.read_text(encoding='utf-8')
heading='# 现代新媒体 v2 接入（2026-10-22，未全部完成）'
if not old.startswith(heading):
    old=old.replace('本段为当前版本。','本段为2026-10-21历史版本。',1)
    status.write_text(heading+'''\n\n当前状态以[本轮报告](docs/NM_V2_ART_ACCEPTANCE.md)为准，下方均为历史记录。

- 素材：221/307张导入，其中运行素材173/241、参考48/66；尚缺86张，包含生成失败及单图检查不合格项。
- 画面：现代设施81件接入，员工基型与UI/特效部分替换。五物仍为旧程序角色；岗位服装、部分装备和技能图标未完成。
- 逻辑：本轮仅调整美术适配与加载，不修改模拟、配置、导航或存档。
- 已验证：153测试、类型检查、构建、设计760断言和20公式例通过；真实连续链8项/63输入/19图；生产15项通过、正式第一日四人、暂停像素一致，浏览器错误0。
- 未验证：新版完整五物与服装装备装配、全三日、全部技能组合及跨设备性能。
- 阻塞：生图每日额度耗尽；不能宣称全部替换或视觉总验收通过。完整待补名单在本轮报告。

---

'''+old,encoding='utf-8')
readme=root/'README.md';s=readme.read_text(encoding='utf-8')
start=s.index('当前美术按');end=s.index('## 从仓库开始',start)
s=s[:start]+'''当前正在按v2需求表切换到**现代新媒体研究设施**：冷蓝灰建筑、制服员工和局部平台污染。221/307张素材已导入，五物仍使用旧程序角色占位，岗位服装和部分装备尚未补齐；**美术替换未完成**。场内调度、工作、攻击与暂停已做本轮实机回归，详见[当前美术验收与待补清单](docs/NM_V2_ART_ACCEPTANCE.md)。

![当前部分接入版真实游戏画面](docs/showcase/nm-v2-facility.png)

'''+s[end:];readme.write_text(s,encoding='utf-8')
print(json.dumps({'imported':coverage['imported'],'pending':len(coverage['pending']),'report':'docs/NM_V2_ART_ACCEPTANCE.md'}))
