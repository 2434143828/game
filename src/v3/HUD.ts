import type { AnomalyId, ArmorId, EmployeeId, Result, WeaponId } from '../../contracts/data-contract';
import { anomalyById, armorById, weaponById } from '../data/config';
import { cardById, v3Config, weaponCards } from './config';
import type { V3Simulation } from './engine';
import type { V3Scene } from './Scene';
import { escape } from '../ui/format';
import { CardHand } from './CardHand';
import type { CardPresentation } from './CardEffects';
import { icon, type IconName } from './icons';
import { creaturePortrait } from './portraits';

const rank = (n: number): string => ['—','I','II','III'][n] ?? String(n);
const hint = (label: string): string => `title="${escape(label)}" aria-label="${escape(label)}" data-tooltip="${escape(label)}"`;
const metric = (name: IconName, value: string, label: string): string => `<span class="v06-metric" ${hint(label)}>${icon(name)}<b>${escape(value)}</b></span>`;
const shortCondition = (text: string): string => text.replace('需要先抓捕','前置：').replace('需要三个收容物达到 II 阶','前置：3 × II').replace('需要奶龙 II 阶','前置：N01 II').replace(/^需要 (\d+) 能量$/,'$1 E').replace('所有收容物已达最高阶','全员 III');

/** HUD has selection state only; cards, clocks, inventory and health belong to the simulation. */
export class V3HUD {
  private roomId: AnomalyId = 'N01';
  private employeeId: EmployeeId = 'E01';
  private armedCard: string | null = null;
  private message = '';
  private messageUntilMs = 0;
  private modal: 'challenge'|'capture'|'equipment'|'abandon'|'profile'|'employee'|null = null;
  private modalTarget: AnomalyId = 'N01';
  // Result feedback is driven by the simulation clock.  Keeping the deadline
  // in the HUD preserves the result state for one visible frame/short pause,
  // then uses the same finishEncounter() transition as the manual fallback.
  private autoReturnEncounterId: string | null = null;
  private autoReturnAtSec: number | null = null;
  private cache = new Map<string,string>();
  private hand: CardHand;
  constructor(private root: HTMLElement, readonly simulation: V3Simulation, readonly scene: V3Scene, private persist: () => void) {
    root.className = 'v3-ui v06-ui v07-ui';
    root.innerHTML = `<header class="v3-top"><div class="v3-brand"><b>网梗收容</b><small>OPS-07</small></div><div class="v07-resources"><span id="v3-income"></span><strong id="v3-wallet"></strong></div><div class="v07-controls"><span id="v3-mode"></span><span id="v3-clock"></span><button data-v3="speed" data-value="1" ${hint('模拟速度 1 倍')}>1×</button><button data-v3="speed" data-value="2" ${hint('模拟速度 2 倍')}>2×</button><button data-v3="pause" class="v06-icon-button"></button><button data-v3="save" class="v06-icon-button" ${hint('保存进度')}>${icon('save')}</button></div></header>
      <nav class="v3-map-tools v07-tools" aria-label="设施视图与帮助"><button data-v3="overview" class="v06-icon-button" ${hint('设施总览 · Home')}>${icon('home')}</button><button data-v3="focus" class="v06-icon-button" ${hint('跟随选中员工 · F')}>${icon('follow')}</button><details class="v06-help"><summary ${hint('操作帮助与最近记录')}>${icon('help')}</summary><div class="v06-help-panel"><b>操作帮助</b><p>点选员工，右键走廊调度；滚轮缩放，中键拖动。Home 总览，F 跟随。</p><p>点击收容物查看行动。Space 暂停；暂停时可改令或预备一张卡，Esc 取消。</p><p>卡牌：点击选牌，再点击场内目标。员工名单也可作为友方目标。</p><p>关闭详情后，点击继续恢复模拟。</p><div id="v3-log"></div><div id="v06-last-message"></div></div></details></nav>
      <div id="v3-victory-card"></div>
      <aside class="v3-side"><details class="v06-roster v07-personnel" open><summary><span class="v07-section-label">PERSONNEL</span><span id="v06-roster-summary"></span>${icon('chevron')}</summary><div id="v3-roster" class="v06-roster-grid"></div></details><div id="v3-room" class="v07-entity-panel"></div><div id="v3-intent" class="v07-next-panel"></div></aside>
      <section class="v3-bottom"><div id="v3-deck-status"></div><div id="v3-hand"></div><div id="v3-deck-bins"></div><div id="v3-facility-actions"></div></section>
      <footer id="v3-message" role="status" aria-live="polite" hidden></footer><div id="v3-modal"></div>`;
    this.hand = new CardHand(root.querySelector<HTMLElement>('#v3-hand')!, simulation, scene);
    root.addEventListener('click', event => this.click(event));
    document.addEventListener('keydown', event => {
      if (/INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName ?? '') || event.repeat) return;
      // Modal dialogs already own a paused simulation. Space must not resume
      // hidden movement/combat behind the modal; close it first, then continue.
      if (event.code === 'Space') { event.preventDefault(); if (this.modal) return; this.simulation.setPaused(this.simulation.state.timeScale !== 0); this.persist(); }
      if (event.code === 'Escape') { if (this.modal) this.close(); else { this.armedCard = null; this.simulation.cancelCard(); } }
    });
  }
  notify(message: string): void { this.message = message; this.messageUntilMs = performance.now() + 6500; }
  cardPresentation(): CardPresentation | null {
    const enc = this.simulation.state.encounter;
    if (!enc || enc.result) return null;
    const card = enc.deck.hand.find(c => c.instanceId === (this.armedCard ?? enc.deck.pendingCast?.instanceId));
    if (!card) return null;
    const def = cardById[card.cardId];
    return { instanceId: card.instanceId, cardId: card.cardId, ownerId: card.ownerId, target: def.target, rangePx: def.rangePx, radiusPx: def.radiusPx };
  }
  cardTargetKind(): 'ALLY'|'ENEMY'|null {
    const card=this.simulation.state.encounter?.deck.hand.find(c=>c.instanceId===this.armedCard);
    const target=card?cardById[card.cardId].target:null;
    return target==='ALLY'||target==='ENEMY'?target:null;
  }
  selectRoom(id: AnomalyId): void { this.roomId = id; }
  selectEmployee(id: EmployeeId): void {
    this.employeeId = id;
    if (this.armedCard) {
      const c = this.simulation.state.encounter?.deck.hand.find(c=>c.instanceId===this.armedCard);
      if (c && cardById[c.cardId].target === 'ALLY') this.play(id);
    }
  }
  target(id: string): void { if (this.armedCard) this.play(id); else this.simulation.focusEnemy(id); }
  private result(result: Result<void>, success: string): boolean {
    this.notify(result.ok ? success : result.message);
    if (result.ok) this.persist();
    return result.ok;
  }
  private play(targetId: string): void {
    if (!this.armedCard) return;
    if (this.result(this.simulation.queueCard(this.armedCard,targetId), this.simulation.state.timeScale ? '员工正在接近目标并施牌。' : '已预备一张牌，恢复模拟后执行。')) this.armedCard=null;
  }
  private set(id: string, html: string): void {
    if (this.cache.get(id) === html) return;
    this.cache.set(id,html); this.root.querySelector(`#${id}`)!.innerHTML=html;
  }
  private text(id: string, text: string): void { const e=this.root.querySelector(`#${id}`)!;if(e.textContent!==text)e.textContent=text; }
  private close(): void { this.modal=null;this.set('v3-modal',''); }
  private open(kind: NonNullable<V3HUD['modal']>, id=this.roomId): void {
    this.modal=kind;this.modalTarget=id;this.simulation.setPaused(true);this.persist();this.renderModal();
  }
  private click(event: Event): void {
    const b=(event.target as HTMLElement).closest<HTMLElement>('[data-v3]');if(!b||b instanceof HTMLButtonElement && b.disabled)return;
    const sim=this.simulation,s=sim.state;
    switch(b.dataset.v3){
      case 'pause':sim.setPaused(s.timeScale!==0);this.persist();break;
      case 'speed':sim.setSpeed(b.dataset.value==='2'?2:1);break;
      case 'save':this.persist();this.notify('进度已保存。');break;
      case 'overview':this.scene.overview();break;
      case 'focus':this.scene.focusEmployee(this.employeeId);break;
      case 'employee':{ const id=b.dataset.id as EmployeeId;this.selectEmployee(id);this.scene.selectEmployee(id);break; }
      case 'employee-details':this.employeeId=b.dataset.id as EmployeeId;this.open('employee');break;
      case 'room':this.roomId=b.dataset.id as AnomalyId;this.scene.focusRoom(this.roomId);break;
      case 'challenge':this.open('challenge');break;
      case 'capture':this.open('capture',b.dataset.id as AnomalyId);break;
      case 'profile':this.open('profile',b.dataset.id as AnomalyId ?? this.roomId);break;
      case 'equipment':this.open('equipment');break;
      case 'abandon':this.open('abandon');break;
      case 'start-capture':{
        const employeeId=b.dataset.employeeId as EmployeeId|undefined;
        this.result(sim.startCapture(employeeId),'已启动收容装置，员工正在接近目标。');
        break;
      }
      case 'close':this.close();break;
      case 'confirm-encounter':{
        const mode=this.modal==='capture'?'CAPTURE':'BREACH_CHALLENGE';
        if(this.result(sim.startEncounter(mode,this.modalTarget),'战斗开始，三人自动接敌；点击卡牌再选择场内目标。')){this.close();this.armedCard=null;sim.setPaused(false);this.persist();}
        break;
      }
      case 'confirm-abandon':sim.abandonEncounter();this.close();this.persist();break;
      case 'return':if(this.result(sim.finishEncounter(),'已返回设施，稳定对象持续产能；员工在安全区恢复。'))this.armedCard=null;break;
      case 'next-target':{
        const target=b.dataset.id as AnomalyId;
        if (sim.state.encounter?.result) {
          const returned=sim.finishEncounter();
          if (!returned.ok) { this.notify(returned.message); break; }
          this.armedCard=null;
        }
        this.roomId=target; this.scene.focusRoom(target); this.notify(`已聚焦下一目标：${anomalyById[target].name}`); this.persist();
        break;
      }
      case 'card':{
        const id=b.dataset.id!;const reason=sim.cardUnavailable(id);
        if(reason){this.notify(reason);break;}
        this.armedCard=this.armedCard===id?null:id;
        if(!this.armedCard){this.notify('已取消选牌。');break;}
        const c=s.encounter!.deck.hand.find(c=>c.instanceId===id)!;const d=cardById[c.cardId];
        if(d.target==='SELF')this.play(c.ownerId);else if(d.target==='TEAM')this.play('TEAM');
        else this.notify(`${d.name}：点击${d.target==='ENEMY'?'场内敌人':'场内员工或右侧名单'}；Esc 取消。`);
        break;
      }
      case 'cancel-card':sim.cancelCard();this.armedCard=null;this.notify('已取消预备，牌保留且不触发冷却。');break;
      case 'equip':{
        const id=b.dataset.id as EmployeeId;
        const w=this.root.querySelector<HTMLSelectElement>(`[data-weapon-for="${id}"]`)!.value as WeaponId;
        const a=this.root.querySelector<HTMLSelectElement>(`[data-armor-for="${id}"]`)!.value as ArmorId;
        this.result(sim.equip(id,w,a,1),'装备已变更，卡组在下一场战斗开始时构建。');this.renderModal();break;
      }
      case 'upgrade':this.result(sim.upgradeEquipment(b.dataset.id as EmployeeId),'已提升至当前解锁的装备阶级。');this.renderModal();break;
    }
    this.render();
  }
  render(): void {
    const s=this.simulation.state;
    let enc=s.encounter;
    if (enc?.result) {
      if (this.autoReturnEncounterId !== enc.id) {
        this.autoReturnEncounterId = enc.id;
        // v0.4 keeps the result card readable for one fixed-step window before
        // the shared finishEncounter() path returns the squad to the facility.
        // This is simulation time, so tactical pause still freezes the window.
        this.autoReturnAtSec = s.simulationTimeSec + 1.25;
      }
      // Tactical pause freezes the simulation clock, so a paused result can be
      // inspected and manually returned without a wall-clock race.
      if (s.timeScale !== 0 && this.autoReturnAtSec !== null && s.simulationTimeSec + 1e-7 >= this.autoReturnAtSec) {
        const returned = this.simulation.finishEncounter();
        if (returned.ok) {
          this.armedCard = null;
          this.autoReturnEncounterId = null;
          this.autoReturnAtSec = null;
          this.notify('行动结算完成，已自动返回设施。');
          this.persist();
          enc = s.encounter;
        }
      }
    } else if (!enc) {
      this.autoReturnEncounterId = null;
      this.autoReturnAtSec = null;
    }
    this.root.classList.toggle('v3-in-combat', Boolean(enc));
    this.root.classList.toggle('v06-nailong-breach', Boolean(enc && enc.mode==='BREACH_CHALLENGE' && enc.targetAnomalyId==='N01' && !enc.result));
    this.set('v3-mode',`<span class="v06-mode" ${hint(enc?`${enc.mode==='CAPTURE'?'外勤抓捕':'主动失效'} · ${anomalyById[enc.targetAnomalyId].name}`:'设施稳定运行')}>${icon(enc?(enc.mode==='CAPTURE'?'field':'challenge'):'stable')}</span>`);
    this.set('v3-wallet',metric('energy',`${s.wallet.toFixed(1)} E`,'可用能量'));
    this.set('v3-income',metric('income',`${this.simulation.productionPerMinute().toFixed(0)}/min`,'当前总产能，每分钟能量'));
    this.set('v3-clock',metric('clock',`${Math.floor(s.simulationTimeSec/60).toString().padStart(2,'0')}:${Math.floor(s.simulationTimeSec%60).toString().padStart(2,'0')}`,'模拟时间；暂停时冻结'));
    const pause=this.root.querySelector('[data-v3="pause"]')!;
    const label=s.timeScale?'战术暂停 · Space':'继续模拟 · Space';
    if(pause.getAttribute('aria-label')!==label){pause.innerHTML=icon(s.timeScale?'pause':'play');pause.setAttribute('title',label);pause.setAttribute('aria-label',label);pause.setAttribute('data-tooltip',label);}
    this.root.querySelectorAll<HTMLElement>('[data-v3="speed"]').forEach(e=>e.classList.toggle('active',Number(e.dataset.value)===s.speed));
    this.root.querySelectorAll<HTMLElement>('.v3-map-tools > button').forEach(button=>{button.hidden=Boolean(enc);});
    const staff=s.employees.filter(e=>!enc||enc.squadIds.includes(e.id));
    const unsafe=staff.filter(e=>e.hp<=0||e.panicUntilSec>s.simulationTimeSec||e.hp<e.hpMax*0.35||e.sp<e.spMax*0.35).length;
    this.set('v06-roster-summary',`<b>${staff.length}</b><span class="v06-safety ${unsafe?'warning':''}" ${hint(unsafe?`${unsafe} 名员工需关注`:'员工状态安全')}>${icon(unsafe?'injury':'stable')}${unsafe?`<b>${unsafe}</b>`:''}</span>`);
    this.set('v3-roster',staff.map(e=>{
      const state: [IconName,string]=e.hp<=0?['injury','重伤']:e.panicUntilSec>s.simulationTimeSec?['panic','惊慌']:e.status==='MOVING'?['move','移动中']:e.status==='WORKING'?['work','作业中']:enc?['challenge','自动作战']:e.hp<e.hpMax-1e-7||e.sp<e.spMax-1e-7?['injury','恢复中']:['idle','待命'];
      const safety: IconName=e.panicUntilSec>s.simulationTimeSec?'panic':e.hp<e.hpMax-1e-7||e.sp<e.spMax-1e-7?'injury':'stable';
      return `<div class="v06-staff-row"><button data-v3="employee" data-id="${e.id}" class="v3-staff ${this.employeeId===e.id?'selected':''}" ${hint(`${e.displayName} · ${state[1]} · 体力 ${Math.ceil(e.hp)}/${e.hpMax} · 精神 ${Math.ceil(e.sp)}/${e.spMax}；点击选中或施放友方卡牌`)}><img src="${import.meta.env.BASE_URL}art/personnel-v3/head_e0${Number(e.id.slice(1))}.png" alt=""><span class="v06-staff-info"><b>${e.displayName}</b><span class="v06-status">${icon(state[0])}${icon(safety)}</span><i class="v3-hp" role="meter" aria-label="体力" aria-valuenow="${Math.ceil(e.hp)}" aria-valuemin="0" aria-valuemax="${e.hpMax}"><em style="width:${e.hp/e.hpMax*100}%"></em></i><i class="v3-sp" role="meter" aria-label="精神" aria-valuenow="${Math.ceil(e.sp)}" aria-valuemin="0" aria-valuemax="${e.spMax}"><em style="width:${e.sp/e.spMax*100}%"></em></i></span></button><button data-v3="employee-details" data-id="${e.id}" class="v06-staff-detail v06-icon-button" ${hint(`查看${e.displayName}详细状态`)}>${icon('chevron')}</button></div>`;
    }).join(''));
    const summary = enc?.result ? this.simulation.victorySummary() : null;
    this.set('v3-victory-card', summary ? this.resultCard(summary) : '');
    if(enc){
      const d=enc.deck;
      if(this.armedCard&&!d.hand.some(c=>c.instanceId===this.armedCard))this.armedCard=null;
      const capturePhase=enc.capturePhase??'COMBAT';
      const captureAction=enc.mode==='CAPTURE'&&!enc.result&&capturePhase==='CAPTURABLE'?`<p class="v3-capture-ready">目标已压制，可启动收容装置。</p><button data-v3="start-capture" data-employee-id="${staff.find(e=>e.hp>0)?.id??''}" class="v3-primary">启动收容装置</button>`:enc.mode==='CAPTURE'&&!enc.result&&capturePhase==='CAPTURING'?`<p class="v3-capture-progress">收容进行中 ${((enc.captureProgressSec??0)/v3Config.capture.progressSec*100).toFixed(0)}%</p>`:'';
      this.set('v3-room',`<h3>${enc.result ? (enc.result==='VICTORY'?'行动成功':enc.result==='DEFEAT'?'行动失败':'已放弃行动'):'战斗进行中'}</h3><p>${enc.result==='VICTORY'?(enc.mode==='CAPTURE'?'对象已收容，开放 I 阶 E.G.O.。':'升阶已结算，新的产能与装备上限已解锁。'):enc.result?'未获得升阶或抓捕奖励。':capturePhase==='CAPTURABLE'?'目标进入收容确认阶段。队员停止致死攻击。':'队员自动追击。点击敌人集火，卡牌由所属员工执行。'}</p>${captureAction}${enc.result?'<small class="v3-result-hint">结算反馈后自动返回设施</small><button data-v3="return" class="v3-primary">立即返回设施</button>':'<button data-v3="abandon">放弃行动</button>'}`);
      this.set('v3-intent',`<h3>敌方意图</h3>${enc.enemies.map(e=>`<p class="v3-enemy-intent">${e.isClone?'分身':anomalyById[e.sourceAnomalyId].name} · ${Math.ceil(e.suppressionHp)}<br><strong>${e.stunnedUntilSec>s.simulationTimeSec?'受控':escape(e.intent)}</strong></p>`).join('')}`);
      const pending=d.pendingCast,pendingCard=d.hand.find(c=>c.instanceId===pending?.instanceId);
      const pendingOwner=s.employees.find(e=>e.id===pendingCard?.ownerId);
      const castStatus=pending&&pendingCard?`${pendingOwner?.displayName} · ${cardById[pendingCard.cardId].name}：${!s.timeScale?'已预备，继续后执行':pending.phase==='APPROACH'?'正在接近目标':`施放中 ${Math.max(0,(pending.resolvesAtSec??s.simulationTimeSec)-s.simulationTimeSec).toFixed(1)}s`}`:this.armedCard?`请选择${this.cardTargetKind()==='ALLY'?'员工（可点右侧名单）':'敌人（可点场内标签）'} · Esc取消`:'';
      this.text('v3-deck-status',`共享牌组 9　牌库 ${d.drawPile.length} / 弃牌 ${d.discardPile.length} / 移除 ${d.exhausted.length}　　${d.hand.length>=v3Config.combat.handLimit?'手牌已满 · 抽牌计时冻结':`抽牌 ${d.drawTimer.toFixed(1)}s`}　　公共冷却 ${d.globalCooldown.toFixed(1)}s　${castStatus}`);
      this.set('v3-deck-bins',`<div class="v3-deck-stack"><span>▤</span><b>${d.drawPile.length}</b><small>牌库</small></div><div class="v3-discard-stack"><span>↘</span><b>${d.discardPile.length}</b><small>弃牌</small></div><p>点击选牌 → 点击目标<br>暂停时可预备一张牌</p>`);
      this.set('v3-facility-actions','');
    } else {
      const r=s.rooms.find(r=>r.anomalyId===this.roomId)!;
      const condition=r.owned?null:this.simulation.captureCondition(r.anomalyId);
      const stamp=r.owned?'STABLE':condition?'LOCKED':'READY';
      this.set('v3-room',`<div class="v07-section-heading"><span class="v07-section-label">SELECTED ENTITY</span><small>PANEL-B</small></div><div class="v06-selected-head"><div class="v07-portrait-stage">${creaturePortrait(r.anomalyId)}</div><div class="v07-entity-identity"><h3>${anomalyById[r.anomalyId].name} <em>${rank(r.rank)}</em></h3><small>${r.anomalyId}</small><span class="v07-status-stamp ${stamp.toLowerCase()}" ${hint(r.owned?'稳定收容':condition??'可外勤抓捕')}>${stamp}</span></div></div><div class="v06-room-metrics">${metric('income',r.owned?`${v3Config.production[r.anomalyId][r.rank-1]}/min`:'—','该对象当前产能')}${metric('equipment',r.owned?`EGO ${rank(r.rank)}`:'—','E.G.O. 装备阶级上限')}<span class="v06-metric" ${hint(r.owned?'稳定收容':condition??'可外勤抓捕')}>${icon(r.owned?'containment':condition?'lock':'field')}</span></div><div class="v06-actions">${r.owned?`<button data-v3="challenge" class="v3-primary" ${hint(r.rank>=v3Config.facility.maxRank?'已达最高阶':'主动失效挑战；挑战期间目标停产')} ${r.rank>=v3Config.facility.maxRank?'disabled':''}>${icon('challenge')}${r.rank>=3?'满阶':'挑战'}</button>`:`<button data-v3="capture" data-id="${r.anomalyId}" class="v3-primary" ${hint(condition??`外勤抓捕 · ${v3Config.captureCosts[r.anomalyId]} E`)} ${condition?'disabled':''}>${icon('field')}外勤</button>`}<button data-v3="equipment" ${hint('小队装备 / 共享卡组')}>${icon('equipment')}装备</button><button data-v3="profile" data-id="${r.anomalyId}" class="v06-icon-button" ${hint(`查看${anomalyById[r.anomalyId].name}收容档案`)}>${icon('archive')}</button></div>${condition?`<span class="v06-condition" ${hint(condition)}>${icon('lock')}${escape(shortCondition(condition))}</span>`:''}`);
      const next=this.simulation.nextTarget();
      const nextLabel=`下一目标：${next.label}；${next.available?'条件已满足':next.requirement??'暂不可用'}`;
      const nextCondition=next.requirement?(/^需要 (\d+) 能量$/.test(next.requirement)?'能量不足':shortCondition(next.requirement)):null;
      this.set('v3-intent',`<div class="v07-section-heading"><span class="v07-section-label">NEXT TARGET</span><small>PANEL-C</small></div><section class="v3-next-target" ${hint(nextLabel)}><div class="v06-target-head">${icon(next.mode==='CAPTURE'?'field':'upgrade')}<b>${anomalyById[next.anomalyId].name}</b><span>${icon(next.available?'interact':'lock')}</span><button data-v3="next-target" data-id="${next.anomalyId}" class="v06-icon-button" ${hint(`聚焦${nextLabel}`)}>${icon('chevron')}</button></div><div class="v06-conditions"><span>${next.mode==='CAPTURE'?`${next.energyCost} E`:`${rank(next.currentRank)} → ${rank(next.nextRank)}`}</span>${nextCondition?`<span ${hint(next.requirement!)}>${escape(nextCondition)}</span>`:''}</div></section>`);
      this.text('v3-deck-status','');
      this.set('v3-deck-bins','');
      this.set('v3-facility-actions',s.rooms.map(r=>{
        const reason=r.owned?null:this.simulation.captureCondition(r.anomalyId);
        const status: IconName=r.owned?(r.rank<v3Config.facility.maxRank?'upgrade':'containment'):reason?'lock':'field';
        const label=`${r.anomalyId} ${anomalyById[r.anomalyId].name} ${rank(r.rank)} · ${r.owned?`${v3Config.production[r.anomalyId][r.rank-1]} E/分钟；${r.rank<v3Config.facility.maxRank?'可挑战升阶':'稳定收容'}`:reason??`可抓捕 · ${v3Config.captureCosts[r.anomalyId]} E`}；点击聚焦`;
        return `<button data-v3="room" data-id="${r.anomalyId}" class="v3-room-chip ${this.roomId===r.anomalyId?'selected':''} ${reason?'is-locked':''}" ${hint(label)} aria-pressed="${this.roomId===r.anomalyId}">${creaturePortrait(r.anomalyId,'v06-dock-portrait')}<span class="v06-dock-id">${r.anomalyId}</span><em>${r.owned?rank(r.rank):''}</em><span class="v06-dock-status">${icon(status)}</span></button>`;
      }).join(''));
    }
    this.hand.render(this.armedCard);
    this.set('v3-log',s.logs.slice(-2).map(l=>`<p>${escape(l.message)}</p>`).join(''));
    const visibleMessage=performance.now()<this.messageUntilMs?this.message:'';
    this.text('v3-message',visibleMessage);
    this.root.querySelector<HTMLElement>('#v3-message')!.hidden=!visibleMessage;
    this.text('v06-last-message',this.message);
  }
  private resultCard(summary: import('./model').VictorySummary): string {
    const success=summary.result==='VICTORY';
    const next=summary.nextTarget;
    const rankText=summary.previousRank===summary.currentRank?rank(summary.currentRank):`${rank(summary.previousRank)} → ${rank(summary.currentRank)}`;
    const rewards=summary.rewards.length?summary.rewards.map(item=>`<li>${escape(item)}</li>`).join(''):'<li>未获得奖励，进度保持不变</li>';
    return `<section class="v3-result-card ${success?'success':'failure'}" aria-live="polite"><header><span>行动结算 / ${summary.mode==='CAPTURE'?'外勤抓捕':'主动失效'}</span><strong>${success?'行动成功':'行动结束'}</strong></header><div class="v3-result-grid"><article><small>目标</small><b>${anomalyById[summary.anomalyId].name}</b><span>收容等级 ${rankText}</span></article><article><small>真实产能</small><b>${summary.productionAfter} E / 分钟</b><span>${summary.productionBefore} → ${summary.productionAfter}</span></article><article><small>E.G.O. 最高阶</small><b>${summary.egoTier?rank(summary.egoTier):'—'}</b><span>${summary.currentOwned?'已解锁':'未解锁'}</span></article></div><div class="v3-result-rewards"><small>真实奖励变化</small><ul>${rewards}</ul></div><div class="v3-result-next"><small>下一目标</small><b>${escape(next.label)}</b><span>${next.available?'条件已满足':escape(next.requirement??'暂不可用')}</span><button data-v3="next-target" data-id="${next.anomalyId}">返回并聚焦</button></div><footer><button data-v3="return" class="v3-primary">返回设施</button></footer></section>`;
  }
  private renderModal(): void {
    const s=this.simulation.state;let body='';
    if(this.modal==='employee') {
      const e=s.employees.find(employee=>employee.id===this.employeeId)!;
      body=`<section class="v06-employee-profile"><img src="${import.meta.env.BASE_URL}art/personnel-v3/head_e0${Number(e.id.slice(1))}.png" alt="${e.displayName}头像"><h2>${e.displayName}</h2><div class="v06-employee-stats">${metric('injury',`${Math.ceil(e.hp)} / ${e.hpMax}`,'体力')}${metric('panic',`${Math.ceil(e.sp)} / ${e.spMax}`,'精神')}</div><div class="v06-employee-equipment"><p>${icon('equipment')} ${weaponById[e.weaponId].name} · ${rank(e.weaponTier)}</p><p>${icon('deploy')} ${armorById[e.armorId].name} · ${rank(e.armorTier)}</p></div><details><summary>${icon('archive')} 战术卡组</summary><p>${weaponCards[e.weaponId].map(id=>cardById[id].name).join(' / ')}</p></details>${!s.encounter?`<button data-v3="equipment" class="v3-primary">${icon('equipment')}装备 / 卡组</button>`:''}</section>`;
    } else if(this.modal==='equipment'){
      body=`<h2>出战装备 / 九张共享卡组</h2><p>前三名员工出战，每把武器固定三张卡。正式装备各一份；制式训练装备可重复使用。升阶后点击“升级”应用新数值。</p>${s.employees.slice(0,3).map(e=>`<section class="v3-loadout"><b>${e.displayName}　武器 ${rank(e.weaponTier)} / 防具 ${rank(e.armorTier)}</b><div><select data-weapon-for="${e.id}" aria-label="${e.displayName}武器">${(['W00',...s.ownedWeapons] as WeaponId[]).map(w=>`<option value="${w}" ${w===e.weaponId?'selected':''}>${weaponById[w].name}</option>`).join('')}</select><select data-armor-for="${e.id}" aria-label="${e.displayName}防具">${(['A00',...s.ownedArmors] as ArmorId[]).map(a=>`<option value="${a}" ${a===e.armorId?'selected':''}>${armorById[a].name}</option>`).join('')}</select><button data-v3="equip" data-id="${e.id}">装备</button><button data-v3="upgrade" data-id="${e.id}">升级</button></div><p>${weaponCards[e.weaponId].map(id=>cardById[id].name).join(' / ')}</p></section>`).join('')}<p>关闭后点击“继续”恢复设施。</p>`;
    } else if(this.modal==='abandon') body='<h2>放弃本次行动？</h2><p>不会升阶或获得抓捕对象，已支付的外勤费用不返还。</p><button data-v3="confirm-abandon" class="v3-primary">确认放弃</button>';
    else if(this.modal==='profile') {
      const r=s.rooms.find(room=>room.anomalyId===this.modalTarget)!;
      const a=anomalyById[r.anomalyId];
      const status=r.owned?'稳定收容':'未收容';
      const statusClass=r.owned?'stable':'uncontained';
      const captureHint=this.simulation.captureCondition(r.anomalyId);
      body=`<div class="v3-profile-page" data-profile-id="${r.anomalyId}">
        <section class="v3-profile-idcard">
          <div class="v3-profile-idhead"><span class="v3-profile-kicker">${r.anomalyId}</span><span class="v3-profile-status ${statusClass}">${icon(r.owned?'containment':'lock')}${status}</span></div>
          <div class="v3-profile-portrait">${creaturePortrait(r.anomalyId,'',a.name+'档案头像')}</div>
          <h2>${a.name}</h2>
          <div class="v3-profile-rank">${metric('containment',r.owned?rank(r.rank):'—','收容等级')}${metric('income',r.owned?`${v3Config.production[r.anomalyId][r.rank-1]}/min`:'—','当前产能')}</div>
          <div class="v3-profile-tags"><span>${icon('challenge')}${a.breach.ai==='CHASE'?'追击型':'区域型'}</span></div>
        </section>
        <section class="v3-profile-record">
          <div class="v3-profile-title">${icon('archive')}<h2>收容档案</h2></div>
          <div class="v3-profile-grid">
            <details class="v3-profile-research" open><summary>${icon('archive')} 行为记录</summary><p>${escape(a.archive.behavior)}</p></details>
            <details class="v3-profile-warning"><summary>${icon('challenge')} 收容须知</summary><p>${escape(a.archive.combat)}</p></details>
            <article class="v3-profile-metric">${icon('equipment')}<div><small>E.G.O. 上限</small><p class="v3-profile-stat"><b>${r.owned?rank(r.rank):'—'}</b></p></div></article>
            <article class="v3-profile-metric">${icon('upgrade')}<div><small>下一阶产能</small><p class="v3-profile-production"><b>${r.owned&&r.rank<3?`${v3Config.production[r.anomalyId][r.rank]} /min`:r.owned?'已满阶':'未解锁'}</b></p></div></article>
          </div>
          <div class="v3-profile-footer"><span ${hint(captureHint??status)}>${icon(r.owned?'containment':captureHint?'lock':'field')}${r.owned?status:captureHint?escape(shortCondition(captureHint)):'可外勤'}</span><button data-v3="close" class="v3-primary">${icon('home')}返回</button></div>
        </section>
      </div>`;
    }
    else if(this.modal){const r=s.rooms.find(r=>r.anomalyId===this.modalTarget)!;body=`<h2>${this.modal==='capture'?'外勤抓捕':'主动失效挑战'} · ${anomalyById[r.anomalyId].name}</h2><p>${this.modal==='capture'?`入场消耗 ${v3Config.captureCosts[r.anomalyId]} E；成功首次收容 I 阶。`:`当前 ${rank(r.rank)} → ${rank(r.rank+1)}；目标挑战期间停止产能。`}</p><p>出战：${s.employees.slice(0,3).map(e=>e.displayName).join(' / ')}<br>三人自动接敌与普通攻击，九张卡按武器归属施放。<br>失败或放弃保留原收容阶级。先在装备界面配置奶龙 E.G.O.，可用打断牌反制蓄力。</p><button data-v3="confirm-encounter" class="v3-primary">确认出战</button>`;}
    this.set('v3-modal',this.modal?`<div class="v3-shade"><section class="v3-dialog ${this.modal==='profile'?'v3-profile-dialog':''}" role="dialog" aria-modal="true" aria-label="${this.modal==='profile'?'收容档案':this.modal==='employee'?'员工状态':'行动详情'}"><button class="v3-close v06-icon-button" data-v3="close" ${hint('关闭详情')}>${icon('close')}</button>${body}</section></div>`:'');
  }
}
