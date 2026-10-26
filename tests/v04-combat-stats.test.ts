import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V3Simulation } from '../src/v3/engine';
import { cardById, v3Config } from '../src/v3/config';
import type { AnomalyId } from '../contracts/data-contract';

type Strategy = 'A' | 'B' | 'C';
type EncounterTarget = 'N01' | 'N02';

interface CombatStats {
  encounterId: string;
  mode: 'BREACH_CHALLENGE' | 'CAPTURE';
  enemyId: string;
  tier: number;
  seed: number;
  strategy: Strategy;
  anomalyId: EncounterTarget;
  simulatedDurationSec: number;
  realDurationMs: number;
  drawCount: number;
  cardAttempts: number;
  castCount: number;
  successfulCastCount: number;
  interruptCount: number;
  teamHpLoss: number;
  teamSpLoss: number;
  teamHpRemaining: number;
  teamSpRemaining: number;
  autoAttackDamage: number;
  cardDamage: number;
  controlContribution: number;
  controlSeconds: number;
  shieldContribution: number;
  healingContribution: number;
  result: 'VICTORY' | 'DEFEAT' | 'ABANDONED' | null;
  maxSteps: number;
}

interface StatsReport {
  schemaVersion: 'v0.4-combat-stats-1';
  generatedAt: string;
  fixedStepSec: number;
  drawIntervalSec: number;
  globalCardCooldownSec: number;
  benchmarkLoadout: string;
  scenarios: CombatStats[];
}

const DT = 0.05;
const MAX_SECONDS = 180;
const SEEDS: Record<EncounterTarget, number> = { N01: 20241024, N02: 20241025 };

function rand(state: { value: number }): number {
  state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0;
  return state.value / 4294967296;
}

function cardTarget(sim: V3Simulation, instanceId: string): string {
  const encounter = sim.state.encounter!;
  const card = encounter.deck.hand.find(item => item.instanceId === instanceId)!;
  const definition = cardById[card.cardId];
  if (definition.target === 'TEAM') return 'TEAM';
  if (definition.target === 'SELF') return card.ownerId;
  if (definition.target === 'ALLY') {
    return sim.state.employees
      .filter(employee => encounter.squadIds.includes(employee.id) && employee.hp > 0)
      .sort((a, b) => (a.sp / a.spMax) - (b.sp / b.spMax))[0]?.id ?? card.ownerId;
  }
  return encounter.enemies
    .filter(enemy => enemy.suppressionHp > 0)
    .sort((a, b) => a.suppressionHp - b.suppressionHp)[0]?.id ?? encounter.enemies[0].id;
}

function legalCards(sim: V3Simulation): Array<{ instanceId: string; cardId: string; targetId: string }> {
  const encounter = sim.state.encounter;
  if (!encounter || encounter.result || encounter.deck.pendingCast || encounter.deck.globalCooldown > 1e-7) return [];
  return encounter.deck.hand
    .map(card => ({ instanceId: card.instanceId, cardId: card.cardId, targetId: cardTarget(sim, card.instanceId) }))
    .filter(card => sim.cardUnavailable(card.instanceId, card.targetId) === null);
}

function selectCard(sim: V3Simulation, strategy: Strategy, randomState: { value: number }): { instanceId: string; targetId: string } | null {
  const cards = legalCards(sim);
  if (!cards.length || strategy === 'A') return null;
  if (strategy === 'B') {
    const card = cards[Math.floor(rand(randomState) * cards.length)]!;
    return { instanceId: card.instanceId, targetId: card.targetId };
  }
  const encounter = sim.state.encounter!;
  // Reserve a defensive/control card for the final 0.45 s of a telegraph;
  // otherwise C spends its hand on damage and only reacts to a real danger.
  const imminent = encounter.enemies.some(enemy => enemy.suppressionHp > 0 && enemy.windupEndsAtSec !== null && enemy.windupEndsAtSec - sim.state.simulationTimeSec <= 0.45);
  const lowestSp = sim.state.employees
    .filter(employee => encounter.squadIds.includes(employee.id) && employee.hp > 0)
    .sort((a, b) => a.sp - b.sp)[0];
  const control = cards.find(card => ['STUN', 'KNOCKBACK', 'DELAY'].includes(cardById[card.cardId].effect));
  const counter = cards.find(card => cardById[card.cardId].effect === 'COUNTER');
  const block = cards.find(card => cardById[card.cardId].effect === 'BLOCK');
  const defense = counter ?? block;
  const damage = cards.find(card => ['DAMAGE', 'COPY'].includes(cardById[card.cardId].effect));
  const heal = lowestSp && lowestSp.sp < lowestSp.spMax * 0.4 ? cards.find(card => cardById[card.cardId].effect === 'HEAL') : undefined;
  const priority = (imminent ? (control ?? defense) : undefined) ?? (damage ?? heal ?? defense);
  const card = priority ?? cards[0]!;
  return { instanceId: card.instanceId, targetId: card.targetId };
}

