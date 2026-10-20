import type { AnomalyId, ArmorId, EmployeeId, SkillId, WeaponId } from '../../contracts/data-contract';
import { anomalyById, armorById, config, dayByNumber, skillById, weaponById } from '../data/config';
import type { FacilityController } from '../game/FacilityController';
import { clock, damageText, escape, resistanceText } from './format';

type Panel = 'archives' | 'equipment' | 'help' | 'logs' | 'finish' | 'restart' | 'switch' | 'load' | 'transfer' | null;
const color: Record<AnomalyId, string> = { N01: '#f3bd36', N02: '#c66961', N03: '#7c9b70', N04: '#9a82c0', N05: '#67a9bf' };
const glyph: Record<SkillId, string> = { S01: '◎', S02: '爪', S03: '≋', S04: '♧', S05: '＋' };

/** 世界操作仍在 Phaser 中；这里仅承载紧凑状态、研究与准备操作。 */
export class FacilityHUD {
  private panel: Panel = null;
  private detailsHidden = false;
  private pendingMode: 'campaign' | 'sandbox' = 'campaign';
  private archiveRoom: AnomalyId = 'N01';
  private equipEmployee: EmployeeId = 'E01';
  private transfer: { type: 'weapon'; id: WeaponId } | { type: 'armor'; id: ArmorId } | null = null;
  private modalMarkup = '';
  private readonly markupCache = new Map<string, string>();
  private elapsed = 0;

  constructor(private readonly root: HTMLElement, private readonly controller: FacilityController) {
    root.innerHTML = `
      <header class="facility-top">
        <div class="facility-brand"><span class="facility-mark">W<span>07</span></span><div><b>网梗收容</b><small>奶龙失效 / CONTAINMENT DIVISION</small></div></div>
        <nav class="facility-modes"><button data-action="mode-campaign">三日值班</button><button data-action="mode-sandbox">五室演练</button></nav>
        <div id="facility-day"></div><div id="facility-quota"></div><div class="facility-funds"><small>可用能量</small><strong id="facility-wallet"></strong></div>
        <span id="facility-clock"></span><div class="facility-time"><button data-action="speed1">Ⅰ</button><button data-action="speed2">Ⅱ</button><button data-action="pause">暂停</button></div><div id="facility-day-action"></div>
      </header>
      <aside class="facility-inspector"><div class="facility-section-head"><span>PERSONNEL / 人员</span><button data-action="toggle-details" aria-label="收起详情">−</button></div><div id="facility-details">
        <div id="facility-roster" class="facility-roster"></div>
        <div class="facility-order-buttons"><button data-action="select-all">全选</button><button data-action="stop">停止 S</button><button data-action="retreat">撤退 R</button></div>
        <div id="facility-room-detail" class="facility-room-detail"><div id="facility-room-status"></div><button data-action="archives">查看档案 / 解锁</button></div>
        <div id="facility-mode-tools"></div><div class="facility-log"><button data-action="logs">事件记录 ↗</button><div id="facility-recent-logs"></div></div>
      </div></aside>
      <section class="facility-toolbar"><div class="facility-skills-label"><b>主管指令</b><small>1—5 瞄准 · 右键取消</small></div><div id="facility-skills">${config.skills.map(skill => `<button data-skill="${skill.id}" class="facility-skill" style="--accent:${color[skill.sourceAnomalyId]}" title="${escape(skill.description)}"><span class="skill-glyph">${glyph[skill.id]}</span><span><b>${skill.name}</b><small class="skill-availability"></small></span><kbd>${skill.hotkey}</kbd></button>`).join('')}</div><nav><button data-action="archives">收容档案</button><button data-action="equipment">装备分配</button><button data-action="help">操作手册</button></nav></section>
      <footer class="facility-footer"><span id="facility-message" role="status"></span><small>左键点选 / 框选　右键调度　空格暂停　R 撤退　S 停止</small></footer>
      <div id="facility-modal" hidden></div>`;
    root.addEventListener('click', event => this.onClick(event));
    root.addEventListener('contextmenu', event => event.preventDefault());
    window.addEventListener('keydown', event => {
      if (event.repeat || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.code === 'Escape' && this.panel) { this.close(); event.preventDefault(); return; }
      if (controller.inputBlocked) return;
      const skill = config.skills.find(item => item.hotkey === event.key);
      if (skill) { controller.armSkill(skill.id); this.render(true); event.preventDefault(); }
    });
    this.render(true);
  }

