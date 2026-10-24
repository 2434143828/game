import type Phaser from 'phaser';
import type { EmployeeId, Point } from '../../contracts/data-contract';
import { cardById, v3Config } from './config';
import type { CardDefinition, V3State } from './model';

/** Selection is UI state; every owner, target, range and cast is resolved from the simulation. */
export interface CardPresentation {
  instanceId: string; cardId: string; ownerId: EmployeeId;
  target: CardDefinition['target']; rangePx: number; radiusPx?: number;
}
const palettes: Record<string, number> = { N01: 0xffd774, N02: 0xf092a6, N03: 0xff9abb, N04: 0xffb74f, N05: 0xb9defb, TRAIN: 0x8de0da };
const stamps: Record<string, string> = {
  N01: 'nm_v2_poll_n01_repeat_comment_blank', N02: 'nm_v2_poll_n02_argument_emotion_tag_blank',
  N03: 'nm_v2_poll_n03_live_cheer_heart', N04: 'nm_v2_poll_n04_notification_waveform_panel_blank',
  N05: 'nm_v2_poll_n05_soft_noise_onomatopoeia_blank',
};
interface TargetingEvidence {
  cardId: string; ownerId: string; targetIds: string[]; focusTargetId: string | null;
  /** The entity under the pointer, if the pointer is over a legal target hitbox. */
  pointerTargetId: string | null;
  /** World-space pointer and the endpoint used by the live direction arrow. */
  pointer: Point | null; arrowTarget: Point | null; arrowLegal: boolean;
  rangePx: number; radiusPx: number; timeSec: number;
}
interface CastEvidence { eventId: string; cardId: string; sourceId?: string; targetId?: string; ageSec: number; source: Point; target: Point }

/** Decorative only: no callbacks, timers, damage or mutations of game state. */
export class CardEffects {
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly sprites: Phaser.GameObjects.Image[] = [];
  private used = 0;
  private targeting: TargetingEvidence | null = null;
  private casts: CastEvidence[] = [];
  constructor(private readonly scene: Phaser.Scene) { this.graphics = scene.add.graphics().setDepth(11); }

  render(state: V3State, selection: CardPresentation | null, pointer: Point | null): void {
    this.graphics.clear(); this.used = 0; this.targeting = null; this.casts = [];
    if (state.phase === 'ENCOUNTER' && state.encounter) {
      if (selection && !state.encounter.result) this.preview(state, selection, pointer);
      for (const event of state.logs) {
        const age = state.simulationTimeSec - event.timeSec;
        if (event.kind !== 'CARD' || !event.cardId || !event.sourcePoint || !event.targetPoint || age < 0 || age > 0.7) continue;
        if (!state.encounter.squadIds.includes(event.sourceId as EmployeeId)) continue;
        const def = cardById[event.cardId]; if (!def) continue;
        const source = { x: event.sourcePoint.x, y: event.sourcePoint.y - 40 };
        const target = { x: event.targetPoint.x, y: event.targetPoint.y - 40 };
        this.casts.push({ eventId: event.id, cardId: event.cardId, sourceId: event.sourceId, targetId: event.targetId, ageSec: age, source, target });
        this.cast(event.cardId, def, source, target, age);
        if (def.target === 'TEAM') for (const ally of state.employees.filter(e => state.encounter!.squadIds.includes(e.id) && e.hp > 0 && e.id !== event.sourceId)) {
          this.motif(event.cardId.split('_')[0], { x: ally.location.x, y: ally.location.y - 38 }, age, 0.55);
        }
      }
    }
    for (let i = this.used; i < this.sprites.length; i++) this.sprites[i].setVisible(false);
  }