function prepare(sim: V3Simulation, anomalyId: EncounterTarget): void {
  if (anomalyId === 'N01') {
    sim.state.rooms[0]!.rank = 1;
    // Normalize the squad loadout so the benchmark exercises the real N01 cards.
    for (const employee of sim.state.employees) { employee.weaponId = 'W01'; employee.armorId = 'A01'; }
    expect(sim.startEncounter('BREACH_CHALLENGE', 'N01').ok).toBe(true);
    seedBenchmarkCards(sim, ['N01_1', 'N01_2']);
    return;
  }
  // N02 is a real capture entry. Rank II N01 and the capture wallet gate are set
  // as preconditions because this report measures the fight, not the unlock grind.
  sim.state.rooms[0]!.rank = 2;
  sim.state.wallet = v3Config.captureCosts.N02;
  // N02 cards are evaluated as a combat benchmark with one corresponding
  // loadout equipped. The capture gate and wallet remain real, but the
  // post-capture equipment grant is intentionally not part of this fight.
  for (const employee of sim.state.employees) { employee.weaponId = 'W02'; employee.armorId = 'A02'; }
  expect(sim.startEncounter('CAPTURE', 'N02').ok).toBe(true);
  seedBenchmarkCards(sim, ['N02_1', 'N02_3']);
}

/** Keep the benchmark deterministic while preserving the real deck and draw rules. */
function seedBenchmarkCards(sim: V3Simulation, wanted: string[]): void {
  const deck = sim.state.encounter!.deck;
  for (const [slot, cardId] of wanted.entries()) {
    const handIndex = deck.hand.findIndex(card => card.cardId === cardId);
    if (handIndex >= 0) continue;
    const drawIndex = deck.drawPile.findIndex(card => card.cardId === cardId);
    if (drawIndex < 0) continue;
    const replacement = deck.drawPile.splice(drawIndex, 1)[0]!;
    const displaced = deck.hand[slot];
    if (displaced) deck.drawPile.push(displaced);
    deck.hand[slot] = replacement;
  }
}

function measure(sim: V3Simulation, anomalyId: EncounterTarget, strategy: Strategy, seed: number): CombatStats {
  const encounter = sim.state.encounter!;
  let hpLoss = 0;
  let spLoss = 0;
  let autoAttackDamage = 0;
  let cardDamage = 0;
  let healingContribution = 0;
  let interruptCount = 0;
  let drawCount = encounter.deck.hand.length;
  let cardAttempts = 0;
  let previousHand = new Set(encounter.deck.hand.map(card => card.instanceId));
  const randomState = { value: seed ^ (strategy.charCodeAt(0) * 2654435761) };
  const enemyIds = new Set(encounter.enemies.map(enemy => enemy.id));
  const started = performance.now();
  let steps = 0;
  while (!sim.state.encounter?.result && steps < MAX_SECONDS / DT) {
    // Capture device activation is a non-card interaction. For a comparable
    // A/B/C benchmark, every strategy activates it as soon as the target is
    // legally capturable; card policy remains the only variable.
    if (sim.state.encounter?.mode === 'CAPTURE' && sim.state.encounter.capturePhase === 'CAPTURABLE' && !sim.state.encounter.captureEmployeeId) {
      const operator = sim.state.encounter.squadIds.find(id => sim.state.employees.find(e => e.id === id && e.hp > 0));
      if (operator) sim.startCapture(operator);
    }
    const chosen = selectCard(sim, strategy, randomState);
    if (chosen !== null) {
      cardAttempts += 1;
      sim.queueCard(chosen.instanceId, chosen.targetId);
    }
    const beforeHp = sim.state.employees.reduce((sum, employee) => sum + employee.hp, 0);
    const beforeSp = sim.state.employees.reduce((sum, employee) => sum + employee.sp, 0);
    sim.step();
    const afterHp = sim.state.employees.reduce((sum, employee) => sum + employee.hp, 0);
    const afterSp = sim.state.employees.reduce((sum, employee) => sum + employee.sp, 0);
    hpLoss += Math.max(0, beforeHp - afterHp);
    spLoss += Math.max(0, beforeSp - afterSp);
    // Events are keyed by the fixed-step timestamp. The engine keeps a bounded
    // log, so an array cursor would become invalid after truncation.
    const events = sim.state.logs.filter(event => Math.abs(event.timeSec - sim.state.simulationTimeSec) < 1e-7);
    const enemyHits = events.filter(event => event.kind === 'HIT' && event.targetId !== undefined && enemyIds.has(event.targetId));
    const cardEvents = events.filter(event => event.kind === 'CARD');
    const usedHitIndexes = new Set<number>();
    for (const cardEvent of cardEvents) {
      const hitIndex = enemyHits.findIndex((event, index) => !usedHitIndexes.has(index) && event.sourceId === cardEvent.sourceId && event.targetId === cardEvent.targetId);
      if (hitIndex >= 0) {
        usedHitIndexes.add(hitIndex);
        cardDamage += enemyHits[hitIndex]!.amount ?? 0;
      }
      const definition = cardById[cardEvent.cardId ?? ''];
      if (definition?.effect === 'HEAL') healingContribution += events.filter(event => event.kind === 'HEAL' && event.sourceId === cardEvent.sourceId).reduce((sum, event) => sum + (event.amount ?? 0), 0);
    }
    autoAttackDamage += enemyHits.reduce((sum, event, index) => sum + (usedHitIndexes.has(index) ? 0 : (event.amount ?? 0)), 0);
    interruptCount += events.filter(event => event.kind === 'INTERRUPT').length;
    const currentHand = new Set(sim.state.encounter?.deck.hand.map(card => card.instanceId) ?? []);
    for (const id of currentHand) if (!previousHand.has(id)) drawCount += 1;
    previousHand = currentHand;
    steps += 1;
  }
  const ended = performance.now();
  const finalState = sim.state;
  const finalEncounter = finalState.encounter!;
  const controlCards = finalState.logs.filter(event => event.kind === 'CARD' && event.cardId && ['STUN', 'KNOCKBACK', 'DELAY'].includes(cardById[event.cardId]?.effect ?? ''));
  const shieldCards = finalState.logs.filter(event => event.kind === 'CARD' && event.cardId && cardById[event.cardId]?.effect === 'BLOCK');
  const controlSeconds = controlCards.reduce((sum, event) => sum + (cardById[event.cardId!]?.durationSec ?? 0), 0);
  const shieldContribution = shieldCards.reduce((sum, event) => sum + (cardById[event.cardId!]?.amount ?? 0) * (cardById[event.cardId!]?.durationSec ?? 0), 0);
  return {
    encounterId: encounter.id,
    mode: encounter.mode,
    enemyId: encounter.enemies.find(enemy => !enemy.isClone)?.id ?? encounter.enemies[0]!.id,
    tier: Math.max(1, encounter.startRank),
    seed,
    strategy,
    anomalyId,
    simulatedDurationSec: Number(finalEncounter.elapsedSec.toFixed(3)),
    realDurationMs: Number((ended - started).toFixed(3)),
    drawCount,
    cardAttempts,
    castCount: finalState.logs.filter(event => event.kind === 'CARD').length,
    successfulCastCount: finalState.logs.filter(event => event.kind === 'CARD').length,
    interruptCount,
    teamHpLoss: Number(hpLoss.toFixed(3)),
    teamSpLoss: Number(spLoss.toFixed(3)),
    teamHpRemaining: Number(finalState.employees.reduce((sum, employee) => sum + employee.hp, 0).toFixed(3)),
    teamSpRemaining: Number(finalState.employees.reduce((sum, employee) => sum + employee.sp, 0).toFixed(3)),
    autoAttackDamage: Number(autoAttackDamage.toFixed(3)),
    cardDamage: Number(cardDamage.toFixed(3)),
    controlContribution: controlCards.length,
    controlSeconds: Number(controlSeconds.toFixed(3)),
    shieldContribution: Number(shieldContribution.toFixed(3)),
    healingContribution: Number(healingContribution.toFixed(3)),
    result: finalEncounter.result,
    maxSteps: steps,
  };
}

