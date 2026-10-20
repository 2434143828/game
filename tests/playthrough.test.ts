import { describe, expect, it } from 'vitest';
import type { AnomalyId, EmployeeId, WorkType } from '../contracts/data-contract';
import { Simulation } from '../src/simulation/engine';
import { send, room, employee } from './helpers';

/** These journeys use only public player commands. No state writes, debug damage, forced breaches,
 * synthetic day snapshots, added money or accelerated work timers are permitted in this file. */
function progressUntil(sim: Simulation, done: () => boolean, timeoutSec = 90, acceptTutorial = false) {
  for (let n = 0; n < timeoutSec / 0.05 && !done(); n++) {
    if (sim.state.tutorialPending) sim.handleTutorial(acceptTutorial);
    if (sim.state.timeScale === 0) sim.setPaused(false);
    sim.step();
    if (sim.state.phase === 'FAILED') throw new Error(`Unexpected failure: ${JSON.stringify(sim.state.logs.slice(-8))}`);
  }
  expect(done(), JSON.stringify(sim.state.logs.slice(-8))).toBe(true);
}
function doWork(sim: Simulation, id: AnomalyId, worker: EmployeeId, type: WorkType, acceptTutorial = false) {
  expect(send(sim, { type: 'ASSIGN_WORK', roomId: id, employeeId: worker, workType: type }).ok).toBe(true);
  progressUntil(sim, () => room(sim, id).work === null, 90, acceptTutorial);
  if (sim.state.tutorialPending) sim.handleTutorial(acceptTutorial);
}
function sendEveryoneHome(sim: Simulation) {
  const ids = sim.state.employees.filter(e => e.status !== 'INCAPACITATED').map(e => e.id);
  expect(send(sim, { type: 'RETREAT', employeeIds: ids }).ok).toBe(true);
  progressUntil(sim, () => sim.state.employees.filter(e => e.status !== 'INCAPACITATED').every(e => e.location.zone === 'SAFE' && e.status === 'IDLE'));
}
function farm(sim: Simulation, target: number) {
  let round = 0;
  while (sim.state.producedToday < target && round < 40) {
    const work: Array<[AnomalyId, EmployeeId]> = [['N01', 'E01'], ['N02', round % 2 === 0 ? 'E02' : 'E03']];
    if (sim.state.day === 3) work.push(['N05', 'E05']);
    for (const [id, employeeId] of work) {
      expect(room(sim, id).mode).toBe('CONTAINED');
      const workType = room(sim, id).pressure >= 55 ? 'SOOTHE' : 'OBSERVE';
      expect(send(sim, { type: 'ASSIGN_WORK', roomId: id, employeeId, workType }).ok).toBe(true);
    }
    progressUntil(sim, () => work.every(([id]) => room(sim, id).work === null));
    round++;
  }
  expect(sim.state.producedToday).toBeGreaterThanOrEqual(target);
}
function buyFullContent(sim: Simulation, ids: AnomalyId[]) {
  for (const anomalyId of ids) {
    for (const item of ['BEHAVIOR', 'COMBAT', 'EQUIPMENT', 'SKILL'] as const) {
      const result = send(sim, { type: 'PURCHASE', anomalyId, item });
      expect(result.ok, `${anomalyId}/${item}, wallet=${sim.state.progress.wallet}`).toBe(true);
    }
  }
}
function suppressAll(sim: Simulation) {
  while (sim.state.enemies.some(e => !e.isClone)) {
    const main = sim.state.enemies.find(e => !e.isClone)!;
    const ids = sim.state.employees.filter(e => e.status !== 'INCAPACITATED' && e.status !== 'PANICKED').map(e => e.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(send(sim, { type: 'SUPPRESS', employeeIds: ids, enemyId: main.id }).ok).toBe(true);
    progressUntil(sim, () => !sim.state.enemies.some(e => e.id === main.id), 90);
  }
}

describe('public-command journeys (no test state mutation)', () => {
  it('M1/G09: four starter employees suppress the normal tutorial breach for free', () => {
    const sim = new Simulation();
    send(sim, { type: 'START_DAY' });
    send(sim, { type: 'MOVE', employeeIds: ['E02', 'E03', 'E04'], point: { x: 154, y: 440 } });
    for (let n = 0; n < 3; n++) doWork(sim, 'N01', 'E01', 'OBSERVE');
    doWork(sim, 'N01', 'E01', 'SOOTHE', true);
    expect(room(sim, 'N01').mode).toBe('BREACHED');
    expect(sim.state.progress.wallet).toBe(94);
    expect(sim.state.producedToday).toBe(44);
    expect(sim.state.employees.every(e => e.weaponId === 'W00')).toBe(true);
    suppressAll(sim);
    expect(sim.state.enemies).toHaveLength(0);
    expect(sim.state.progress.wallet).toBe(94);
    expect(sim.state.producedToday).toBe(44);
    expect(sim.state.employees.every(e => e.status !== 'INCAPACITATED')).toBe(true);
    progressUntil(sim, () => room(sim, 'N01').mode === 'CONTAINED', 11);
    expect(room(sim, 'N01').pressure).toBe(25);
  });

  it('P13: new game completes three days, earns all purchases, equips ten items and uses all five skills', () => {
    const sim = new Simulation();
    const reports: Array<{ day: number; produced: number; wallet: number; time: number }> = [];
    for (const day of [1, 2, 3] as const) {
      expect(sim.state.day).toBe(day);
      expect(send(sim, { type: 'START_DAY' }).ok).toBe(true);
      farm(sim, day === 3 ? 340 : 240);
      sendEveryoneHome(sim);
      if (day === 1) {
        buyFullContent(sim, ['N01', 'N02']);
        send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E01', weaponId: 'W01' });
        send(sim, { type: 'EQUIP_ARMOR', employeeId: 'E01', armorId: 'A01' });
        send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E02', weaponId: 'W02' });
        send(sim, { type: 'EQUIP_ARMOR', employeeId: 'E02', armorId: 'A02' });
        while (room(sim, 'N01').mode === 'CONTAINED') doWork(sim, 'N01', 'E04', 'INTERACT');
        const main = sim.state.enemies.find(e => !e.isClone)!;
        expect(send(sim, { type: 'CAST_SKILL', skillId: 'S01', target: { kind: 'ENEMY', enemyId: main.id } }).ok).toBe(true);
        expect(send(sim, { type: 'CAST_SKILL', skillId: 'S02', target: { kind: 'ENEMY', enemyId: main.id } }).ok).toBe(true);
        suppressAll(sim);
      } else if (day === 2) {
        buyFullContent(sim, ['N03', 'N04']);
        send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E03', weaponId: 'W03' });
        send(sim, { type: 'EQUIP_ARMOR', employeeId: 'E03', armorId: 'A03' });
        send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E04', weaponId: 'W04' });
        send(sim, { type: 'EQUIP_ARMOR', employeeId: 'E04', armorId: 'A04' });
        // Completing interactions honestly produces the link's two simultaneous accidents.
        doWork(sim, 'N03', 'E03', 'INTERACT');
        doWork(sim, 'N03', 'E03', 'INTERACT');
        while (room(sim, 'N04').mode === 'CONTAINED') doWork(sim, 'N04', 'E04', 'INTERACT');
        expect(room(sim, 'N03').mode).toBe('BREACHED');
        expect(sim.state.processedLinkEventIds.size).toBe(1);
        const dog = sim.state.enemies.find(e => e.sourceAnomalyId === 'N03')!;
        expect(send(sim, { type: 'CAST_SKILL', skillId: 'S03', target: { kind: 'POINT', point: { x: dog.location.x, y: 440 } } }).ok).toBe(true);
        expect(send(sim, { type: 'CAST_SKILL', skillId: 'S04', target: { kind: 'GLOBAL' } }).ok).toBe(true);
        suppressAll(sim);
      } else {
        buyFullContent(sim, ['N05']);
        send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E05', weaponId: 'W05' });
        send(sim, { type: 'EQUIP_ARMOR', employeeId: 'E05', armorId: 'A05' });
        doWork(sim, 'N05', 'E05', 'OBSERVE');
        expect(employee(sim, 'E05').sp).toBeLessThan(100);
        expect(send(sim, { type: 'CAST_SKILL', skillId: 'S05', target: { kind: 'POINT', point: { ...employee(sim, 'E05').location } } }).ok).toBe(true);
      }
      reports.push({ day, produced: sim.state.producedToday, wallet: sim.state.progress.wallet, time: sim.state.simulationTimeSec });
      expect(send(sim, { type: 'FINISH_DAY' }).ok).toBe(true);
      expect(sim.state.report?.skillUses).toBeGreaterThanOrEqual(day === 3 ? 1 : 2);
      if (day < 3) expect(sim.nextDay().ok).toBe(true);
      else if (sim.state.phase === 'DAY_REPORT') sim.nextDay();
    }
    expect(sim.state.phase).toBe('COMPLETE');
    expect(sim.state.progress.ownedWeapons).toHaveLength(5);
    expect(sim.state.progress.ownedArmors).toHaveLength(5);
    expect(sim.state.progress.unlockedSkills).toHaveLength(5);
    expect(sim.state.employees.filter(e => e.weaponId !== 'W00')).toHaveLength(5);
    expect(sim.state.employees.filter(e => e.armorId !== 'A00')).toHaveLength(5);
    expect(sim.state.progress.wallet).toBeGreaterThanOrEqual(0);
    expect(reports).toHaveLength(3);
    console.info('NO_CHEAT_THREE_DAY_REPORT', JSON.stringify(reports));
  });
});
