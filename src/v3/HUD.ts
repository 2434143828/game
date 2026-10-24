import type { AnomalyId, ArmorId, EmployeeId, Result, WeaponId } from '../../contracts/data-contract';
import { anomalyById, armorById, weaponById } from '../data/config';
import { cardById, v3Config, weaponCards } from './config';
import type { V3Simulation } from './engine';
import type { V3Scene } from './Scene';
import { escape } from '../ui/format';
import { CardHand } from './CardHand';
import type { CardPresentation } from './CardEffects';

const rank = (n: number): string => ['—','I','II','III'][n] ?? String(n);

/** HUD has selection state only; cards, clocks, inventory and health belong to the simulation. */
export class V3HUD {
  private roomId: AnomalyId = 'N01';
  private employeeId: EmployeeId = 'E01';
  private armedCard: string | null = null;
  private message = '收容物稳定产能；点击房间，主动发起升阶挑战。';
  private modal: 'challenge'|'capture'|'equipment'|'abandon'|'profile'|null = null;
  private modalTarget: AnomalyId = 'N01';
  // Result feedback is driven by the simulation clock.  Keeping the deadline
  // in the HUD preserves the result state for one visible frame/short pause,
  // then uses the same finishEncounter() transition as the manual fallback.
  private autoReturnEncounterId: string | null = null;
  private autoReturnAtSec: number | null = null;
  private cache = new Map<string,string>();
  private hand: CardHand;
  constructor(private root: HTMLElement, readonly simulation: V3Simulation, readonly scene: V3Scene, private persist: () => void) {
    root.className = 'v3-ui';
    root.innerHTML = `<header class="v3-top"><div class="v3-brand"><b>网梗收容</b><small>稳定收容 / E.G.O. 战术行动</small></div><span id="v3-mode"></span><span id="v3-income"></span><strong id="v3-wallet"></strong><span id="v3-clock"></span><button data-v3="speed" data-value="1">1×</button><button data-v3="speed" data-value="2">2×</button><button data-v3="pause"></button><button data-v3="save">保存</button></header>
      <nav class="v3-map-tools"><button data-v3="overview">设施总览 Home</button><button data-v3="focus">跟随员工 F</button></nav>
      <aside class="v3-side"><h3>人员与行动</h3><div id="v3-roster"></div><div id="v3-room"></div><div id="v3-intent"></div><div id="v3-log"></div></aside>
      <section class="v3-bottom"><div id="v3-deck-status"></div><div id="v3-hand"></div><div id="v3-deck-bins"></div><div id="v3-facility-actions"></div></section>
      <footer id="v3-message"></footer><div id="v3-modal"></div>`;
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
  notify(message: string): void { this.message = message; }
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
      case 'save':this.persist();break;
      case 'overview':this.scene.overview();break;
      case 'focus':this.scene.focusEmployee(this.employeeId);break;
      case 'employee':{ const id=b.dataset.id as EmployeeId;this.selectEmployee(id);this.scene.selectEmployee(id);break; }
      case 'room':this.roomId=b.dataset.id as AnomalyId;this.scene.focusRoom(this.roomId);break;
      case 'challenge':this.open('challenge');break;
      case 'capture':this.open('capture',b.dataset.id as AnomalyId);break;
      case 'profile':this.open('profile',b.dataset.id as AnomalyId ?? this.roomId);break;
      case 'equipment':this.open('equipment');break;
      case 'abandon':this.open('abandon');break;
      case 'close':this.close();break;
      case 'confirm-encounter':{
        const mode=this.modal==='capture'?'CAPTURE':'BREACH_CHALLENGE';
        if(this.result(sim.startEncounter(mode,this.modalTarget),'战斗开始，三人自动接敌；点击卡牌再选择场内目标。')){this.close();this.armedCard=null;sim.setPaused(false);this.persist();}
        break;
      }
      case 'confirm-abandon':sim.abandonEncounter();this.close();this.persist();break;
      case 'return':if(this.result(sim.finishEncounter(),'已返回设施，稳定对象持续产能；员工在安全区恢复。'))this.armedCard=null;break;
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
    this.text('v3-mode',enc?`${enc.mode==='CAPTURE'?'外勤抓捕':'主动失效'} · ${anomalyById[enc.targetAnomalyId].name}`:'设施 / 稳定运行');
    this.text('v3-wallet',`${s.wallet.toFixed(1)} E`);this.text('v3-income',`产能 ${this.simulation.productionPerMinute().toFixed(0)} / 分钟`);
    this.text('v3-clock',`${Math.floor(s.simulationTimeSec/60).toString().padStart(2,'0')}:${Math.floor(s.simulationTimeSec%60).toString().padStart(2,'0')}`);
    const pause=this.root.querySelector('[data-v3="pause"]')!;const label=s.timeScale?'战术暂停 ▌▌':'继续 ▷';if(pause.textContent!==label)pause.textContent=label;
    this.root.querySelectorAll<HTMLElement>('[data-v3="speed"]').forEach(e=>e.classList.toggle('active',Number(e.dataset.value)===s.speed));
    this.root.querySelector<HTMLElement>('.v3-map-tools')!.hidden=Boolean(enc);
    const staff=s.employees.filter(e=>!enc||enc.squadIds.includes(e.id));
    this.set('v3-roster',staff.map(e=>`<button data-v3="employee" data-id="${e.id}" class="v3-staff ${this.employeeId===e.id?'selected':''}"><img src="${import.meta.env.BASE_URL}art/personnel-v3/head_e0${Number(e.id.slice(1))}.png" alt=""><span><b>${e.displayName}</b><small>${e.hp<=0?'重伤':e.panicUntilSec>s.simulationTimeSec?'惊慌':e.status==='MOVING'?'移动中':enc?'自动作战':'待命'}</small><i class="v3-hp"><em style="width:${e.hp/e.hpMax*100}%"></em></i><i class="v3-sp"><em style="width:${e.sp/e.spMax*100}%"></em></i><small>体 ${Math.ceil(e.hp)}　神 ${Math.ceil(e.sp)}</small></span></button>`).join(''));
    if(enc){
      const d=enc.deck;
      if(this.armedCard&&!d.hand.some(c=>c.instanceId===this.armedCard))this.armedCard=null;
      this.set('v3-room',`<h3>${enc.result ? (enc.result==='VICTORY'?'行动成功':enc.result==='DEFEAT'?'行动失败':'已放弃行动'):'战斗进行中'}</h3><p>${enc.result==='VICTORY'?(enc.mode==='CAPTURE'?'对象已收容，开放 I 阶 E.G.O.。':'升阶已结算，新的产能与装备上限已解锁。'):enc.result?'未获得升阶或抓捕奖励。':'队员自动追击。点击敌人集火，卡牌由所属员工执行。'}</p>${enc.result?'<small class="v3-result-hint">结算反馈后自动返回设施</small><button data-v3="return" class="v3-primary">立即返回设施</button>':'<button data-v3="abandon">放弃行动</button>'}`);
      this.set('v3-intent',`<h3>敌方意图</h3>${enc.enemies.map(e=>`<p class="v3-enemy-intent">${e.isClone?'分身':anomalyById[e.sourceAnomalyId].name} · ${Math.ceil(e.suppressionHp)}<br><strong>${e.stunnedUntilSec>s.simulationTimeSec?'受控':escape(e.intent)}</strong></p>`).join('')}`);
      const pending=d.pendingCast,pendingCard=d.hand.find(c=>c.instanceId===pending?.instanceId);
      const pendingOwner=s.employees.find(e=>e.id===pendingCard?.ownerId);
      const castStatus=pending&&pendingCard?`${pendingOwner?.displayName} · ${cardById[pendingCard.cardId].name}：${!s.timeScale?'已预备，继续后执行':pending.phase==='APPROACH'?'正在接近目标':`施放中 ${Math.max(0,(pending.resolvesAtSec??s.simulationTimeSec)-s.simulationTimeSec).toFixed(1)}s`}`:this.armedCard?`请选择${this.cardTargetKind()==='ALLY'?'员工（可点右侧名单）':'敌人（可点场内标签）'} · Esc取消`:'';
      this.text('v3-deck-status',`共享牌组 9　牌库 ${d.drawPile.length} / 弃牌 ${d.discardPile.length} / 移除 ${d.exhausted.length}　　${d.hand.length>=v3Config.combat.handLimit?'手牌已满 · 抽牌计时冻结':`抽牌 ${d.drawTimer.toFixed(1)}s`}　　公共冷却 ${d.globalCooldown.toFixed(1)}s　${castStatus}`);
      this.set('v3-deck-bins',`<div class="v3-deck-stack"><span>▤</span><b>${d.drawPile.length}</b><small>牌库</small></div><div class="v3-discard-stack"><span>↘</span><b>${d.discardPile.length}</b><small>弃牌</small></div><p>点击选牌 → 点击目标<br>暂停时可预备一张牌</p>`);
      this.set('v3-facility-actions','');
    } else {
      const r=s.rooms.find(r=>r.anomalyId===this.roomId)!;
      this.set('v3-room',`<div class="v3-room-heading"><h3>${anomalyById[r.anomalyId].name} <em>${rank(r.rank)}</em></h3><button data-v3="profile" data-id="${r.anomalyId}" class="v3-icon-button" title="查看收容档案" aria-label="查看${anomalyById[r.anomalyId].name}收容档案">▣</button></div><p>${r.owned?`稳定收容 · ${v3Config.production[r.anomalyId][r.rank-1]} E / 分钟<br>E.G.O. 上限 ${rank(r.rank)}${r.rank<3?`<br>下一阶 ${v3Config.production[r.anomalyId][r.rank]} E / 分钟`:''}`:'尚未抓捕 · 暂无产能'}</p>${r.owned?`<button data-v3="challenge" class="v3-primary" ${r.rank>=v3Config.facility.maxRank?'disabled':''}>${r.rank>=3?'已达最高阶':'主动失效挑战'}</button>`:`<button data-v3="capture" data-id="${r.anomalyId}" ${this.simulation.captureCondition(r.anomalyId)?'disabled':''}>外勤抓捕 · ${v3Config.captureCosts[r.anomalyId]} E</button><p>${this.simulation.captureCondition(r.anomalyId)??'条件已满足'}</p>`}`);
      this.set('v3-intent',`<button data-v3="equipment" class="v3-wide">小队装备 / 卡组</button><p>收容物不会自行失效。<br>挑战期间目标停产；战术暂停冻结所有产能。</p>`);
      this.text('v3-deck-status','收容设施　/　点击房间查看升阶　·　点选员工，右键走廊调度　·　滚轮缩放 / 中键拖动');
      this.set('v3-deck-bins','');
      this.set('v3-facility-actions',s.rooms.map(r=>`<button data-v3="room" data-id="${r.anomalyId}" class="v3-room-chip ${this.roomId===r.anomalyId?'selected':''}"><small>${r.anomalyId} / ${r.owned?'收容稳定':'外勤目标'}</small><b>${anomalyById[r.anomalyId].name} ${rank(r.rank)}</b><span>${r.owned?`${v3Config.production[r.anomalyId][r.rank-1]} E / 分钟`:this.simulation.captureCondition(r.anomalyId)??`可抓捕 · ${v3Config.captureCosts[r.anomalyId]} E`}</span></button>`).join(''));
    }
    this.hand.render(this.armedCard);
    this.set('v3-log',s.logs.slice(-2).map(l=>`<p>${escape(l.message)}</p>`).join(''));
    this.text('v3-message',this.message);
  }
  private renderModal(): void {
    const s=this.simulation.state;let body='';
    if(this.modal==='equipment'){
      body=`<h2>出战装备 / 九张共享卡组</h2><p>前三名员工出战，每把武器固定三张卡。正式装备各一份；制式训练装备可重复使用。升阶后点击“升级”应用新数值。</p>${s.employees.slice(0,3).map(e=>`<section class="v3-loadout"><b>${e.displayName}　武器 ${rank(e.weaponTier)} / 防具 ${rank(e.armorTier)}</b><div><select data-weapon-for="${e.id}" aria-label="${e.displayName}武器">${(['W00',...s.ownedWeapons] as WeaponId[]).map(w=>`<option value="${w}" ${w===e.weaponId?'selected':''}>${weaponById[w].name}</option>`).join('')}</select><select data-armor-for="${e.id}" aria-label="${e.displayName}防具">${(['A00',...s.ownedArmors] as ArmorId[]).map(a=>`<option value="${a}" ${a===e.armorId?'selected':''}>${armorById[a].name}</option>`).join('')}</select><button data-v3="equip" data-id="${e.id}">装备</button><button data-v3="upgrade" data-id="${e.id}">升级</button></div><p>${weaponCards[e.weaponId].map(id=>cardById[id].name).join(' / ')}</p></section>`).join('')}<p>关闭后点击“继续”恢复设施。</p>`;
    } else if(this.modal==='abandon') body='<h2>放弃本次行动？</h2><p>不会升阶或获得抓捕对象，已支付的外勤费用不返还。</p><button data-v3="confirm-abandon" class="v3-primary">确认放弃</button>';
    else if(this.modal==='profile') {
      const r=s.rooms.find(room=>room.anomalyId===this.modalTarget)!;
      const a=anomalyById[r.anomalyId];
      const portrait=`${import.meta.env.BASE_URL}art/generated/abnormalities/abn_${({N01:'nailong',N02:'maodie',N03:'big_dog',N04:'dingdong_chicken',N05:'gugu_gaga'} as Record<AnomalyId,string>)[r.anomalyId]}_idle_01_approved.png`;
      const status=r.owned?'稳定收容':'未收容';
      const statusClass=r.owned?'stable':'uncontained';
      const captureHint=this.simulation.captureCondition(r.anomalyId);
      body=`<div class="v3-profile-page" data-profile-id="${r.anomalyId}">
        <section class="v3-profile-idcard">
          <div class="v3-profile-idhead"><span class="v3-profile-kicker">ARCHIVE / ${r.anomalyId}</span><span class="v3-profile-status ${statusClass}"><i></i>${status}</span></div>
          <div class="v3-profile-portrait"><img src="${portrait}" alt="${a.name}档案头像"><span class="v3-profile-scan">◈ ${r.owned?'LIVE':'LOCKED'}</span></div>
          <h2>${a.name}</h2><p class="v3-profile-code">设施收容数据库 · ${r.anomalyId} · 档案已建立</p>
          <div class="v3-profile-rank"><span class="v3-profile-icon">◆</span><div><small>收容等级</small><b>${r.owned?rank(r.rank):'—'}</b></div><span class="v3-profile-divider"></span><div><small>产能</small><b>${r.owned?`${v3Config.production[r.anomalyId][r.rank-1]}`:'—'}</b></div></div>
          <div class="v3-profile-tags"><span>▣ ${a.breach.ai==='CHASE'?'追击型':'区域型'}</span><span>◎ ${r.owned?'可作业':'待外勤'}</span></div>
        </section>
        <section class="v3-profile-record">
          <div class="v3-profile-title"><span class="v3-profile-icon">▤</span><div><small>CONTAINMENT FILE</small><h2>收容档案</h2></div></div>
          <div class="v3-profile-grid">
            <article><span class="v3-profile-icon">⌁</span><div><small>行为档案</small><p>${a.archive.behavior}</p></div></article>
            <article><span class="v3-profile-icon">⚠</span><div><small>失效须知</small><p>${a.archive.combat}</p></div></article>
            <article><span class="v3-profile-icon">◌</span><div><small>E.G.O. 装备上限</small><p class="v3-profile-stat"><b>${r.owned?rank(r.rank):'未解锁'}</b><span>${r.owned?`${v3Config.production[r.anomalyId][r.rank-1]} E / 分钟`:'完成外勤收容后开放'}</span></p></div></article>
            <article><span class="v3-profile-icon">✦</span><div><small>关联模块</small><p class="v3-profile-modules"><span title="专属武器">⚔</span><span title="专属防具">⬡</span><span title="专属技能">✹</span></p></div></article>
          </div>
          <div class="v3-profile-footer"><span>${captureHint?`外勤条件：${captureHint}`:'设施内可操作对象'}</span><button data-v3="close" class="v3-primary">返回设施</button></div>
        </section>
      </div>`;
    }
    else if(this.modal){const r=s.rooms.find(r=>r.anomalyId===this.modalTarget)!;body=`<h2>${this.modal==='capture'?'外勤抓捕':'主动失效挑战'} · ${anomalyById[r.anomalyId].name}</h2><p>${this.modal==='capture'?`入场消耗 ${v3Config.captureCosts[r.anomalyId]} E；成功首次收容 I 阶。`:`当前 ${rank(r.rank)} → ${rank(r.rank+1)}；目标挑战期间停止产能。`}</p><p>出战：${s.employees.slice(0,3).map(e=>e.displayName).join(' / ')}<br>三人自动接敌与普通攻击，九张卡按武器归属施放。<br>失败或放弃保留原收容阶级。先在装备界面配置奶龙 E.G.O.，可用打断牌反制蓄力。</p><button data-v3="confirm-encounter" class="v3-primary">确认出战</button>`;}
    this.set('v3-modal',this.modal?`<div class="v3-shade"><section class="v3-dialog ${this.modal==='profile'?'v3-profile-dialog':''}" role="dialog" aria-modal="true"><button class="v3-close" data-v3="close">关闭 ×</button>${body}</section></div>`:'');
  }
}