  render(force = false): void {
    // HUD numbers need not rebuild DOM at the rendering frequency.
    this.elapsed++;
    if (!force && this.elapsed % 6 !== 0) return;
    const c = this.controller, s = c.state, day = dayByNumber[s.day];
    this.set('facility-day', `<small>${c.mode === 'sandbox' ? '独立演练 / 不写存档' : day.title}</small><b>${c.mode === 'sandbox' ? '五室开放' : `DAY ${String(s.day).padStart(2, '0')}`}</b>`);
    this.set('facility-quota', `<div><small>${c.mode === 'sandbox' ? '演练累计产能' : '当日产能指标'}</small><b>${s.producedToday}<span> / ${day.quota}</span></b></div><i><em style="width:${Math.min(100, s.producedToday / day.quota * 100)}%"></em></i>`);
    this.set('facility-wallet', `${s.progress.wallet}<small> E</small>`);
    this.set('facility-clock', `${clock(s.simulationTimeSec)}`);
    const phaseLabel = s.phase === 'DAY_PREP' ? '准备中' : s.phase !== 'RUNNING' ? '已停止' : s.timeScale === 0 ? '继续 ▷' : '暂停 Ⅱ';
    this.root.querySelector('[data-action="pause"]')!.textContent = phaseLabel;
    this.root.querySelector<HTMLButtonElement>('[data-action="pause"]')!.disabled = s.phase !== 'RUNNING';
    for (const mode of ['campaign', 'sandbox']) this.root.querySelector(`[data-action="mode-${mode}"]`)!.classList.toggle('active', c.mode === mode);
    this.root.querySelector('[data-action="speed1"]')!.classList.toggle('active', s.timeScale === 1);
    this.root.querySelector('[data-action="speed2"]')!.classList.toggle('active', s.timeScale === 2);
    this.set('facility-day-action', c.mode === 'sandbox'
      ? '<button data-action="restart" class="quiet">重开演练</button>'
      : s.phase === 'DAY_PREP' ? '<button data-action="start" class="primary">开始工作 ▷</button>'
        : s.phase === 'RUNNING' ? `<button data-action="finish" class="${s.producedToday >= day.quota ? 'primary' : 'quiet'}" ${s.producedToday < day.quota ? 'disabled' : ''}>结束今日</button>` : '');
    this.root.querySelector('#facility-message')!.textContent = c.activeSkillId ? `正在瞄准「${skillById[c.activeSkillId].name}」：左键指定目标，右键 / Esc 取消。` : c.message;
    this.renderInspector();
    for (const skill of config.skills) {
      const unlocked = s.progress.unlockedSkills.includes(skill.id), cooldown = s.skillCooldownRemainingSec[skill.id];
      const available = s.rooms.find(room => room.anomalyId === skill.sourceAnomalyId)?.mode !== 'LOCKED';
      const button = this.root.querySelector<HTMLButtonElement>(`[data-skill="${skill.id}"]`)!;
      button.disabled = !available;
      button.classList.toggle('aiming', c.activeSkillId === skill.id);
      button.classList.toggle('locked', !unlocked);
      button.querySelector('.skill-availability')!.textContent = !available ? '尚未开放' : !unlocked ? `解锁 ${config.game.economy.skillUnlockCost} E` : cooldown > 0 ? `冷却 ${cooldown.toFixed(1)}s` : `${skill.energyCost} E · 可用`;
    }
    this.renderModal();
  }