  private preview(state: V3State, selected: CardPresentation, pointer: Point | null): void {
    const enc = state.encounter!, card = enc.deck.hand.find(c => c.instanceId === selected.instanceId);
    const owner = state.employees.find(e => e.id === card?.ownerId);
    if (!card || !owner || owner.hp <= 0) return;
    const def = cardById[card.cardId], color = palettes[card.cardId.split('_')[0]] ?? palettes.TRAIN;
    const g = this.graphics, p = owner.location, phase = state.simulationTimeSec;
    const directional = def.target === 'ENEMY' || def.target === 'ALLY';
    const candidates = def.target === 'ENEMY'
      ? enc.enemies.filter(e => e.suppressionHp > 0)
      : state.employees.filter(e => enc.squadIds.includes(e.id) && e.hp > 0 && (def.target !== 'SELF' || e.id === owner.id));
    const pending = enc.deck.pendingCast?.instanceId === card.instanceId ? enc.deck.pendingCast : null;
    const hovered = pointer ? candidates.filter(e => Math.abs(pointer.x - e.location.x) < 55 && pointer.y >= e.location.y - 120 && pointer.y <= e.location.y + 20)
      .sort((a, b) => Math.abs(pointer.x - a.location.x) - Math.abs(pointer.x - b.location.x))[0] : undefined;
    const focused = candidates.find(e => e.id === pending?.targetId) ?? hovered
      ?? candidates.find(e => e.id === (def.target === 'ENEMY' ? enc.focusEnemyId : owner.id));
    const focusedPoint = focused ? { x: focused.location.x, y: focused.location.y - 43 } : null;
    // The arrow follows the actual pointer in scene coordinates.  Once the
    // pointer is over a legal target it snaps to that entity's body anchor;
    // otherwise it remains a low-alpha aim guide and the legal target circles
    // stay authoritative.  This keeps the preview honest without making a
    // click on empty space queue a cast.
    const pointerAim = pointer ? {
      x: Math.max(v3Config.arena.minX, Math.min(v3Config.arena.maxX, pointer.x)),
      y: Math.max(p.y - 96, Math.min(p.y + 12, pointer.y)),
    } : null;
    const arrowTarget = directional ? (hovered ? { x: hovered.location.x, y: hovered.location.y - 43 } : pointerAim ?? focusedPoint) : null;
    this.targeting = {
      cardId: card.cardId, ownerId: owner.id, targetIds: candidates.map(e => e.id),
      focusTargetId: focused?.id ?? null, pointerTargetId: directional ? hovered?.id ?? null : null,
      pointer, arrowTarget, arrowLegal: Boolean(hovered), rangePx: def.rangePx,
      radiusPx: def.radiusPx ?? 0, timeSec: phase,
    };
    // Ground strip shows true approach range without obscuring character silhouettes.
    const left = Math.max(v3Config.arena.minX, p.x - def.rangePx), right = Math.min(v3Config.arena.maxX, p.x + def.rangePx);
    g.fillStyle(color, 0.09).fillRect(left, p.y - 8, right - left, 24);
    g.lineStyle(2, color, 0.7).lineBetween(left, p.y + 16, right, p.y + 16);
    g.lineBetween(left, p.y + 8, left, p.y + 21).lineBetween(right, p.y + 8, right, p.y + 21);
    g.lineStyle(2.5, color, 0.9).strokeEllipse(p.x, p.y + 2, 54 + Math.sin(phase * 5) * 3, 16);
    g.fillStyle(color, 0.9).fillTriangle(p.x - 5, p.y - 121, p.x + 5, p.y - 121, p.x, p.y - 113);
    for (const target of candidates) {
      const t = target.location, inRange = Math.hypot(t.x - p.x, t.y - p.y) <= def.rangePx;
      const highlight = target.id === focused?.id;
      g.lineStyle(highlight ? 2.5 : 1.2, color, highlight ? 0.95 : inRange ? 0.55 : 0.28).strokeEllipse(t.x, t.y + 4, highlight ? 70 : 55, 15);
      if (highlight) {
        for (const direction of [-1, 1]) {
          const x = t.x + direction * 31;
          g.lineBetween(x, t.y - 72, x, t.y - 51).lineBetween(x, t.y - 72, x - direction * 9, t.y - 72);
        }
      }
    }
    if (!focused && !arrowTarget) return;
    const sourcePoint = { x: p.x, y: p.y - 43 };
    if (arrowTarget) this.directionArrow(g, sourcePoint, arrowTarget, color, hovered ? 0.95 : pointer ? 0.42 : 0.7, Boolean(hovered));
    const t = focused?.location;
    if (def.radiusPx && t) {
      g.fillStyle(color, 0.065).fillEllipse(t.x, t.y, def.radiusPx * 2, 46);
      g.lineStyle(2, color, 0.7).strokeEllipse(t.x, t.y, def.radiusPx * 2, 46);
    }
    if (pending?.phase === 'WINDUP') {
      const progress = Math.max(0, Math.min(1, 1 - ((pending.resolvesAtSec ?? phase) - phase) / def.windupSec));
      g.lineStyle(3, color, 0.9).beginPath().arc(p.x, p.y - 42, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress).strokePath();
    }
  }

