import { describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { V3Simulation } from '../src/v3/engine';
import { anomalyIds, cardById, v3Config } from '../src/v3/config';
import type { AnomalyId, ArmorId, WeaponId } from '../contracts/data-contract';

/** Only unlock/equipment fixtures are prepared; all movement, attacks and results use the live engine. */
function fixture(id: AnomalyId, rank: 0 | 1 | 2, seed: number): V3Simulation {
  const s = new V3Simulation();
  s.state.rngState = seed;
  const index = anomalyIds.indexOf(id);
  for (const [i, room] of s.state.rooms.entries()) {
    const owned = i < index || (i === index && rank > 0);
    Object.assign(room, { owned, rank: owned ? (i === index ? rank : 2) : 0, state: owned ? 'STABLE' : 'LOCKED' });
  }
  s.state.wallet = 500;
  s.state.ownedWeapons = s.state.rooms.filter(r => r.owned).map(r => `W${r.anomalyId.slice(1)}` as WeaponId);
  s.state.ownedArmors = s.state.rooms.filter(r => r.owned).map(r => `A${r.anomalyId.slice(1)}` as ArmorId);
  // Captures cannot use the target's own locked gear. The previous unlocked source supplies a single pair.
  const source = rank === 0 ? anomalyIds[index - 1] : id;
  const tier = rank === 0 ? 2 : rank;
  expect(s.equip('E01', `W${source.slice(1)}` as WeaponId, `A${source.slice(1)}` as ArmorId, tier).ok).toBe(true);
  expect(s.startEncounter(rank === 0 ? 'CAPTURE' : 'BREACH_CHALLENGE', id).ok).toBe(true);
  return s;
}

function play(id: AnomalyId, rank: 0 | 1 | 2, cards: boolean, seed: number) {
  const s = fixture(id, rank, seed);
  const loadout = s.state.employees.map(e => ({ id: e.id, weapon: e.weaponId, armor: e.armorId, tier: e.weaponTier }));
  const enc = s.state.encounter!;
  const hp = enc.enemies[0].suppressionHpMax;
  for (let i = 0; i < 4000 && !enc.result; i++) {
    if (enc.mode === 'CAPTURE' && enc.capturePhase === 'CAPTURABLE' && !enc.captureEmployeeId) {
      expect(s.startCapture(enc.squadIds[0]).ok).toBe(true);
    }
    if (cards && !enc.deck.pendingCast && enc.deck.globalCooldown < 1e-7) {
      // Prefer damage, then control/support. A full hand may cycle a defensive card to free a draw slot.
      const ordered = [...enc.deck.hand].sort((a, b) => Number(cardById[b.cardId].effect === 'DAMAGE') - Number(cardById[a.cardId].effect === 'DAMAGE'));
      for (const card of ordered) {
        const def = cardById[card.cardId];
        const ally = [...s.state.employees].filter(e => e.hp > 0).sort((a, b) => a.sp / a.spMax - b.sp / b.spMax)[0];
        if (enc.deck.hand.length < v3Config.combat.handLimit) {
          if (def.effect === 'HEAL' && ally.sp > ally.spMax - 10) continue;
          if (def.effect === 'BLOCK' || def.effect === 'COUNTER') continue;
        }
        const target = def.target === 'ENEMY' ? enc.enemies[0].id : def.target === 'TEAM' ? 'TEAM' : def.target === 'SELF' ? card.ownerId : ally.id;
        if (s.queueCard(card.instanceId, target).ok) break;
      }
    }
    s.step();
  }
  return {
    anomaly: id, mode: enc.mode, startRank: rank, seed, strategy: cards ? 'useful-cards' : 'auto-only',
    hp, seconds: Number(enc.elapsedSec.toFixed(2)), result: enc.result, loadout,
    survivors: s.state.employees.filter(e => e.hp > 0).length,
    employeeState: s.state.employees.map(e => ({ id: e.id, hp: Number(e.hp.toFixed(2)), sp: Number(e.sp.toFixed(2)) })),
    successfulCards: s.state.logs.filter(l => l.kind === 'CARD').length,
    specialTelegraphs: s.state.logs.filter(l => l.kind === 'TELEGRAPH' && l.message === v3Config.enemies[id].specialName).length,
  };
}

const scenarios = anomalyIds.flatMap(id => ([...(id === 'N01' ? [] : [0]), 1, 2] as (0 | 1 | 2)[]).flatMap(rank => [false, true].flatMap(cards => (cards ? [1, 31023, 84721] : [31023]).map(seed => ({ id, rank, cards, seed })))));
const results: ReturnType<typeof play>[] = [];

describe('v0.3 twenty-second encounters with one available exclusive gear pair', () => {
  it.each(scenarios)('$id rank $rank cards=$cards seed=$seed wins inside twenty simulation seconds including approach', ({ id, rank, cards, seed }) => {
    const result = play(id, rank, cards, seed);
    results.push(result);
    expect(result.result).toBe('VICTORY');
    expect(result.survivors).toBe(3);
    expect(result.seconds).toBeGreaterThan(6);
    expect(result.seconds).toBeLessThanOrEqual(20);
    if (!cards) expect(result.specialTelegraphs).toBeGreaterThan(0);
  });
  it('writes the reproducible balance report when requested', () => {
    if (!process.env.V3_BALANCE_REPORT) return;
    writeFileSync('docs/GAMEPLAY_V03_BALANCE.json', JSON.stringify({
      method: 'Fixed-step actual engine; fresh full-health squad; one unique matching exclusive pair plus two starter pairs; capture uses previous source tier II; no damage, position, timers or cards injected after start; elapsed includes approach; 1x simulation seconds.',
      boundary: 'N01 starts owned; its capture is not available. Rank I and II challenges grant II and III respectively; max-rank III cannot be challenged again. Fresh full-health baseline is not a guarantee for wounded squads or deliberate retreat. These are simulation tests, not browser proof.',
      command: '$env:V3_BALANCE_REPORT="1"; npx vitest run tests/v3-balance.test.ts',
      config: { tier: v3Config.tier, enemies: v3Config.enemies },
      summary: anomalyIds.map(id => {
        const rows = results.filter(r => r.anomaly === id);
        const auto = rows.filter(r => r.strategy === 'auto-only').map(r => r.seconds);
        const cards = rows.filter(r => r.strategy === 'useful-cards').map(r => r.seconds);
        return { anomaly: id, autoSeconds: [Math.min(...auto), Math.max(...auto)], cardSeconds: [Math.min(...cards), Math.max(...cards)], wins: rows.filter(r => r.result === 'VICTORY').length, cases: rows.length };
      }),
      results,
    }, null, 2));
  });
});