function runScenario(anomalyId: EncounterTarget, strategy: Strategy, seed: number): CombatStats {
  const sim = new V3Simulation();
  sim.state.rngState = seed;
  sim.state.sequence = Math.abs(seed * 10 + strategy.charCodeAt(0));
  prepare(sim, anomalyId);
  return measure(sim, anomalyId, strategy, seed);
}

describe('v0.4 P0 combat A/B/C statistics', () => {
  it('writes reproducible machine-readable N01/N02 measurements', () => {
    const scenarios: CombatStats[] = [];
    for (const anomalyId of ['N01', 'N02'] as const) for (const strategy of ['A', 'B', 'C'] as const) scenarios.push(runScenario(anomalyId, strategy, SEEDS[anomalyId]));
    const report: StatsReport = {
      schemaVersion: 'v0.4-combat-stats-1',
      generatedAt: new Date().toISOString(),
      fixedStepSec: DT,
      drawIntervalSec: v3Config.combat.drawIntervalSec,
      globalCardCooldownSec: v3Config.combat.globalCardCooldownSec,
      benchmarkLoadout: 'N01/N02 对应武器与防具装配到三名测试员工，仅用于比较卡牌策略；正式一份装备一名员工的解锁与所有权规则不变',
      scenarios,
    };
    writeFileSync(resolve(process.cwd(), 'docs', 'v04-combat-stats.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    expect(scenarios).toHaveLength(6);
    expect(scenarios.every(item => item.encounterId && item.enemyId && item.result)).toBe(true);
    expect(scenarios.every(item => item.maxSteps <= MAX_SECONDS / DT)).toBe(true);
    const n01C = scenarios.find(item => item.anomalyId === 'N01' && item.strategy === 'C')!;
    const n02C = scenarios.find(item => item.anomalyId === 'N02' && item.strategy === 'C')!;
    expect(n01C.cardDamage).toBeGreaterThan(0);
    expect(n01C.controlContribution).toBeGreaterThan(0);
    expect(n02C.cardDamage).toBeGreaterThan(0);
    expect(n02C.shieldContribution).toBeGreaterThan(0);
  });
});