  /** Draws the live target guide only; simulation target selection stays in HUD/engine. */
  private directionArrow(g: Phaser.GameObjects.Graphics, from: Point, to: Point, color: number, alpha: number, legal: boolean): void {
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy);
    if (length < 3) return;
    const ux = dx / length, uy = dy / length, px = -uy, py = ux;
    const head = legal ? 15 : 11;
    const shaft = { x: to.x - ux * (head * 0.72), y: to.y - uy * (head * 0.72) };
    g.lineStyle(legal ? 3 : 2, color, alpha).lineBetween(from.x, from.y, shaft.x, shaft.y);
    g.fillStyle(color, Math.min(1, alpha + 0.08)).fillTriangle(
      to.x, to.y,
      to.x - ux * head + px * head * 0.56, to.y - uy * head + py * head * 0.56,
      to.x - ux * head - px * head * 0.56, to.y - uy * head - py * head * 0.56,
    );
    if (!legal) g.lineStyle(1, color, alpha * 0.7).strokeCircle(to.x, to.y, 5);
  }

  private cast(cardId: string, def: CardDefinition, source: Point, target: Point, age: number): void {
    const theme = cardId.split('_')[0], color = palettes[theme] ?? palettes.TRAIN, g = this.graphics;
    const alpha = Math.max(0, 1 - age / 0.7);
    // Successful casts light the owner's hand and actual target together. This is feedback, not a delayed simulation projectile.
    g.lineStyle(2.5, color, alpha * 0.65).lineBetween(source.x, source.y, target.x, target.y);
    g.fillStyle(color, alpha * 0.18).fillCircle(source.x, source.y, 10 + age * 25);
    this.motif(theme, target, age, 1);
    if (def.radiusPx) g.lineStyle(2, color, alpha * 0.8).strokeEllipse(target.x, target.y + 40, def.radiusPx * 2, 30 + age * 20);
    if (def.effect === 'BLOCK' || def.effect === 'COUNTER') g.lineStyle(3, color, alpha).strokeRoundedRect(source.x - 25, source.y - 40, 50, 78, 15);
  }

  private motif(theme: string, target: Point, age: number, scale: number): void {
    const g = this.graphics, color = palettes[theme] ?? palettes.TRAIN;
    const alpha = Math.max(0, 1 - age / 0.7) * scale, radius = 14 + age * 75;
    g.lineStyle(2, color, alpha);
    if (theme === 'N01') {
      for (let i = 0; i < 3; i++) g.strokeRoundedRect(target.x - 24 + i * 13 + age * 8, target.y - 20 - i * 9, 45, 28, 10);
    } else if (theme === 'N02') {
      g.beginPath();
      for (let i = 0; i <= 16; i++) { const angle = i * Math.PI / 8, r = radius * (i % 2 ? 0.55 : 1); const x = target.x + Math.cos(angle) * r, y = target.y + Math.sin(angle) * r; if (!i) g.moveTo(x, y); else g.lineTo(x, y); }
      g.strokePath();
    } else if (theme === 'N04') {
      g.strokeRoundedRect(target.x - 47, target.y - 23, 94, 46, 4);
      for (let i = 0; i < 11; i++) { const height = 5 + Math.abs(Math.sin(i * 2 + age * 12)) * 19; g.lineBetween(target.x - 35 + i * 7, target.y - height, target.x - 35 + i * 7, target.y + height); }
    } else {
      for (let i = 0; i < 3; i++) g.lineStyle(2, color, alpha * (1 - i * 0.2)).strokeEllipse(target.x, target.y, radius * 2 + i * 15, radius * (theme === 'N05' ? 0.9 : 1.6) + i * 10);
    }
    const texture = stamps[theme]; if (!texture || alpha <= 0) return;
    const key = `generated:${texture}`; if (!this.scene.textures.exists(key)) return;
    let image = this.sprites[this.used++];
    if (!image) { image = this.scene.add.image(0, 0, key).setDepth(12); this.sprites.push(image); }
    const width = theme === 'N03' ? 34 : 66;
    image.setTexture(key).setPosition(target.x + 22, target.y - 28 - age * 18).setDisplaySize(width, 31).setAlpha(alpha).setVisible(true);
  }

  getState(): { targeting: TargetingEvidence | null; casts: CastEvidence[] } { return { targeting: this.targeting, casts: this.casts }; }
}
