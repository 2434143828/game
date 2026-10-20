import type { AnomalyId, ArmorId, Command, EmployeeId, Point, SaveEnvelope, SkillId, WeaponId, WorkType } from '../../contracts/data-contract';
import { config, anomalyById, armorById, skillById, weaponById } from '../data/config';
import { Simulation } from '../simulation/engine';
import { loadSave, writeSave } from '../save/storage';
import { AudioCues } from './audio';
import { clock, damageText, escape, number, resistanceText, seconds, text } from './format';

type WithoutId<T> = T extends unknown ? Omit<T, 'commandId'> : never;
type Modal = 'menu' | 'briefing' | 'archives' | 'equipment' | 'transfer' | 'settings' | 'finish' | 'retry' | 'new' | 'report' | 'complete' | 'failed' | 'tutorial' | 'logs' | 'help' | null;
export type PointerMode = 'MOVE' | 'SUPPRESS' | null;

export class GameInterface {
  simulation = new Simulation();
  selected = new Set<EmployeeId>();
  selectedRoom: AnomalyId = 'N01';
  aiming: SkillId | null = null;
  pointerMode: PointerMode = null;
  readonly audio = new AudioCues();
  modal: Modal = null;
  private modalHistory: Exclude<Modal, null>[] = [];
  private pendingTransfer: { slot: 'weapon'; itemId: WeaponId; holder: EmployeeId } | { slot: 'armor'; itemId: ArmorId; holder: EmployeeId } | null = null;
  private archiveRoom: AnomalyId = 'N01';
  private equipEmployee: EmployeeId = 'E01';
  private saved: SaveEnvelope | null = null;
  private saveError = '';
  private sequence = 0;
  private refreshElapsed = 0;
  private toastElapsed = 0;
  private lastLogId = '';
  private lastPhase = '';
  private tutorialShown = false;
  private started = false;

  constructor(private readonly root: HTMLElement) {
    root.innerHTML = `
      <header class="topbar"><div class="brand"><span class="brand-mark">▧</span><div><b>网梗收容</b><small>异常表达管理局 / 试运行设施 07</small></div></div><div id="day-label"></div><div id="quota"></div><div id="wallet"></div><div id="time-controls"></div><button class="icon-button" data-action="settings" aria-label="设置">⚙</button></header>
      <div class="facility-caption"><div><span class="eyebrow">CONTAINMENT FLOOR</span><b>收容区域 <span> / 单层设施</span></b></div><div class="facility-legend"><span>● 已收容</span><span>△ 高压警戒</span><span>◆ 失效停产</span></div></div>
      <div class="room-buttons">${config.anomalyData.anomalies.map((item) => `<button data-room="${item.id}" style="left:${config.game.layout.roomCentersX[item.roomIndex] - 89}px" aria-label="${item.id} ${item.name}收容室"><span class="sr-only">${item.name}</span></button>`).join('')}</div>
      <aside class="roster-panel"><div class="section-head"><div><span class="eyebrow">PERSONNEL</span><h2>在岗员工 <span id="roster-count"></span></h2></div><button class="text-button" data-action="select-all">全选</button></div><div id="roster"></div><div id="employee-actions"></div></aside>
      <section id="work-panel" class="work-panel"></section>
      <section class="skills-panel"><div class="section-head compact"><div><span class="eyebrow">DIRECTOR ABILITIES</span><h2>主管技能</h2></div><span class="muted">数字键 1—5 · 右键取消瞄准</span></div><div id="skills"></div></section>
      <section class="log-panel"><div class="section-head compact"><h2>值班日志 <span class="live-dot"></span></h2><button class="text-button" data-action="logs">全部记录 ↗</button></div><div id="recent-logs"></div></section>
      <nav class="bottom-navigation"><button data-action="archives"><span>▤</span> 收容档案</button><button data-action="equipment"><span>◇</span> 装备分配</button><button data-action="help"><span>?</span> 操作手册</button></nav>
      <footer class="status-footer"><span id="status-hint">先选择员工，再点击收容室安排工作。</span><span>三日可玩原型 · 全部角色为标号轮廓占位</span></footer>
      <div id="aim-banner" hidden></div><div id="toast" role="status" aria-live="polite" hidden></div><div id="modal-layer"></div>`;
    root.addEventListener('click', (event) => this.onClick(event));
    root.addEventListener('change', (event) => this.onChange(event));
    root.addEventListener('contextmenu', (event) => event.preventDefault());
    window.addEventListener('keydown', (event) => this.onKey(event));
    const loaded = loadSave();
    if (loaded.ok) this.saved = loaded.value;
    else this.saveError = loaded.message;
    this.openModal('menu');
    this.render();
  }

  get blocked(): boolean { return this.modal !== null; }
  get hasStarted(): boolean { return this.started; }

  run(command: WithoutId<Command>): boolean {
    this.audio.unlock();
    const result = this.simulation.command({ ...command, commandId: `ui-${++this.sequence}` } as Command);
    if (!result.ok) this.notify(result.message, true);
    this.render();
    return result.ok;
  }