  private set(id: string, markup: string): void {
    // Compare source markup, not browser-normalized disabled/style attributes.
    if (this.markupCache.get(id) === markup) return;
    this.root.querySelector<HTMLElement>(`#${id}`)!.innerHTML = markup;
    this.markupCache.set(id, markup);
  }

  private renderInspector(): void {
    const c = this.controller, s = c.state;
    this.root.querySelector<HTMLElement>('#facility-details')!.hidden = this.detailsHidden;
    this.root.querySelector('[data-action="toggle-details"]')!.textContent = this.detailsHidden ? '+' : '−';
    if (this.detailsHidden) return;
    const selectedRoom = c.selectedRoomId ?? 'N01';
    const a = anomalyById[selectedRoom], room = s.rooms.find(r => r.anomalyId === selectedRoom)!;
    const status = { LOCKED: `第 ${a.unlockDay} 日开放`, CONTAINED: '收容稳定', BREACHED: '收容失效', RECOVERING: '正在恢复' }[room.mode];
    this.set('facility-roster', s.employees.map((e, index) => `<button data-employee="${e.id}" class="facility-employee"><span class="employee-stripe" style="background:${['#e4bc60', '#b88ca8', '#80b0aa', '#dd9c70', '#9a9cc8', '#b5c78a'][index]}"></span><span><b>${e.displayName}</b><small class="employee-state"></small></span><span class="employee-meters"><i class="hp"><em></em></i><i class="sp"><em></em></i><small class="employee-numbers"></small></span></button>`).join(''));
    for (const e of s.employees) {
      const button = this.root.querySelector<HTMLButtonElement>(`[data-employee="${e.id}"]`)!;
      button.classList.toggle('selected', c.selected.has(e.id));
      button.classList.toggle('unavailable', e.status === 'INCAPACITATED');
      button.querySelector('.employee-state')!.textContent = e.status === 'MOVING' && e.order.kind === 'IDLE'
        ? '空闲散步' : config.localization[`employee.${e.status}`] ?? e.status;
      button.querySelector<HTMLElement>('.hp em')!.style.width = `${e.hp / e.hpMax * 100}%`;
      button.querySelector<HTMLElement>('.sp em')!.style.width = `${e.sp / e.spMax * 100}%`;
      button.querySelector('.employee-numbers')!.textContent = `${Math.ceil(e.hp)} / ${Math.ceil(e.sp)}`;
    }
    this.root.querySelector<HTMLButtonElement>('[data-action="stop"]')!.disabled = !c.selected.size;
    this.root.querySelector<HTMLButtonElement>('[data-action="retreat"]')!.disabled = !c.selected.size;
    this.root.querySelector<HTMLElement>('#facility-room-detail')!.style.setProperty('--accent', color[selectedRoom]);
    this.set('facility-room-status', `<small>${a.id} / 当前收容室</small><h2>${a.name}<span class="${room.mode === 'BREACHED' ? 'danger-text' : ''}">${status}</span></h2><div class="pressure-track"><em style="width:${room.pressure}%;background:${room.pressure >= config.game.pressure.danger ? '#e4584c' : color[selectedRoom]}"></em></div><p>压力 ${room.pressure.toFixed(0)} / ${config.game.pressure.breachThreshold}${room.work ? `<br>${room.work.phase === 'TRAVELLING' ? '员工前往工作位' : `正在${config.localization[`work.${room.work.type}`]}`} · ${room.work.elapsedSec.toFixed(1)}s` : room.mode === 'RECOVERING' ? `<br>恢复剩余 ${room.recoveryRemainingSec.toFixed(1)}s` : ''}</p>`);
    this.set('facility-mode-tools', c.mode === 'sandbox'
      ? `<div class="facility-debug"><small>五室演练 · 当前房间</small><button data-action="breach" ${room.mode !== 'CONTAINED' ? 'disabled' : ''}>触发 ${a.name} 失效</button></div>`
      : '<div class="facility-save"><button data-action="save">保存日初</button><button data-action="load">读取存档</button><button data-action="restart">重试今日</button></div>');
    this.set('facility-recent-logs', s.logs.slice(-2).map(log => `<p>${escape(log.message)}</p>`).join(''));
  }

