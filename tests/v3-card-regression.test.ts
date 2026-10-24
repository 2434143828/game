import { describe, expect, it } from 'vitest';
import { V3Simulation } from '../src/v3/engine';
import { cardById } from '../src/v3/config';
import type { WeaponId } from '../contracts/data-contract';

function fixture(weapon: WeaponId = 'W00') {
  const sim = new V3Simulation();
  sim.state.employees[0].weaponId = weapon;
  sim.startEncounter('BREACH_CHALLENGE', 'N01');
  const enc = sim.state.encounter!;
  for (const employee of sim.state.employees) employee.nextAttackStartAtSec = 1e9;
  for (const enemy of enc.enemies) enemy.nextAttackStartAtSec = 1e9;
  return { sim, enc, owner: sim.state.employees[0], target: enc.enemies[1] };
}

function giveCard(sim: V3Simulation, cardId: string) {
  const deck = sim.state.encounter!.deck;
  const card = [...deck.hand, ...deck.drawPile].find(c => c.ownerId === 'E01' && c.cardId === cardId)!;
  deck.drawPile = deck.drawPile.filter(c => c.instanceId !== card.instanceId);
  deck.hand = deck.hand.filter(c => c.instanceId !== card.instanceId);
  if (deck.hand.length >= 4) deck.drawPile.push(deck.hand.pop()!);
  deck.hand.push(card);
  return card;
}

describe('card command reliability regressions', () => {
  it('disables copy when its required previous target is dead, then permits a new living attack target', () => {
    const { sim, enc, target } = fixture('W01');
    const card = giveCard(sim, 'N01_3');
    enc.lastAttackCard = { damage: { type: 'WHITE', kind: 'FLAT', amount: 14 }, targetId: target.id };
    target.suppressionHp = 0;
    expect(sim.cardUnavailable(card.instanceId)).toContain('已失效');
    expect(sim.queueCard(card.instanceId, enc.enemies[0].id).ok).toBe(false);
    expect(enc.deck.pendingCast).toBeNull();
    expect(enc.deck.globalCooldown).toBe(0);
    enc.lastAttackCard.targetId = enc.enemies[0].id;
    expect(sim.cardUnavailable(card.instanceId)).toBeNull();
    expect(sim.queueCard(card.instanceId, enc.enemies[0].id).ok).toBe(true);
  });

  it('tracks a moving target without repeatedly discarding completed windup, and impacts only in range', () => {
    const { sim, enc, owner, target } = fixture();
    const card = giveCard(sim, 'T01'), def = cardById[card.cardId];
    owner.location.x = 600;
    target.location.x = owner.location.x + def.rangePx;
    target.stunnedUntilSec = 100;
    expect(sim.queueCard(card.instanceId, target.id).ok).toBe(true);
    sim.step();
    const impactAt = enc.deck.pendingCast!.resolvesAtSec;
    target.location.x += 30;
    const before = target.suppressionHp;
    sim.setPaused(true);
    const paused = structuredClone(sim.state);
    sim.step();
    sim.update(1000);
    expect(sim.state).toEqual(paused);
    sim.setPaused(false);
    for (let tick = 0; tick < 12 && enc.deck.pendingCast; tick++) {
      sim.step();
      if (enc.deck.pendingCast) {
        expect(enc.deck.pendingCast.resolvesAtSec).toBe(impactAt);
        expect(target.suppressionHp).toBe(before);
      }
    }
    expect(enc.deck.pendingCast).toBeNull();
    expect(enc.deck.discardPile).toContain(card);
    expect(Math.abs(owner.location.x - target.location.x)).toBeLessThanOrEqual(def.rangePx);
    expect(sim.state.logs.filter(event => event.kind === 'CARD')).toHaveLength(1);
  });

  it('changing focus preserves an already queued card and its actual windup animation state', () => {
    const { sim, enc, owner, target } = fixture();
    const card = giveCard(sim, 'T01');
    owner.location.x = target.location.x - 20;
    sim.queueCard(card.instanceId, target.id);
    sim.step();
    const pending = structuredClone(enc.deck.pendingCast);
    expect(pending?.phase).toBe('WINDUP');
    sim.focusEnemy(enc.enemies[0].id);
    expect(enc.deck.pendingCast).toEqual(pending);
    expect(owner.attackPhase).toBe('WINDUP');
    expect(owner.windupEndsAtSec).toBe(pending!.resolvesAtSec);
  });

  it('a target invalidated during cast retains the card and reports the reason without starting cooldown', () => {
    const { sim, enc, owner, target } = fixture();
    const card = giveCard(sim, 'T01');
    owner.location.x = target.location.x - 20;
    sim.queueCard(card.instanceId, target.id);
    sim.step();
    target.suppressionHp = 0;
    sim.step();
    expect(enc.deck.pendingCast).toBeNull();
    expect(enc.deck.hand).toContain(card);
    expect(enc.deck.globalCooldown).toBe(0);
    expect([...sim.state.logs].reverse().find(event => event.kind === 'CANCEL')?.message).toContain('目标已失效');
  });

  it('keeps an enemy on its current living corridor target until that target retreats', () => {
    const { sim, enc } = fixture();
    const enemy = enc.enemies[0]!;
    const first = sim.state.employees[0]!;
    const second = sim.state.employees[1]!;
    first.location = { x: 700, y: 500, zone: 'CORRIDOR' };
    second.location = { x: 850, y: 500, zone: 'CORRIDOR' };
    enemy.location.x = 900;
    enemy.targetEmployeeId = first.id;
    enemy.nextAttackStartAtSec = 1e9;
    for (const employee of sim.state.employees) employee.nextAttackStartAtSec = 1e9;
    sim.step();
    expect(enemy.targetEmployeeId).toBe(first.id);
    first.location = { x: 300, y: 500, zone: 'SAFE' };
    sim.step();
    expect(enemy.targetEmployeeId).toBe(second.id);
  });
});