  select(ids: EmployeeId[], additive = false): void {
    if (!additive) this.selected.clear();
    for (const id of ids) {
      if (additive && ids.length === 1 && this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    }
    this.pointerMode = null;
    this.render();
  }

  roomClick(id: AnomalyId): void {
    if (this.blocked) return;
    this.selectedRoom = id;
    if (this.aiming) {
      const item = anomalyById[id];
      this.mapClick({ x: config.game.layout.roomCentersX[item.roomIndex], y: config.game.layout.roomCenterY });
      return;
    }
    this.render();
  }

  mapClick(point: Point, enemyId?: string): void {
    if (this.blocked) return;
    if (this.aiming) {
      const skill = skillById[this.aiming];
      if (skill.target === 'SINGLE_ENEMY') {
        if (!enemyId) { this.notify(text('error.invalidSkillTarget'), true); return; }
        if (this.run({ type: 'CAST_SKILL', skillId: skill.id, target: { kind: 'ENEMY', enemyId } })) this.cancelAim();
      } else if (this.run({ type: 'CAST_SKILL', skillId: skill.id, target: { kind: 'POINT', point } })) this.cancelAim();
      return;
    }
    if (this.pointerMode === 'SUPPRESS') {
      if (!enemyId) { this.notify('请选择走廊中的敌对单位。', true); return; }
      this.run({ type: 'SUPPRESS', employeeIds: [...this.selected], enemyId });
      this.pointerMode = null;
    } else if (this.pointerMode === 'MOVE') {
      this.run({ type: 'MOVE', employeeIds: [...this.selected], point });
      this.pointerMode = null;
    }
  }

  mapRightClick(point: Point, enemyId?: string, safe = false): void {
    if (this.blocked) return;
    if (this.aiming || this.pointerMode) { this.cancelAim(); return; }
    if (!this.selected.size) { this.notify('请先选择一名或多名员工。', true); return; }
    if (enemyId) this.run({ type: 'SUPPRESS', employeeIds: [...this.selected], enemyId });
    else if (safe) this.run({ type: 'RETREAT', employeeIds: [...this.selected] });
    else this.run({ type: 'MOVE', employeeIds: [...this.selected], point: { x: point.x, y: config.game.layout.corridorY } });
  }

  update(deltaSec: number): void {
    this.refreshElapsed += deltaSec;
    if (this.toastElapsed > 0) {
      this.toastElapsed -= deltaSec;
      if (this.toastElapsed <= 0) this.element('toast').hidden = true;
    }
    const state = this.simulation.state;
    if (this.started && state.tutorialPending && !this.tutorialShown && this.modal === null) {
      this.tutorialShown = true;
      this.openModal('tutorial');
    }
    if (this.started && state.phase !== this.lastPhase) {
      this.lastPhase = state.phase;
      if (state.phase === 'DAY_REPORT') this.openModal('report');
      else if (state.phase === 'COMPLETE') { this.persist(true); this.openModal('complete'); }
      else if (state.phase === 'FAILED') this.openModal('failed');
    }
    const latest = state.logs.at(-1);
    if (latest && latest.id !== this.lastLogId) {
      this.lastLogId = latest.id;
      this.audio.play(latest.kind);
    }
    if (this.refreshElapsed >= 0.12) { this.refreshElapsed = 0; this.render(); }
  }

  notify(message: string, error = false): void {
    const toast = this.element('toast');
    toast.textContent = message;
    toast.className = error ? 'error' : '';
    toast.hidden = false;
    this.toastElapsed = 4;
  }

  private element(id: string): HTMLElement { return this.root.querySelector<HTMLElement>(`#${id}`)!; }
  private set(id: string, html: string): void {
    const element = this.element(id);
    if (element.innerHTML !== html) element.innerHTML = html;
  }

  private onClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLElement>('button');
    if (!target || target.hasAttribute('disabled')) return;
    this.audio.unlock();
    if (target.dataset.room) { this.roomClick(target.dataset.room as AnomalyId); return; }
    if (target.dataset.employee) { this.select([target.dataset.employee as EmployeeId], event.shiftKey); return; }
    if (target.dataset.skill) { this.chooseSkill(target.dataset.skill as SkillId); return; }
    if (target.dataset.work) {
      const employeeId = [...this.selected][0];
      if (this.selected.size !== 1 || !employeeId) { this.notify('工作需要单选一名员工。', true); return; }
      this.run({ type: 'ASSIGN_WORK', employeeId, roomId: this.selectedRoom, workType: target.dataset.work as WorkType });
      return;
    }
    if (target.dataset.archive) { this.archiveRoom = target.dataset.archive as AnomalyId; this.renderModal(); return; }
    if (target.dataset.equipEmployee) { this.equipEmployee = target.dataset.equipEmployee as EmployeeId; this.renderModal(); return; }
    if (target.dataset.purchase) {
      this.run({ type: 'PURCHASE', anomalyId: this.archiveRoom, item: target.dataset.purchase as 'BEHAVIOR' | 'COMBAT' | 'EQUIPMENT' | 'SKILL' });
      this.renderModal(); return;
    }
    if (target.dataset.weapon) {
      const weaponId = target.dataset.weapon as WeaponId;
      const holder = this.simulation.state.employees.find((e) => e.id !== this.equipEmployee && e.weaponId === weaponId);
      if (holder && !weaponById[weaponId].unlimitedStarter) { this.pendingTransfer = { slot: 'weapon', itemId: weaponId, holder: holder.id }; this.openModal('transfer'); }
      else { this.run({ type: 'EQUIP_WEAPON', employeeId: this.equipEmployee, weaponId }); this.renderModal(); }
      return;
    }
    if (target.dataset.armor) {
      const armorId = target.dataset.armor as ArmorId;
      const holder = this.simulation.state.employees.find((e) => e.id !== this.equipEmployee && e.armorId === armorId);
      if (holder && !armorById[armorId].unlimitedStarter) { this.pendingTransfer = { slot: 'armor', itemId: armorId, holder: holder.id }; this.openModal('transfer'); }
      else { this.run({ type: 'EQUIP_ARMOR', employeeId: this.equipEmployee, armorId }); this.renderModal(); }
      return;
    }
    switch (target.dataset.action) {
      case 'close': this.closeModal(); break;
      case 'confirm-transfer': {
        const transfer = this.pendingTransfer;
        if (transfer) {
          const succeeded = transfer.slot === 'weapon' ? this.run({ type: 'EQUIP_WEAPON', employeeId: this.equipEmployee, weaponId: transfer.itemId }) : this.run({ type: 'EQUIP_ARMOR', employeeId: this.equipEmployee, armorId: transfer.itemId });
          if (succeeded) { this.pendingTransfer = null; this.closeModal(); }
        }
        break;
      }
      case 'pause': this.simulation.setPaused(this.simulation.state.timeScale !== 0); this.render(); break;
      case 'speed1': this.simulation.setSpeed(1); this.render(); break;
      case 'speed2': this.simulation.setSpeed(2); this.render(); break;
      case 'select-all': this.select(this.simulation.state.employees.filter((e) => e.status !== 'INCAPACITATED' && e.status !== 'PANICKED').map((e) => e.id)); break;
      case 'archives': this.archiveRoom = this.selectedRoom; this.openModal('archives'); break;
      case 'equipment': this.equipEmployee = [...this.selected][0] ?? this.simulation.state.employees[0].id; this.openModal('equipment'); break;
      case 'settings': this.openModal('settings'); break;
      case 'help': this.openModal('help'); break;
      case 'logs': this.openModal('logs'); break;
      case 'finish': this.openModal('finish'); break;
      case 'confirm-finish': this.closeModal(true); this.run({ type: 'FINISH_DAY' }); break;
      case 'start-day': this.closeModal(true); this.run({ type: 'START_DAY' }); break;
      case 'prepare': this.closeModal(true); break;
      case 'new-game': if (this.saved || this.saveError || this.started) this.openModal('new'); else this.newGame(); break;
      case 'confirm-new': this.newGame(); break;
      case 'continue': this.continueGame(); break;
      case 'next-day': {
        this.closeModal(true);
        const next = this.simulation.nextDay();
        if (next.ok) { this.selected.clear(); this.tutorialShown = false; this.persist(false); this.openModal(this.simulation.state.phase === 'COMPLETE' ? 'complete' : 'briefing'); }
        else this.notify(next.message, true);
        break;
      }
      case 'retry': this.openModal('retry'); break;
      case 'confirm-retry': this.closeModal(true); this.simulation.retryDay(); this.selected.clear(); this.tutorialShown = false; this.openModal('briefing'); this.render(); break;
      case 'main-menu': this.cancelAim(); this.modalHistory = []; this.modal = null; this.openModal('menu'); break;
      case 'resume': {
        const phase = this.simulation.state.phase;
        this.closeModal(true);
        if (phase === 'COMPLETE') this.openModal('complete');
        else if (phase === 'DAY_REPORT') this.openModal('report');
        else if (phase === 'FAILED') this.openModal('failed');
        break;
      }
      case 'tutorial-yes': this.closeModal(true); this.simulation.handleTutorial(true); this.notify('奶龙失效演练已开始。选择员工，右键主样本下令镇压；空格继续。'); break;
      case 'tutorial-no': this.closeModal(true); this.simulation.handleTutorial(false); break;
      case 'cancel-aim': this.cancelAim(); break;
      case 'retreat': this.run({ type: 'RETREAT', employeeIds: [...this.selected] }); break;
      case 'move': this.aiming = null; this.pointerMode = 'MOVE'; this.render(); break;
      case 'suppress': this.aiming = null; this.pointerMode = 'SUPPRESS'; this.render(); break;
    }
  }