  private open(panel: Exclude<Panel, null>): void {
    this.panel = panel;
    this.controller.cancelSkill();
    this.controller.simulation.setPanelPaused('facility-modal', true);
    this.controller.inputBlocked = true;
    this.render(true);
  }
  private close(): void {
    this.panel = null; this.transfer = null;
    this.controller.simulation.setPanelPaused('facility-modal', false);
    this.controller.inputBlocked = false;
    this.render(true);
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!target || target.disabled) return;
    const c = this.controller, s = c.state;
    if (target.dataset.employee) { c.select([target.dataset.employee as EmployeeId], event.shiftKey); this.render(true); return; }
    if (target.dataset.skill) {
      const id = target.dataset.skill as SkillId;
      if (!s.progress.unlockedSkills.includes(id)) { this.archiveRoom = skillById[id].sourceAnomalyId; this.open('archives'); }
      else { c.armSkill(id); this.render(true); }
      return;
    }
    if (target.dataset.archiveRoom) { this.archiveRoom = target.dataset.archiveRoom as AnomalyId; this.render(true); return; }
    if (target.dataset.equipEmployee) { this.equipEmployee = target.dataset.equipEmployee as EmployeeId; this.render(true); return; }
    if (target.dataset.purchase) {
      c.issue({ type: 'PURCHASE', anomalyId: this.archiveRoom, item: target.dataset.purchase as 'BEHAVIOR' | 'COMBAT' | 'EQUIPMENT' | 'SKILL' });
      this.render(true); return;
    }
    if (target.dataset.weapon || target.dataset.armor) {
      const id = (target.dataset.weapon || target.dataset.armor)!;
      const type = target.dataset.weapon ? 'weapon' : 'armor';
      const holder = s.employees.find(e => e.id !== this.equipEmployee && (type === 'weapon' ? e.weaponId : e.armorId) === id);
      if (holder && id !== 'W00' && id !== 'A00') {
        this.transfer = type === 'weapon' ? { type, id: id as WeaponId } : { type, id: id as ArmorId }; this.open('transfer');
      } else this.equip(type, id);
      this.render(true); return;
    }
    switch (target.dataset.action) {
      case 'start': c.issue({ type: 'START_DAY' }); break;
      case 'pause': c.togglePause(); break;
      case 'speed1': c.simulation.setSpeed(1); break;
      case 'speed2': c.simulation.setSpeed(2); break;
      case 'retreat': c.retreat(); break;
      case 'stop': c.stop(); break;
      case 'select-all': c.select(s.employees.filter(e => !['PANICKED', 'INCAPACITATED'].includes(e.status)).map(e => e.id)); break;
      case 'toggle-details': this.detailsHidden = !this.detailsHidden; break;
      case 'breach': c.triggerBreach(); break;
      case 'archives': this.archiveRoom = c.selectedRoomId ?? 'N01'; this.open('archives'); break;
      case 'equipment': this.equipEmployee = [...c.selected][0] ?? s.employees[0].id; this.open('equipment'); break;
      case 'logs': this.open('logs'); break;
      case 'help': this.open('help'); break;
      case 'close': this.close(); break;
      case 'save': c.saveCampaign(); break;
      case 'load': this.open('load'); break;
      case 'confirm-load': this.close(); c.loadCampaign(); break;
      case 'finish': this.open('finish'); break;
      case 'confirm-finish': this.close(); c.issue({ type: 'FINISH_DAY' }); break;
      case 'next-day': c.nextDay(); break;
      case 'restart': this.open('restart'); break;
      case 'confirm-restart': this.close(); c.restart(); break;
      case 'mode-campaign':
      case 'mode-sandbox':
        this.pendingMode = target.dataset.action === 'mode-campaign' ? 'campaign' : 'sandbox';
        if (this.pendingMode === c.mode) break;
        if (s.phase === 'DAY_PREP' || s.simulationTimeSec < 1) { this.close(); c.setMode(this.pendingMode); }
        else this.open('switch');
        break;
      case 'confirm-mode': this.close(); c.setMode(this.pendingMode); break;
      case 'tutorial-accept': c.handleTutorial(true); break;
      case 'tutorial-skip': c.handleTutorial(false); break;
      case 'confirm-transfer': {
        const transfer = this.transfer;
        if (transfer) { this.panel = 'equipment'; this.equip(transfer.type, transfer.id); this.transfer = null; }
        break;
      }
      case 'new-campaign': c.newCampaign(); break;
    }
    this.render(true);
  }

  private equip(type: 'weapon' | 'armor', id: string): void {
    this.controller.issue(type === 'weapon'
      ? { type: 'EQUIP_WEAPON', employeeId: this.equipEmployee, weaponId: id as WeaponId }
      : { type: 'EQUIP_ARMOR', employeeId: this.equipEmployee, armorId: id as ArmorId });
  }

  private renderModal(): void {
    const c = this.controller, s = c.state;
    let title = '', body = '', buttons = '', eyebrow = 'FACILITY / 管理终端';
    if (this.panel === 'archives') {
      const a = anomalyById[this.archiveRoom], research = s.progress.research[a.id], room = s.rooms.find(r => r.anomalyId === a.id)!;
      title = `${a.id} / ${a.name}`;
      const costs = config.game.economy;
      const purchase = (item: string, label: string, cost: number, owned: boolean, prerequisite = true) => `<button data-purchase="${item}" data-room="${a.id}" ${owned || room.mode === 'LOCKED' || !prerequisite || s.progress.wallet < cost ? 'disabled' : ''}>${owned ? '已解锁' : `${label} · ${cost} E`}</button>`;
      body = `<nav class="archive-tabs">${config.anomalyData.anomalies.map(item => `<button data-archive-room="${item.id}" class="${item.id === a.id ? 'active' : ''}">${item.name}</button>`).join('')}</nav>
        <div class="archive-summary"><span style="color:${color[a.id]}">● ${room.mode === 'LOCKED' ? `第${a.unlockDay}日开放` : '对象已接入设施'}</span><span>可用能量 ${s.progress.wallet} E</span></div>
        <div class="archive-pages"><article><small>01 / 行为记录</small><p>${research.behavior ? escape(a.archive.behavior) : '解锁行为档案，了解该对象的工作禁忌与人员调度规则。'}</p>${purchase('BEHAVIOR', '解锁行为', costs.archiveBehaviorCost, research.behavior)}</article><article><small>02 / 镇压记录</small><p>${research.combat ? escape(a.archive.combat) : '解锁镇压档案，查看失效攻击与应对方式。需要行为档案。'}</p>${purchase('COMBAT', '解锁镇压', costs.archiveCombatCost, research.combat, research.behavior)}</article></div>
        <div class="archive-unlocks"><div><b>${weaponById[a.weaponId].name} / ${armorById[a.armorId].name}</b><p>专属武器与防具各一件 · 仅改变伤害和抗性</p>${purchase('EQUIPMENT', '开发装备', costs.equipmentPairCost, research.equipmentDeveloped, research.behavior)}</div><div><b>${skillById[a.skillId].name}</b><p>${escape(skillById[a.skillId].description)}</p>${purchase('SKILL', '解锁技能', costs.skillUnlockCost, s.progress.unlockedSkills.includes(a.skillId))}</div></div>`;
    } else if (this.panel === 'equipment') {
      title = '装备分配';
      const e = s.employees.find(item => item.id === this.equipEmployee) ?? s.employees[0];
      this.equipEmployee = e.id;
      body = `<nav class="archive-tabs">${s.employees.map(item => `<button data-equip-employee="${item.id}" class="${item.id === e.id ? 'active' : ''}">${item.displayName}</button>`).join('')}</nav><p>日初准备可自由换装；工作中请先撤到安全室待命。专属装备只有一件，转移会让原持有人恢复制式装备。</p>
        <div class="equipment-columns"><article><h3>手持武器</h3>${config.equipment.weapons.filter(w => w.id === 'W00' || s.progress.ownedWeapons.includes(w.id)).map(w => `<button data-weapon="${w.id}" class="equipment-item ${e.weaponId === w.id ? 'equipped' : ''}"><b>${w.name} ${e.weaponId === w.id ? '✓' : ''}</b><small>${damageText(w.damage)} · 射程 ${w.rangePx} · 周期 ${w.attackPeriodSec}s</small></button>`).join('')}</article><article><h3>制服 / 防具</h3>${config.equipment.armors.filter(a => a.id === 'A00' || s.progress.ownedArmors.includes(a.id)).map(a => `<button data-armor="${a.id}" class="equipment-item ${e.armorId === a.id ? 'equipped' : ''}"><b>${a.name} ${e.armorId === a.id ? '✓' : ''}</b><small>${resistanceText(a.resistances)}</small></button>`).join('')}</article></div>`;
    } else if (this.panel === 'help') {
      title = '主管操作手册';
      body = `<ol class="facility-help"><li><b>移动视野。</b>滚轮缩放，中键或 Alt＋左键拖动；Home 总览，F 跟随选中员工。点击小地图定位，各收容室标签可快速跳转。</li><li><b>先选择场内小人。</b>左键点人、Shift 加选，或拖框多人；右侧名单也可辅助选择。</li><li><b>右键走廊下达移动。</b>员工沿走廊和楼梯换层，途中再下令会换路；S 停止驻足，R 撤往医疗休整区。</li><li><b>空闲员工会散步。</b>没有任务且恢复完整的员工会在设施通道走动；玩家命令立即打断散步。明确停止后保持原地，事故期间暂停散步。</li><li><b>单选员工，再左键收容室。</b>选择观察 / 互动 / 安抚，员工到达室内工作位才开始作业。</li><li><b>选中员工，右键失效实体镇压。</b>员工沿通路接近后自动攻击；红色范围表示危险，移动可躲避。</li><li><b>空格暂停 / 继续。</b>暂停时仍可选人和改令。首次失效、切换标签页会自动暂停。</li><li><b>档案解锁装备与技能。</b>1—5 选择技能，场内左键指定目标，右键 / Esc 取消。叮咚通知直接作用于全体。</li><li><b>五室演练立即开放全部对象。</b>六名员工，不写正式存档；“三日值班”从四人和两室开始。</li><li><b>正式存档保存日初入口。</b>明确点击保存或读档后启用该局的跨日保存；重试回退本日购买。</li></ol><p class="concept-note">当前角色与设施为原创程序绘制概念造型，暂无角色原声及音乐。</p>`;
    } else if (this.panel === 'logs') {
      title = '现场事件记录';
      body = `<div class="facility-event-list">${s.logs.slice(-24).map(log => `<p><time>${clock(log.timeSec)}</time><b>${escape(log.kind)}</b>${escape(log.message)}</p>`).join('')}</div>`;
    } else if (this.panel === 'finish') {
      title = '结束今日工作？';
      body = `<p>累计产能 <strong>${s.producedToday} / ${dayByNumber[s.day].quota}</strong>，当前有 ${s.rooms.filter(r => r.work).length} 项未完成工作、${s.rooms.filter(r => r.mode === 'BREACHED').length} 起失效。</p><p>未完成工作不入账，事故记入日报。可以带事故结算。</p>`;
      buttons = '<button data-action="confirm-finish" class="primary">确认结算</button>';
    } else if (this.panel === 'restart') {
      title = c.mode === 'sandbox' ? '重新开始五室演练？' : '重试本日？';
      body = `<p>${c.mode === 'sandbox' ? '重置本次演练的人员、压力、购买和产能；正式存档不变。' : '恢复本日日初入口，回退本日购买和产能；前一日结余保留。'}</p>`;
      buttons = '<button data-action="confirm-restart" class="primary">确认重开</button>';
    } else if (this.panel === 'switch') {
      title = this.pendingMode === 'sandbox' ? '进入五室演练？' : '开始三日值班？';
      body = '<p>当前现场进度将重置。已保存的正式日初存档保留，可在三日值班中读取。</p>';
      buttons = '<button data-action="confirm-mode" class="primary">进入</button>';
    } else if (this.panel === 'load') {
      title = '读取正式存档？';
      body = '<p>恢复最近保存的日初入口，替换当前现场进度。本日尚未结算的工作不保存。</p>';
      buttons = '<button data-action="confirm-load" class="primary">读取</button>';
    } else if (this.panel === 'transfer') {
      title = '转移专属装备？';
      body = `<p>将这件装备交给 ${this.equipEmployee.replace('E', 'A-')}；原持有人将恢复制式装备。双方都必须处于可换装状态。</p>`;
      buttons = '<button data-action="confirm-transfer" class="primary">确认转移</button>';
    } else if (s.tutorialPending) {
      title = '可选：第一次失效演练'; eyebrow = 'ORIENTATION / 现场教学';
      body = '<p>奶龙失效会产生主样本和两个分身。选中员工后右键敌人镇压；R 撤退到安全室。优先辨认带主样本标识的奶龙。</p><p>演练使用正常战斗数值，不奖励能量。你也可以跳过，继续本日工作。</p>';
      buttons = '<button data-action="tutorial-skip">跳过演练</button><button data-action="tutorial-accept" class="primary">接受演练</button>';
    } else if (s.phase === 'FAILED') {
      title = '本日行动中止'; eyebrow = 'OPERATIONS HALTED';
      body = '<p>所有员工已重伤，现场模拟已停止。重试会恢复日初入口；员工与装备不会永久丢失。</p>';
      buttons = '<button data-action="confirm-restart" class="primary">恢复并重试</button>';
    } else if (s.phase === 'DAY_REPORT' || s.phase === 'COMPLETE') {
      const r = s.report;
      title = s.phase === 'COMPLETE' ? '三日值班完成' : `第 ${s.day} 日 / 工作报告`;
      eyebrow = 'DAILY REPORT';
      body = `<div class="report-grid"><div><small>累计产能</small><strong>${s.producedToday}</strong></div><div><small>可用能量</small><strong>${s.progress.wallet}</strong></div><div><small>失效 / 未解决</small><strong>${r?.breaches ?? 0} / ${r?.unresolved ?? 0}</strong></div><div><small>重伤员工</small><strong>${r?.incapacitated ?? 0}</strong></div></div><p>${s.phase === 'COMPLETE' ? '本次三日流程结束。存档开启时已记录完成标记。' : '下一日人员全部恢复，场内异常重新收容；保留已购内容和可用能量。'}</p>`;
      buttons = s.phase === 'COMPLETE' ? '<button data-action="new-campaign" class="primary">新一轮值班</button>' : '<button data-action="next-day" class="primary">进入下一日</button>';
    }
    const shown = Boolean(title);
    c.inputBlocked = shown;
    const modal = this.root.querySelector<HTMLElement>('#facility-modal')!;
    modal.hidden = !shown;
    if (!shown) { this.modalMarkup = ''; modal.innerHTML = ''; return; }
    const markup = `<section class="facility-dialog ${this.panel === 'archives' || this.panel === 'equipment' ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}"><header><small>${eyebrow}</small>${this.panel ? '<button data-action="close" aria-label="关闭弹窗">×</button>' : ''}<h1>${title}</h1></header><div class="dialog-body">${body}</div><footer><span>${escape(c.message)}</span><div>${this.panel ? '<button data-action="close">返回现场</button>' : ''}${buttons}</div></footer></section>`;
    if (markup !== this.modalMarkup) { modal.innerHTML = markup; this.modalMarkup = markup; }
  }
}
