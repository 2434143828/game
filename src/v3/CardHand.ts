import type { EmployeeId } from '../../contracts/data-contract';
import { cardById, v3Config } from './config';
import type { V3Simulation } from './engine';
import type { V3Scene } from './Scene';
import type { CombatCardInstance } from './model';
import { escape } from '../ui/format';

const targetNames = { ENEMY: '敌方单体', ALLY: '友方单体', SELF: '施牌者自身', TEAM: '全队' };
const themes: Record<string, { name: string; color: string; symbol: string }> = {
  T: { name: '制式训练', color: '#9ac9dd', symbol: '⌖' },
  N01: { name: '奶龙', color: '#f7cf76', symbol: '◉' },
  N02: { name: '耄耋', color: '#e6a4b7', symbol: '!' },
  N03: { name: '大狗', color: '#f28ca9', symbol: '♡' },
  N04: { name: '叮咚鸡', color: '#f6bb54', symbol: '▶' },
  N05: { name: '咕咕嘎嘎', color: '#a7d8ee', symbol: '○' },
};
const categories: Record<string, { name: string; symbol: string }> = {
  DAMAGE: { name: '攻击', symbol: '⌖' }, BLOCK: { name: '防御', symbol: '◇' },
  HEAL: { name: '辅助', symbol: '+' }, STUN: { name: '控制', symbol: '⊘' },
  COPY: { name: '特殊', symbol: '▣' }, COUNTER: { name: '防御', symbol: '↩' },
  KNOCKBACK: { name: '控制', symbol: '➜' }, DELAY: { name: '控制', symbol: '◷' },
  AMPLIFY: { name: '辅助', symbol: '↑' },
};
type Point = { x: number; y: number };
type HandNode = { button: HTMLButtonElement; card: CombatCardInstance; born: number; previousCooldown: number; readyAt: number };
type Flight = { element: HTMLElement; born: number; from: Point; to: Point };

/** Read-only presentation. No DOM animation may queue, resolve or damage a unit. */
export class CardHand {
  private nodes = new Map<string, HandNode>();
  private flights: Flight[] = [];
  private encounterId: string | null = null;
  private preview: HTMLElement;
  private effects: HTMLElement;
  private cancel: HTMLButtonElement;
  private previewId: string | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | undefined;
  private suppressClick = false;
  private lastTime = 0;

