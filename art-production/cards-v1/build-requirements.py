import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
cards = json.loads((ROOT / 'config/gameplay-v3.json').read_text(encoding='utf-8'))['cards']
themes = {
 'T': ('机构训练', 'cool cyan, slate blue, clean white', 'standard containment baton and a white-coated field officer'),
 'N01': ('奶龙', 'warm cream yellow, milk white, pale amber', 'rounded yellow containment emitter, soft bubble shapes and repeated soft silhouettes'),
 'N02': ('耄耋', 'dusty pink, warm gray, crimson accents', 'cat-claw containment gauntlet, jagged emotion bursts and strong diagonal impact strokes'),
 'N03': ('大狗', 'bright coral pink, red orange, white', 'canine-inspired acoustic amplifier, concentric sound rings and tiny heart-shaped light particles'),
 'N04': ('叮咚鸡', 'signal yellow, orange, cool gray', 'compact broadcast speaker, blank notification panels and clear audio waveforms'),
 'N05': ('咕咕嘎嘎', 'pastel blue, pink white, gentle lavender', 'rounded calming sound emitter, soft emotion ripples and translucent bubbles'),
}
actions = {
 'T01': ('攻击', 'A gloved hand drives a standard containment baton diagonally into a small neutral training target. One clear red-white contact spark, compact close-range strike, dynamic motion lines.', '警棍近身打击，单一命中爆点，手臂与武器占主视觉。'),
 'T02': ('防御', 'A white-coated field officer braces a forearm guard against an incoming slash. A small cyan barrier curves tightly around only this one officer, a grounded defensive stance.', '单名员工前臂格挡，薄蓝护罩，不能画成全队屏障。'),
 'T03': ('辅助', 'One white-coated field officer sends a compact calming pulse from a handheld communications device toward a second small officer silhouette. Gentle focused cyan ripples restore composure, no medical blood or wounds.', '通讯器向一名队友传递精神鼓舞，单体脉冲。'),
 'N01_1': ('攻击', 'A gloved officer hand triggers a rounded yellow containment emitter. One forceful cream-white speech-bubble-shaped pulse strikes a small dark target silhouette. Repeated small rounded afterimages follow the main pulse, a single readable directional action.', '奶黄装备发射白伤气泡冲击，单体目标，重复残影只作污染母题。'),
 'N01_2': ('控制', 'A rounded yellow emitter sends a firm cream-colored interrupt ring that breaks a hostile charging waveform in two. The small target silhouette is held inside a rounded restraint bubble, clear stopped-motion composition.', '奶黄停止环切断蓄力波形，气泡束缚表现2秒控制。'),
 'N01_3': ('特殊', 'A yellow module echoes one already fired attack pulse into a second smaller translucent copy. Two overlapping offset pulse silhouettes and a short copying trail. Exactly one smaller repeated attack, no recursive infinite sequence.', '一主一副攻击投影，副本更小更淡，体现50%复制且不可递归。'),
 'N02_1': ('攻击', 'A claw-shaped containment gauntlet lunges diagonally into a small target silhouette. Three bold short crimson slash marks and a jagged dusty-pink impact burst, aggressive close-range pounce energy.', '爪形装备近身扑击，短促红色爪痕，单体爆点。'),
 'N02_2': ('防御', 'One officer braces a cat-claw gauntlet in front of the body. A jagged fur-like defensive outline absorbs an incoming hit. Compact shield silhouette with dusty-pink sparks, protecting only the wearer.', '单人炸毛式尖刺护罩，受击线被挡在外侧。'),
 'N02_3': ('防御', 'A guarded claw gauntlet first catches an incoming strike, then a single bold crimson counter-slash rebounds toward the attacker. Two-step diagonal composition, defensive contact point leading to one retaliatory arc.', '先挡后反击的双阶段构图，仅一次反击弧，不画持续旋风。'),
 'N03_1': ('攻击', 'A canine-inspired acoustic amplifier emits a compact circular shockwave around one target impact point. Small nearby dark target silhouettes sit inside the short sound radius. Tiny heart light particles and three clear waveform rings.', '目标周围紧凑音浪环，120范围群攻，爱心粒子点缀。'),
 'N03_2': ('控制', 'A bright coral acoustic emitter projects a broad fan of sound rings from left to right, visibly pushing one small dark target silhouette backward. A broken charging waveform marks interruption, directional displacement is the main action.', '扇形声浪将目标向后推，蓄力波形断裂，强调击退方向。'),
 'N03_3': ('攻击', 'A canine acoustic amplifier releases a large charged shockwave after compression. A tight bright core opens into wide concentric coral rings engulfing several small target silhouettes. Strong central wave crest and heart sparks, clearly more powerful than a short bark.', '压缩音核爆发为宽音浪，180范围，强度显著高于大狗叫。'),
 'N04_1': ('攻击', 'A compact yellow broadcast speaker launches a concentrated volley of blank notification-shaped panels into one target. Black-violet interference at the contact point with yellow waveform trails. One combined impact, not separate health and sanity strikes.', '通知窗集中撞向单体，黄黑干扰爆点，一次镇压扣值。'),
 'N04_2': ('控制', 'A yellow broadcast module places a bright paused waveform in front of an enemy attack pulse. A small abstract clock ring stretches the pulse spacing to imply delay. Clean frozen audio bars, no written numerals or labels.', '通知条拦截攻击波，时间环拉开波形间距，表达延后而非伤害。'),
 'N04_3': ('辅助', 'A broadcast speaker sends one looping orange audio arc through three small allied officer silhouettes, then concentrates into the next outgoing attack waveform. One clear loop and brighter final pulse, a one-use team amplification module.', '广播回环连接三名队友并汇入下一道攻击，单次全队增幅。'),
 'N05_1': ('攻击', 'A rounded pastel sound emitter sends a gently shaped but forceful pale blue-white ripple toward one dark target silhouette. Soft bubbles gather into a focused pressure wave, clear offensive direction despite the gentle palette.', '柔蓝白声波集中命中单体，柔和配色仍需攻击方向明确。'),
 'N05_2': ('辅助', 'A calming emitter surrounds exactly one white-coated allied officer silhouette with a translucent pale-blue bubble and gentle pink emotion ripples. Restored composure, soft balanced posture, focused single-target support.', '单名队友被情绪泡泡包裹，表现精神恢复，不暗示实际护盾。'),
 'N05_3': ('辅助', 'A rounded calming device sends three connected pastel-blue and pink-white ripple circles toward three small allied officer silhouettes. Shared soothing wave and relaxed poses, a clear whole-team mental recovery composition.', '三名队友由柔和波纹连接，全队安抚，与单体安抚清楚区分。'),
}
prefix = 'Create a production-ready square 1:1 skill-action illustration for a modern new-media containment institution game. Clean graphic hand-drawn anime technique, crisp dark ink contours, restrained cel shading, readable at a 100-pixel thumbnail, half illustration and half abstract equipment effect diagram. This is the artwork window of a professional digital combat module, not a full card layout. '
suffix = ' Square crop, one unmistakable focal action centered with 10% safe margins; subtle deep navy scientific backdrop, luminous action isolated with strong contrast. Keep all important shapes inside the crop. No letters, no Chinese text, no numbers, no labels, no logos, no card border, no interface frame, no large character portrait, no fantasy parchment, no ornate golden trim, no photorealism, no gore. Opaque background.'
out = []
for cid,c in cards.items():
 source = cid[:3] if cid.startswith('N') else 'T'
 name,palette,motif = themes[source]
 category,action,composition = actions[cid]
 out.append({'cardId':cid,'name':c['name'],'source':source,'sourceName':name,'category':category,'path':f'public/art/cards-v1/{cid.lower()}.png','width':1024,'height':1024,'alpha':False,'mechanics':c['description'],'target':c['target'],'rangePx':c['rangePx'],'windupSec':c['windupSec'],'composition':composition,'reference':f'附件 E.G.O. 战斗卡牌美术方案 V1；{name}装备母题；现有 {cid} 配置','palette':palette,'prompt':prefix+f'Palette: {palette}. Motif: {motif}. '+action+suffix,'status':'待生成'})
(ROOT/'art-production/cards-v1').mkdir(parents=True,exist_ok=True)
(ROOT/'art-production/cards-v1/requirements.json').write_text(json.dumps({'version':'cards-v1','sourceAttachment':'689d3499-9b11-4b52-84e6-4372f9e3f42f','specDate':'2026-10-23','artworkRatio':'1:1','runtimeCardRatio':'0.68:1','items':out},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'{len(out)} requirements written')