  private onChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.id === 'first-pause') this.simulation.pauseOnFirstBreach = input.checked;
    if (input.id === 'mute') this.audio.muted = input.checked;
    if (input.id === 'volume') this.audio.volume = Number(input.value) / 100;
  }

  private onKey(event: KeyboardEvent): void {
    if (event.repeat || /INPUT|SELECT|TEXTAREA/.test((event.target as HTMLElement).tagName)) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      if (this.aiming || this.pointerMode) this.cancelAim();
      else if (this.modal) this.closeModal();
      else this.openModal('settings');
    } else if (event.code === 'Space' && !this.blocked && this.started) {
      event.preventDefault();
      this.simulation.setPaused(this.simulation.state.timeScale !== 0);
      this.render();
    } else if (/^[1-5]$/.test(event.key) && !this.blocked) {
      event.preventDefault();
      const skill = config.skills.find((s) => s.hotkey === event.key);
      if (skill) this.chooseSkill(skill.id);
    }
  }

  private chooseSkill(id: SkillId): void {
    if (this.blocked) return;
    const skill = skillById[id];
    if (!this.simulation.state.progress.unlockedSkills.includes(id)) {
      this.archiveRoom = skill.sourceAnomalyId;
      this.openModal('archives'); return;
    }
    if (this.simulation.state.skillCooldownRemainingSec[id] > 0) { this.notify(text('error.cooldown'), true); return; }
    if (this.simulation.state.progress.wallet < skill.energyCost) { this.notify(text('error.notEnoughEnergy'), true); return; }
    if (skill.target === 'ALL_ACTIVE_EMPLOYEES') this.run({ type: 'CAST_SKILL', skillId: id, target: { kind: 'GLOBAL' } });
    else { this.aiming = id; this.pointerMode = null; this.render(); }
  }

  cancelAim(): void { this.aiming = null; this.pointerMode = null; this.render(); }

  private newGame(): void {
    this.closeModal(true);
    this.simulation = new Simulation();
    this.started = true; this.selected.clear(); this.sequence = 0; this.tutorialShown = false; this.lastPhase = '';
    this.saveError = ''; this.persist(false); this.openModal('briefing'); this.render();
  }

  private continueGame(): void {
    if (!this.saved) return;
    this.closeModal(true);
    this.simulation = new Simulation(this.saved.snapshot);
    this.started = true; this.selected.clear(); this.sequence = 0; this.tutorialShown = false; this.lastPhase = '';
    if (this.saved.demoCompleted) { this.simulation.state.phase = 'COMPLETE'; this.openModal('complete'); }
    else { this.openModal('briefing'); this.notify('已载入日初入口。本版不保存日内进度。'); }
    this.render();
  }

  private persist(completed: boolean): void {
    const envelope: SaveEnvelope = { snapshot: this.simulation.snapshot(), demoCompleted: completed };
    const saved = writeSave(envelope);
    if (!saved.ok) { this.notify(`存档失败：${saved.message}`, true); return; }
    this.saved = envelope;
  }

  private openModal(modal: Exclude<Modal, null>): void {
    this.cancelAim();
    if (this.modal && this.modal !== modal) this.modalHistory.push(this.modal);
    this.modal = modal;
    this.simulation.setPanelPaused('interface', true);
    this.renderModal();
  }

  private closeModal(force = false): void {
    if (!force && (this.modal === 'menu' && !this.started || ['tutorial', 'report', 'complete', 'failed', 'briefing'].includes(this.modal ?? ''))) return;
    if (!force && this.modalHistory.length) {
      this.modal = this.modalHistory.pop()!;
      this.renderModal();
      return;
    }
    if (force) this.modalHistory = [];
    this.modal = null;
    this.simulation.setPanelPaused('interface', false);
    this.element('modal-layer').innerHTML = '';
    this.render();
  }

  render(): void {
    const state = this.simulation.state;
    const day = config.days.find((d) => d.day === state.day)!;
    const quotaMet = state.producedToday >= day.quota;
    this.set('day-label', `<span class="eyebrow">值班日 / DAY</span><strong>${String(state.day).padStart(2, '0')}</strong><span class="day-title">${day.title}</span>`);
    this.set('quota', `<div class="metric-label">${text('energy.quota')} ${quotaMet ? '<b class="success">✓ 已达标</b>' : ''}</div><div class="metric-value">${number(state.producedToday)} <span>/ ${day.quota}</span></div><div class="meter"><i style="width:${Math.min(100, state.producedToday / day.quota * 100)}%"></i></div>`);
    this.set('wallet', `<div class="metric-label">${text('energy.wallet')}</div><div class="metric-value wallet-value"><span class="energy-icon">ϟ</span> ${number(state.progress.wallet)}</div><span class="tiny">消费不影响日指标</span>`);
    this.set('time-controls', `<div class="playback"><button data-action="pause" ${state.phase !== 'RUNNING' ? 'disabled' : ''} class="${state.timeScale === 0 ? 'active' : ''}" title="空格暂停/继续">${state.phase === 'DAY_PREP' ? '准备中' : state.timeScale === 0 ? '▶ 继续' : 'Ⅱ 暂停'}</button><button data-action="speed1" class="${state.timeScale === 1 ? 'active' : ''}">1×</button><button data-action="speed2" class="${state.timeScale === 2 ? 'active' : ''}">2×</button><span class="sim-clock">${clock(state.simulationTimeSec)}</span></div><button class="finish-button ${quotaMet ? 'ready' : ''}" data-action="${state.phase === 'DAY_PREP' ? 'start-day' : 'finish'}" ${!quotaMet && state.phase !== 'DAY_PREP' ? 'disabled' : ''}>${state.phase === 'DAY_PREP' ? '开始工作 →' : quotaMet ? '已达标 · 结束今天 →' : '指标达成后结束今天'}</button>`);
    this.set('roster-count', `${state.employees.length} 人`);
    this.set('roster', state.employees.map((e) => `<button class="employee-card ${this.selected.has(e.id) ? 'selected' : ''} ${e.status === 'INCAPACITATED' ? 'out' : ''}" data-employee="${e.id}" aria-pressed="${this.selected.has(e.id)}"><div class="employee-avatar">${e.id.slice(-2)}<i class="damage-dot damage-${weaponById[e.weaponId].damage.type}"></i></div><div class="employee-vitals"><div class="employee-row"><b>${e.displayName}</b><span class="state-${e.status}">${text(`employee.${e.status}`)}</span></div><div class="vital"><span>HP</span><div><i style="width:${e.hp / e.hpMax * 100}%"></i></div><small>${Math.ceil(e.hp)}</small></div><div class="vital sp"><span>SP</span><div><i style="width:${e.sp / e.spMax * 100}%"></i></div><small>${Math.ceil(e.sp)}</small></div></div></button>`).join(''));
    const employee = state.employees.find((e) => e.id === [...this.selected][0]);
    this.set('employee-actions', `<div class="selection-summary"><b>${this.selected.size ? `${this.selected.size} 名已选择` : '等待指令'}</b><span>Shift 加选 · 拖框多选</span></div><div class="order-buttons"><button data-action="move" ${!this.selected.size ? 'disabled' : ''}>↗ 移动</button><button data-action="suppress" ${!this.selected.size ? 'disabled' : ''}>⌖ 镇压</button><button data-action="retreat" ${!this.selected.size ? 'disabled' : ''}>↘ 撤退</button></div>${employee && this.selected.size === 1 ? `<div class="equipment-summary"><span>${weaponById[employee.weaponId].name} · ${damageText(weaponById[employee.weaponId].damage)}</span><span>${armorById[employee.armorId].name}</span><small>承伤 ${resistanceText(armorById[employee.armorId].resistances)}</small></div>` : '<p class="side-hint">安全室免费恢复生命与精神。<br>右键主样本下令镇压。</p>'}`);
    this.renderWorkPanel();
    this.set('skills', config.skills.map((skill) => {
      const unlocked = state.progress.unlockedSkills.includes(skill.id);
      const cd = state.skillCooldownRemainingSec[skill.id];
      const open = state.rooms.find((r) => r.anomalyId === skill.sourceAnomalyId)?.mode !== 'LOCKED';
      return `<button class="skill-slot ${unlocked ? '' : 'locked'} ${this.aiming === skill.id ? 'aiming' : ''}" data-skill="${skill.id}" title="${escape(skill.description)}" ${!open ? 'disabled' : ''}><kbd>${skill.hotkey}</kbd><span class="skill-symbol">${['◎', '⌁', '◉', '≋', '✧'][Number(skill.hotkey) - 1]}</span><div><b>${skill.name}</b><small>${!open ? `第${anomalyById[skill.sourceAnomalyId].unlockDay}日开放` : !unlocked ? '未解锁 · 查看档案' : cd > 0 ? `冷却 ${seconds(cd)}` : `ϟ ${skill.energyCost} · 就绪`}</small></div>${cd > 0 ? `<i class="cooldown-bar" style="width:${cd / skill.cooldownSec * 100}%"></i>` : ''}</button>`;
    }).join(''));
    const logs = state.logs.slice(-8).reverse();
    this.set('recent-logs', logs.length ? logs.map((log) => `<p><time>${clock(log.timeSec)}</time><span>${escape(log.message)}</span></p>`).join('') : '<p><time>00:00</time><span>设施待命。选择一名员工，点击收容室开始派遣。</span></p>');
    const banner = this.element('aim-banner');
    banner.hidden = !this.aiming && !this.pointerMode;
    banner.innerHTML = this.aiming ? `<b>${skillById[this.aiming].name}</b> · ${skillById[this.aiming].target === 'SINGLE_ENEMY' ? '点击一个敌对单位' : '点击地图选择范围中心'}<button data-action="cancel-aim">取消 / Esc</button>` : `<b>${this.pointerMode === 'MOVE' ? '移动指令：点击走廊位置' : '镇压指令：点击敌对单位'}</b><button data-action="cancel-aim">取消 / Esc</button>`;
    this.set('status-hint', state.phase === 'RUNNING' && state.timeScale === 0 ? '<strong>Ⅱ 战术暂停</strong> · 可以安排工作、移动或施放技能；空格继续。' : state.phase === 'DAY_PREP' ? '班前准备 · 可购买档案、分配装备；开始工作后推进模拟时间。' : '左键选择 / Shift 加选 / 拖框多选 · 右键移动、镇压或撤退 · 空格暂停');
  }

  private renderWorkPanel(): void {
    const state = this.simulation.state;
    const room = state.rooms.find((r) => r.anomalyId === this.selectedRoom)!;
    const anomaly = anomalyById[this.selectedRoom];
    const researched = state.progress.research[this.selectedRoom].behavior;
    const work = room.work;
    let extra = '';
    if (anomaly.specialWorkRule.kind === 'NEGLECT') extra = `空闲 ${number(room.memory.idleElapsedSec)} / ${anomaly.specialWorkRule.idleGraceSec} 秒`;
    let note = '选择一名员工，再选择工作。完成前不会入账。';
    if (room.mode === 'LOCKED') note = `第 ${anomaly.unlockDay} 日开放。`;
    else if (room.mode === 'BREACHED') note = text('hint.noEnergyOnBreach');
    else if (room.mode === 'RECOVERING') note = `恢复中，剩余 ${seconds(room.recoveryRemainingSec)}；期间不产能。`;
    else if (work) note = `${state.employees.find((e) => e.id === work.employeeId)?.displayName} · ${text(`work.${work.type}`)} · ${work.phase === 'TRAVELLING' ? '预约成功，正在前往' : `${number(work.elapsedSec)} 秒 / ${anomaly.workProfiles.find((p) => p.type === work.type)!.durationSec} 秒`}`;
    else if (this.selected.size > 1) note = '工作需要单选一名员工。多选可用于移动与镇压。';
    const canWork = room.mode === 'CONTAINED' && !work && this.selected.size === 1 && state.phase === 'RUNNING';
    const extraPreview = (type: WorkType): string => {
      const rule = anomaly.specialWorkRule;
      if (rule.kind === 'REPEAT_INTERACT') return type === 'INTERACT' && room.memory.lastCompletedWorkType === 'INTERACT' ? `连续互动 +${rule.extraPressure}` : '额外 +0';
      if (rule.kind === 'REPEAT_WORKER') return room.memory.lastCompletedEmployeeId === [...this.selected][0] ? `同人 +${rule.extraPressure}（开工前休息可能清除）` : '额外 +0';
      if (rule.kind === 'RAPID_RESTART') return `开工间隔 <${rule.gapSec}秒时 +${rule.extraPressure}`;
      if (rule.kind === 'NON_SOOTHE_STREAK') return type !== 'SOOTHE' && room.memory.nonSootheCount + 1 >= rule.threshold ? `第${rule.threshold}次 +${rule.extraPressure}` : `额外 +0 · 计数 ${room.memory.nonSootheCount}/${rule.threshold}`;
      return `空闲 >${rule.idleGraceSec}秒后 +${rule.pressurePerSecAfterGrace}/秒`;
    };
    this.set('work-panel', `<div class="work-intro"><span class="eyebrow">${anomaly.id} / 工作调度</span><h2>${anomaly.name} <span>${extra}</span></h2><p>${note}</p></div><div class="work-options">${anomaly.workProfiles.map((profile) => `<button data-work="${profile.type}" title="${researched ? extraPreview(profile.type) : '解锁行为档案以了解压力和损伤'}" ${!canWork ? 'disabled' : ''}><b>${text(`work.${profile.type}`)} <span>+${profile.energy} ϟ</span></b><small>${profile.durationSec} 秒${researched ? ` · ${damageText(profile.hazard)}损伤` : ' · 完成后入账'}</small><em>${researched ? `压力 ${profile.pressureDelta > 0 ? '+' : ''}${profile.pressureDelta} · ${extraPreview(profile.type)}` : '风险：未研究'}</em></button>`).join('')}</div>${researched && room.mode !== 'LOCKED' ? `<div class="work-rule">行为档案：${escape(anomaly.archive.behavior)}</div>` : '<div class="work-rule">档案可以提前购买，了解工作风险与镇压方法。<button class="text-button" data-action="archives">查阅档案 ↗</button></div>'}`);
  }

  private renderModal(): void {
    if (!this.modal) { this.element('modal-layer').innerHTML = ''; return; }
    const state = this.simulation.state;
    const day = config.days.find((d) => d.day === state.day)!;
    let title = ''; let content = ''; let wide = false;
    const button = (label: string, action: string, primary = false): string => `<button data-action="${action}" class="${primary ? 'primary' : 'secondary'}">${label}</button>`;
    const buttons = (...html: string[]): string => `<div class="modal-actions">${html.join('')}</div>`;
    switch (this.modal) {
      case 'menu':
        title = '网梗收容';
        content = `<div class="menu-title"><span>异常表达管理局 · 第 07 设施</span><h1>奶龙失效<span>CONTAINMENT FAILURE</span></h1><p>安排工作。管理压力。<br>用三个值班日，维持一间不太正常的收容所。</p></div><div class="menu-facts"><div><b>05</b><span>收容对象</span></div><div><b>03</b><span>值班日</span></div><div><b>01</b><span>当班主管：你</span></div></div>${this.saveError ? `<p class="warning">存档无法读取：${escape(this.saveError)}。旧原文已保留；仅确认新建时覆盖。</p>` : ''}<p class="muted">只在日初入口保存。刷新或重试会回退本日的购买、产出和指令。</p>${buttons(this.started ? button('返回现场', 'resume', true) : this.saved ? button(this.saved.demoCompleted ? '查看完成记录' : `继续 · 第 ${this.saved.snapshot.day} 日`, 'continue', true) : '', button('新建值班记录 →', 'new-game', !this.saved && !this.started), button('操作手册', 'help'))}<p class="tiny">${text('disclaimer')} · 无外部角色图像、配音或音乐</p>`;
        break;
      case 'briefing':
        title = `第 ${state.day} 日 · ${day.title}`;
        content = `<p class="eyebrow">SHIFT BRIEFING / 班前简报</p><p class="lead">${day.briefing}</p><div class="briefing-stats"><div><span>今日累计目标</span><b>${day.quota} <small>ϟ</small></b></div><div><span>在岗员工</span><b>${day.rosterCount} <small>人</small></b></div><div><span>本日开放</span><b class="names">${day.newAnomalyIds.map((id) => anomalyById[id].name).join('、')}</b></div></div><div class="instruction-grid"><div><b>01 / 派遣</b><p>选员工 → 点收容室 → 选择工作。员工到达后开始计时。</p></div><div><b>02 / 收容</b><p>观察压力，安排安抚。失效后右键敌人镇压；安全室免费恢复。</p></div><div><b>03 / 交班</b><p>累计产能达标即可结束。消费只扣可用能量，事故不阻止交班。</p></div></div><p class="note">当前为日初准备；时间静止。此后购买与换装也会在重试今天时回退。</p>${buttons(button('先查看档案', 'archives'), button('进入班前准备', 'prepare'), button('开始工作 →', 'start-day', true))}`;
        break;
      case 'archives':
        title = '收容档案与开发'; wide = true; content = this.archiveContent(); break;
      case 'equipment':
        title = '员工装备分配'; wide = true; content = this.equipmentContent(); break;
      case 'transfer': {
        title = '确认转移专属装备';
        const transfer = this.pendingTransfer;
        if (transfer) {
          const oldHolder = state.employees.find((e) => e.id === transfer.holder)!;
          const newHolder = state.employees.find((e) => e.id === this.equipEmployee)!;
          const name = transfer.slot === 'weapon' ? weaponById[transfer.itemId].name : armorById[transfer.itemId].name;
          content = `<p class="lead">把「${name}」从 ${oldHolder.displayName} 转移给 ${newHolder.displayName}？</p><p>转移完成后，${oldHolder.displayName} 恢复制式${transfer.slot === 'weapon' ? '武器' : '防具'}。两人都须满足换装条件。</p>${buttons(button('取消', 'close'), button('确认转移', 'confirm-transfer', true))}`;
        }
        break;
      }
      case 'settings':
        title = '主管控制台';
        content = `<div class="setting-row"><div><b>每日首次失效自动暂停</b><p>暂停后可以安排镇压、撤退与技能。</p></div><input id="first-pause" type="checkbox" ${this.simulation.pauseOnFirstBreach ? 'checked' : ''}></div><div class="setting-row"><div><b>静音</b><p>所有警报同时提供文字与图形。</p></div><input id="mute" type="checkbox" ${this.audio.muted ? 'checked' : ''}></div><div class="setting-row"><label for="volume">原创提示音音量</label><input id="volume" type="range" min="0" max="100" value="${this.audio.volume * 100}"></div><p class="note">本版仅保存日初入口，不保存日内进度。重试将回退今天的购买与产出。</p>${buttons(button('重试今天', 'retry'), button('主菜单', 'main-menu'), button('返回现场', 'close', true))}`;
        break;
      case 'finish': {
        title = '确认结束今天';
        const works = state.rooms.filter((r) => r.work);
        const accidents = state.rooms.filter((r) => r.mode === 'BREACHED' || r.mode === 'RECOVERING');
        content = `<p class="lead">今日累计产能 <strong>${number(state.producedToday)} / ${day.quota}</strong>，已达到交班标准。</p><div class="handover-list"><p><b>在途 / 正在进行的工作：${works.length} 项</b><span>${works.map((r) => `${anomalyById[r.anomalyId].name} · ${text(`work.${r.work!.type}`)}`).join('，') || '无'}</span></p><p><b>未处理事故 / 恢复中：${accidents.length} 间</b><span>${accidents.map((r) => anomalyById[r.anomalyId].name).join('，') || '无'}</span></p></div><p class="note">未完成工作将取消且没有收入。可以带事故交班，不追加奖励或扣款。</p>${buttons(button('继续工作', 'close'), button('确认交班 →', 'confirm-finish', true))}`;
        break;
      }
      case 'retry':
        title = '重试今天'; content = `<p class="lead">回到第 ${state.day} 日日初入口。</p><p>今天的产能、消费、档案购买、装备调整和重伤都会回退。上一日的结余保留。</p>${buttons(button('取消', 'close'), button('确认重试', 'confirm-retry', true))}`; break;
      case 'new':
        title = '新建值班记录'; content = `<p class="lead">将重置三日进度与本地日初存档。</p><p>从第一日、首次经费 ${config.game.economy.initialWallet} 能量开始。此操作会替换现有记录。</p>${buttons(button('取消', 'close'), button('确认新建', 'confirm-new', true))}`; break;
      case 'tutorial':
        title = '可控失效演练 · 可跳过'; content = `<p class="lead">${text('tutorial.breach')}</p><ol class="tutorial-steps"><li><b>空格暂停 / 继续。</b>暂停时可以下达命令。</li><li><b>框选员工，右键“N01 主样本”镇压。</b>主样本归零后，分身一起消失。</li><li><b>右键安全室撤退。</b>抵达后免费恢复，随时重新调度。</li></ol><p class="note">演练使用真实战斗数据；失效和恢复期间不产能。也可以跳过，正常工作达标。</p>${buttons(button('跳过演练', 'tutorial-no'), button('接受演练', 'tutorial-yes', true))}`; break;
      case 'report':
        title = `第 ${state.day} 日 · 交班报告`; content = this.reportContent() + buttons(button('完整日志', 'logs'), button(state.day === config.days.length ? '完成三日试运行 →' : '进入下一日 →', 'next-day', true)); break;
      case 'complete':
        title = '三日试运行完成'; content = `<p class="eyebrow">SHIFT CLOSED / 交接完毕</p><p class="lead">${text('end.message')}</p>${state.report ? this.reportContent() : `<p>完成标记已保存。五间收容室的三日试运行记录已结束。</p>`}<p class="note">感谢值班。当前角色仍为占位轮廓；后续可用正式参考替换。</p>${buttons(button('返回主菜单', 'main-menu'), button('重新开始', 'new-game', true))}`; break;
      case 'failed':
        title = '本日中止 · 全员重伤'; content = `<p class="lead">本班员工已全部离场，可以从日初重新尝试。</p><p>重试会恢复本日入口的能量、研究与装备，不会丢失上一日的进度。</p>${buttons(button('主菜单', 'main-menu'), button('重试今天', 'confirm-retry', true))}`; break;
      case 'logs':
        title = `第 ${state.day} 日 · 完整值班日志`; wide = true; content = `<p class="muted">模拟时间 / 对象 / 直接原因。只在本地显示。</p><div class="full-logs">${state.logs.map((log) => `<p><time>${clock(log.timeSec)}</time><span>${escape(log.message)}</span></p>`).join('') || '<p>本日暂无事件。</p>'}</div>${buttons(button('返回', 'close', true))}`; break;
      case 'help':
        title = '主管操作手册'; wide = true; content = `<div class="help-grid"><section><h3>调度与战斗</h3><p>左键员工 / 员工卡：选择；Shift 加选；地图拖框多选。</p><p>选一名员工 → 点收容室 → 观察 / 互动 / 安抚。每间只允许一人预约，完成后回到门口待命。</p><p>右键走廊：移动。右键敌人：镇压并自动普攻。右键安全室：撤退，抵达后免费恢复。</p><p>按钮“移动 / 镇压 / 撤退”提供同样的操作。</p></section><section><h3>暂停与技能</h3><p>空格暂停 / 继续。暂停冻结所有模拟时间，仍可登记指令与即时施法。</p><p>数字 1—5 选择技能；1、2 点敌人，3、5 点范围中心，4 直接施放。右键 / Esc 取消瞄准。</p><p>Esc 依次处理：取消瞄准 → 关闭弹窗 → 系统菜单。</p><p>档案和装备面板自动暂停，关闭后尊重此前暂停状态。</p></section><section><h3>能量与交班</h3><p>工作完成才有产能。失效及恢复期间停产，镇压和分身没有能量。</p><p>累计产能用于日目标；可用能量用于消费。消费不影响达标。</p><p>达标即可结束，包括仍有事故时。下一日恢复收容与员工状态。</p></section><section><h3>伤害与存档</h3><p>红伤扣生命；白伤扣精神；黑伤同时扣两者；苍白按最大生命比例计算。</p><p>承伤倍率越低越耐打。装备只有数值，特殊效果在主管技能。</p><p>仅保存日初入口。刷新 / 重试连本日准备时的购买也会回退。</p><p>精神为零会惊慌撤退；生命为零则本日离场，次日恢复。</p></section></div>${buttons(button('明白了', this.started ? 'close' : 'main-menu', true))}`; break;
    }
    const canClose = !['menu', 'briefing', 'tutorial', 'report', 'complete', 'failed'].includes(this.modal);
    this.element('modal-layer').innerHTML = `<div class="modal-shade"><section class="modal ${wide ? 'wide' : ''} ${this.modal === 'menu' ? 'menu-modal' : ''}" role="dialog" aria-modal="true" aria-label="${title}"><header><div><span class="eyebrow">异常表达管理局 / 07</span><h2>${title}</h2></div>${canClose ? '<button class="modal-close" data-action="close" aria-label="关闭">×</button>' : '<span class="file-stamp">内部文件</span>'}</header><div class="modal-content">${content}</div></section></div>`;
  }

  private archiveContent(): string {
    const state = this.simulation.state;
    const anomaly = anomalyById[this.archiveRoom];
    const research = state.progress.research[this.archiveRoom];
    const unlocked = state.rooms.find((r) => r.anomalyId === this.archiveRoom)?.mode !== 'LOCKED';
    const costs = config.game.economy;
    const skill = skillById[anomaly.skillId];
    const tabs = `<div class="archive-tabs">${config.anomalyData.anomalies.map((a) => `<button class="${a.id === this.archiveRoom ? 'active' : ''}" data-archive="${a.id}"><small>${a.id}</small>${a.name}${state.rooms.find((r) => r.anomalyId === a.id)?.mode === 'LOCKED' ? '<span>锁定</span>' : ''}</button>`).join('')}</div>`;
    const buy = (item: string, done: boolean, cost: number, prerequisite: boolean, label: string): string => `<button data-purchase="${item}" class="${done ? 'purchased' : 'primary'}" ${done || !unlocked || !prerequisite || state.progress.wallet < cost ? 'disabled' : ''}>${done ? '✓ 已获得' : !unlocked ? '尚未开放' : !prerequisite ? '需要前置档案' : `${label} · ${cost} ϟ`}</button>`;
    const behaviorNumbers = research.behavior ? `<p class="numeric-detail">${anomaly.workProfiles.map((p) => `${text(`work.${p.type}`)} ${p.durationSec}秒 / ${p.energy}ϟ / 压力${p.pressureDelta >= 0 ? '+' : ''}${p.pressureDelta} / ${damageText(p.hazard)}`).join('<br>')}</p>` : '';
    const combatNumbers = research.combat ? `<p class="numeric-detail">最大镇压 ${anomaly.breach.suppressionHpMax} · ${damageText(anomaly.breach.damage)}<br>攻击周期 ${anomaly.breach.attackPeriodSec}秒 · 前摇 ${anomaly.breach.windupSec}秒 · 范围 ${anomaly.breach.attackRangePx}<br>承伤倍率 ${resistanceText(anomaly.resistances)}</p>` : '';
    return `${tabs}<div class="archive-heading"><div><span class="eyebrow">${anomaly.id} / ${anomaly.conceptNote}</span><h3>${anomaly.name}</h3></div><span class="wallet-pill">可用能量 ${number(state.progress.wallet)} ϟ</span></div>${!unlocked ? `<p class="warning">第 ${anomaly.unlockDay} 日开放；当前无法购买或派遣。</p>` : ''}<div class="archive-grid"><article><span class="eyebrow">01 / 行为档案</span><h3>工作与压力</h3><p>${research.behavior ? anomaly.archive.behavior : '档案未解锁。公开压力条仍会实时显示变化与警戒。'}</p>${behaviorNumbers}${buy('BEHAVIOR', research.behavior, costs.archiveBehaviorCost, true, '解锁行为')}</article><article><span class="eyebrow">02 / 镇压档案</span><h3>失效与处置</h3><p>${research.combat ? anomaly.archive.combat : '先取得行为档案，再了解主样本、失效攻击和镇压特征。'}</p>${combatNumbers}${buy('COMBAT', research.combat, costs.archiveCombatCost, research.behavior, '解锁镇压')}</article><article><span class="eyebrow">03 / 装备开发</span><h3>${weaponById[anomaly.weaponId].name} + 防具</h3><p>武器：${damageText(weaponById[anomaly.weaponId].damage)} · 射程 ${weaponById[anomaly.weaponId].rangePx}<br>防具：${resistanceText(armorById[anomaly.armorId].resistances)}</p><p class="tiny">需行为档案。每物仅开发一次，武器 / 防具各一件。</p>${buy('EQUIPMENT', research.equipmentDeveloped, costs.equipmentPairCost, research.behavior, '开发装备')}</article><article><span class="eyebrow">04 / 主管技能 · ${skill.hotkey}</span><h3>${skill.name}</h3><p>${skill.description}</p><p class="numeric-detail">每次 ${skill.energyCost} ϟ · 冷却 ${skill.cooldownSec} 秒 · 无档案前置</p>${buy('SKILL', state.progress.unlockedSkills.includes(skill.id), costs.skillUnlockCost, true, '解锁技能')}</article></div><p class="note">${text('hint.quotaUnaffectedBySpending')} 技能不依赖穿戴装备，也不要求先触发事故。</p>`;
  }

  private equipmentContent(): string {
    const state = this.simulation.state;
    const employee = state.employees.find((e) => e.id === this.equipEmployee) ?? state.employees[0];
    const canEquip = state.phase === 'DAY_PREP' || employee.location.zone === 'SAFE' && employee.status === 'IDLE';
    const holder = (id: WeaponId | ArmorId, slot: 'weaponId' | 'armorId'): string => {
      const found = state.employees.find((e) => e[slot] === id);
      return found ? `持有人 ${found.displayName}` : '库存中';
    };
    return `<div class="archive-tabs employee-tabs">${state.employees.map((e) => `<button data-equip-employee="${e.id}" class="${e.id === employee.id ? 'active' : ''}">${e.displayName}<span>${text(`employee.${e.status}`)}</span></button>`).join('')}</div><p class="note">${canEquip ? `正在为 ${employee.displayName} 分配装备。专属装备转移后，原持有人恢复制式装备。` : text('error.equipLocation')} 专属装备的原持有人也必须满足换装条件。</p><div class="equipment-columns"><section><h3>武器 <span>攻击参数</span></h3>${config.equipment.weapons.filter((w) => w.unlimitedStarter || state.progress.ownedWeapons.includes(w.id)).map((w) => `<button class="equipment-item ${employee.weaponId === w.id ? 'active' : ''}" data-weapon="${w.id}" ${!canEquip ? 'disabled' : ''}><span class="equipment-icon damage-${w.damage.type}">⌁</span><div><b>${w.name} ${employee.weaponId === w.id ? '✓' : ''}</b><small>${damageText(w.damage)} · 周期 ${w.attackPeriodSec}秒 · 射程 ${w.rangePx}</small><em>${w.unlimitedStarter ? '制式 / 无限库存' : holder(w.id, 'weaponId')}</em></div></button>`).join('')}</section><section><h3>防具 <span>承伤倍率 · 越低越耐打</span></h3>${config.equipment.armors.filter((a) => a.unlimitedStarter || state.progress.ownedArmors.includes(a.id)).map((a) => `<button class="equipment-item ${employee.armorId === a.id ? 'active' : ''}" data-armor="${a.id}" ${!canEquip ? 'disabled' : ''}><span class="equipment-icon">◇</span><div><b>${a.name} ${employee.armorId === a.id ? '✓' : ''}</b><small>${resistanceText(a.resistances)}</small><em>${a.unlimitedStarter ? '制式 / 无限库存' : holder(a.id, 'armorId')}</em></div></button>`).join('')}</section></div><p class="tiny">${text('hint.equipmentNumbersOnly')}</p>`;
  }

  private reportContent(): string {
    const report = this.simulation.state.report;
    if (!report) return '<p>本日交班完成。</p>';
    const stats = [['本日累计产能', report.produced], ['消耗能量', report.spent], ['失效次数', report.breaches], ['未处理事故', report.unresolved], ['重伤人数', report.incapacitated], ['技能使用', report.skillUses]];
    return `<div class="report-grid">${stats.map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join('')}</div><p class="note">${text('report.handover')}</p><p>下班结余：<b>${number(this.simulation.state.progress.wallet)} ϟ</b>。次日保留研究与装备，员工及收容状态恢复。</p>`;
  }
}