  constructor(private host: HTMLElement, private simulation: V3Simulation, private scene: V3Scene) {
    this.cancel = document.createElement('button');
    this.cancel.dataset.v3 = 'cancel-card'; this.cancel.className = 'v3-cancel-card';
    this.cancel.innerHTML = '取消预备<small>Esc</small>'; this.cancel.hidden = true;
    host.append(this.cancel);
    this.preview = document.createElement('aside'); this.preview.className = 'v3-card-preview'; this.preview.hidden = true;
    this.preview.setAttribute('role', 'tooltip');
    this.effects = document.createElement('div'); this.effects.className = 'v3-card-flights'; this.effects.setAttribute('aria-hidden', 'true');
    host.parentElement!.parentElement!.append(this.preview, this.effects);
    host.addEventListener('pointerover', e => {
      if ((e as PointerEvent).pointerType === 'touch') return;
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v3="card"]');
      if (b) this.showPreview(b.dataset.id!);
    });
    host.addEventListener('pointerout', e => {
      const next = (e as PointerEvent).relatedTarget;
      if (!(next instanceof HTMLElement) || !next.closest('[data-v3="card"]')) this.hidePreview();
    });
    host.addEventListener('focusin', e => { const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v3="card"]'); if (b) this.showPreview(b.dataset.id!); });
    host.addEventListener('focusout', () => this.hidePreview());
    host.addEventListener('pointerdown', e => {
      if ((e as PointerEvent).pointerType !== 'touch') return;
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v3="card"]');
      if (b) this.pressTimer = setTimeout(() => { this.showPreview(b.dataset.id!); this.suppressClick = true; }, 420);
    });
    for (const event of ['pointerup', 'pointercancel', 'pointermove']) host.addEventListener(event, () => clearTimeout(this.pressTimer));
    host.addEventListener('click', e => { if (this.suppressClick) { e.stopImmediatePropagation(); this.suppressClick = false; } }, true);
    document.addEventListener('pointerdown', e => { if (!host.contains(e.target as Node)) this.hidePreview(); });
  }

  private face(card: CombatCardInstance): string {
    const def = cardById[card.cardId], theme = themes[card.cardId.startsWith('T') ? 'T' : card.cardId.slice(0, 3)];
    const category = categories[def.effect], owner = this.simulation.state.employees.find(e => e.id === card.ownerId);
    return `<div class="v3-card-face"><div class="v3-card-source"><i>${theme.symbol}</i><span>${theme.name}<small>${card.cardId.startsWith('T') ? 'STD' : card.cardId.slice(0, 3)} / E.G.O.</small></span><em>${category.symbol}<small>${category.name}</small></em></div><div class="v3-card-art"><img src="${import.meta.env.BASE_URL}art/cards-v1/${card.cardId.toLowerCase()}.png" alt="${escape(def.name)}技能插图" draggable="false"><span class="v3-card-art-grid"></span></div><div class="v3-card-info"><b>${escape(def.name)}</b><p>${escape(def.description)}</p><div class="v3-card-owner">${escape(owner?.displayName ?? card.ownerId)} <span>${['—', 'I', 'II', 'III'][card.tier]}</span></div></div></div>`;
  }

  private create(card: CombatCardInstance, now: number, firstHand: boolean): HandNode {
    const button = document.createElement('button');
    const themeKey = card.cardId.startsWith('T') ? 'T' : card.cardId.slice(0, 3);
    button.className = `v3-card theme-${themeKey.toLowerCase()}`;
    button.dataset.v3 = 'card'; button.dataset.id = card.instanceId; button.dataset.cardId = card.cardId;
    button.style.setProperty('--source-color', themes[themeKey].color);
    button.innerHTML = this.face(card) + '<span class="v3-card-cooldown" aria-hidden="true"></span><span class="v3-card-scan" aria-hidden="true"></span><span class="v3-card-state"></span>';
    button.setAttribute('aria-label', `${cardById[card.cardId].name}，${cardById[card.cardId].description}`);
    return { button, card, born: firstHand ? now - 1 : now, previousCooldown: 0, readyAt: -100 };
  }

  private showPreview(id: string): void {
    const node = this.nodes.get(id); if (!node) return;
    const def = cardById[node.card.cardId], reason = this.simulation.cardUnavailable(id);
    this.previewId = id; this.preview.hidden = false;
    this.preview.style.setProperty('--source-color', node.button.style.getPropertyValue('--source-color'));
    this.preview.innerHTML = `<div class="v3-preview-image"><img src="${import.meta.env.BASE_URL}art/cards-v1/${def.id.toLowerCase()}.png" alt=""></div><div><small>${themes[def.id.startsWith('T') ? 'T' : def.id.slice(0, 3)].name} · ${categories[def.effect].name}</small><b>${escape(def.name)}</b><p>${escape(def.description)}</p><small>${targetNames[def.target]} · 射程 ${def.rangePx}<br>准备 ${def.windupSec}s${def.radiusPx ? ` · 范围 ${def.radiusPx}` : ''}</small><p class="v3-preview-condition">${escape(reason ?? '点击选牌，再点击场内目标')}</p></div>`;
    const rect = this.logicalRect(node.button);
    this.preview.style.left = `${Math.min(1040, Math.max(24, rect.x - 30))}px`;
  }
  private hidePreview(): void { this.previewId = null; this.preview.hidden = true; }
  private logicalRect(element: HTMLElement): Point {
    const frame = document.querySelector<HTMLElement>('#game-frame')!.getBoundingClientRect(), r = element.getBoundingClientRect();
    return { x: (r.left - frame.left) * 1600 / frame.width, y: (r.top - frame.top) * 900 / frame.height };
  }
  private flight(node: HandNode, targetId: string | undefined, now: number): void {
    const from = this.logicalRect(node.button);
    const to = targetId && targetId !== 'TEAM' ? this.scene.getEnemyScreenPoint(targetId) ?? this.scene.getEmployeeScreenPoint(targetId as EmployeeId) : this.scene.getEmployeeScreenPoint(node.card.ownerId);
    const element = document.createElement('div'); element.className = 'v3-card-flight';
    element.style.setProperty('--source-color', node.button.style.getPropertyValue('--source-color'));
    element.innerHTML = this.face(node.card); element.dataset.cardId = node.card.cardId;
    this.effects.append(element); this.flights.push({ element, born: now, from: { x: from.x + 72, y: from.y + 106 }, to: to ?? { x: 800, y: 440 } });
  }

  render(armedCard: string | null): void {
    const state = this.simulation.state, encounter = state.encounter, now = state.simulationTimeSec;
    const changedEncounter = (encounter?.id ?? null) !== this.encounterId;
    if (changedEncounter) {
      this.nodes.forEach(n => n.button.remove()); this.nodes.clear();
      this.flights.forEach(f => f.element.remove()); this.flights = []; this.hidePreview();
      this.encounterId = encounter?.id ?? null;
    }
    if (!encounter) { this.cancel.hidden = true; this.host.hidden = true; return; }
    this.host.hidden = false;
    const deck = encounter.deck;
    for (const [id, node] of this.nodes) if (!deck.hand.some(c => c.instanceId === id)) {
      // A removal caused by incapacitation is not a successful cast. Only a new
      // CARD event plus this actual discarded instance can trigger the flight.
      const event = [...state.logs].reverse().find(l => l.kind === 'CARD' && l.instanceId === id && l.timeSec > this.lastTime - 0.001);
      if (event && deck.discardPile.some(c => c.instanceId === id)) this.flight(node, event.targetId, now);
      node.button.remove(); this.nodes.delete(id);
      if (this.previewId === id) this.hidePreview();
    }
    deck.hand.forEach((card, i) => {
      let node = this.nodes.get(card.instanceId);
      if (!node) { node = this.create(card, now, changedEncounter); this.nodes.set(card.instanceId, node); this.host.insertBefore(node.button, this.cancel); }
      const b = node.button, cd = deck.globalCooldown, cooling = cd > 0.0001;
      const reason = this.simulation.cardUnavailable(card.instanceId), pending = deck.pendingCast?.instanceId === card.instanceId;
      const unavailable = Boolean(reason) && !cooling && !pending;
      b.disabled = Boolean(reason); b.classList.toggle('armed', armedCard === card.instanceId); b.classList.toggle('pending', pending);
      b.classList.toggle('cooling', cooling); b.classList.toggle('unavailable', unavailable); b.classList.toggle('available', !reason);
      b.dataset.cardState = cooling ? 'cooldown' : pending ? 'casting' : unavailable ? 'unavailable' : armedCard === card.instanceId ? 'selected' : 'available';
      b.dataset.cooldown = cd.toFixed(3); b.setAttribute('aria-pressed', String(armedCard === card.instanceId));
      b.title = reason ?? `${cardById[card.cardId].name} · 点击后选择目标`;
      if (node.previousCooldown > 0 && !cooling) node.readyAt = now;
      node.previousCooldown = cd;
      const progress = cooling ? Math.max(0, Math.min(1, 1 - cd / v3Config.combat.globalCardCooldownSec)) : 1;
      b.style.setProperty('--cooldown-cut', `${progress * 100}%`);
      b.style.setProperty('--idle-y', `${Math.sin(now * Math.PI + i * 0.6) * 2}px`);
      b.style.setProperty('--ready-flash', `${Math.max(0, 1 - (now - node.readyAt) / 0.35)}`);
      const draw = Math.min(1, (now - node.born) / 0.32);
      b.style.setProperty('--draw-x', `${(1 - draw) * (788 - i * 162)}px`);
      b.style.setProperty('--draw-y', `${(1 - draw) * -30}px`);
      b.style.setProperty('--draw-scale', `${0.65 + draw * 0.35}`);
      b.style.setProperty('--draw-opacity', `${0.25 + draw * 0.75}`);
      const status = b.querySelector<HTMLElement>('.v3-card-state')!;
      const statusText = cooling ? `公共冷却 ${cd.toFixed(1)}s` : pending ? !state.timeScale ? '已预备 · 继续后执行' : deck.pendingCast?.phase === 'APPROACH' ? '员工正在接近目标' : '员工正在施放' : reason ? `锁定 · ${reason}` : armedCard === card.instanceId ? '已选中 · 点击场内目标' : targetNames[cardById[card.cardId].target];
      if (status.textContent !== statusText) status.textContent = statusText;
    });
    this.cancel.hidden = !armedCard && !deck.pendingCast;
    if (this.previewId) {
      const condition = this.preview.querySelector<HTMLElement>('.v3-preview-condition');
      if (condition) {
        const reason = this.simulation.cardUnavailable(this.previewId) ?? '点击选牌，再点击场内目标';
        if (condition.textContent !== reason) condition.textContent = reason;
      }
    }
    for (const flight of this.flights) {
      const age = now - flight.born;
      if (age >= 0.68) { flight.element.remove(); continue; }
      const p = Math.min(1, age / 0.24), discard = Math.max(0, (age - 0.32) / 0.36);
      const ease = p * p;
      let x = flight.from.x + (flight.to.x - flight.from.x) * ease;
      let y = flight.from.y + (flight.to.y - flight.from.y) * ease - Math.sin(p * Math.PI) * 65;
      let scale = 1 - p * 0.7;
      if (discard > 0) { x += (1292 - x) * discard; y += (730 - y) * discard; scale *= 1 - discard * 0.8; }
      flight.element.dataset.phase = age < 0.24 ? 'cast' : age < 0.32 ? 'burst' : 'discard';
      flight.element.style.transform = `translate(${x - 72}px,${y - 106}px) scale(${scale}) rotate(${discard * 28}deg)`;
      flight.element.style.opacity = String(1 - discard * 0.8);
    }
    this.flights = this.flights.filter(f => now - f.born < 0.68);
    this.lastTime = now;
  }
}
