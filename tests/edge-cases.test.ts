import { describe, expect, it } from 'vitest';
import { config, anomalyById, skillById, weaponById } from '../src/data/config';
import { employee, fixture, room, send, ticks } from './helpers';

const layout = config.game.layout;
const dt = config.game.simulation.fixedStepSec;

describe('combat cancellation and safe-room boundary acceptance', () => {
  it('C10: a retreat entered just before the employee hit tick cancels the unhit attack permanently', () => {
    const sim = fixture();
    sim.forceBreach('N02');
    const enemy = sim.state.enemies[0]!;
    const worker = employee(sim);
    worker.location = { ...enemy.location };
    expect(send(sim, { type: 'SUPPRESS', employeeIds: [worker.id], enemyId: enemy.id }).ok).toBe(true);
    sim.step();
    const weapon = weaponById[worker.weaponId];
    ticks(sim, weapon.windupSec - dt);
    expect(worker.windupEndsAtSec).not.toBeNull();
    const hp = enemy.suppressionHp;
    expect(send(sim, { type: 'RETREAT', employeeIds: [worker.id] }).ok).toBe(true);
    sim.step();
    expect(enemy.suppressionHp).toBe(hp);
    expect(worker.windupEndsAtSec).toBeNull();
    ticks(sim, weapon.attackPeriodSec * 2);
    expect(enemy.suppressionHp).toBe(hp);
    expect(worker.order.kind).toBe('RETREAT');
  });

  it('C10: replacing suppression with a room reservation cancels employee windup and never hits during travel', () => {
    const sim = fixture();
    sim.forceBreach('N02');
    const target = sim.state.enemies[0]!;
    const worker = employee(sim);
    worker.location = { ...target.location };
    send(sim, { type: 'SUPPRESS', employeeIds: [worker.id], enemyId: target.id });
    sim.step();
    expect(worker.windupEndsAtSec).not.toBeNull();
    const hp = target.suppressionHp;
    expect(send(sim, { type: 'ASSIGN_WORK', employeeId: worker.id, roomId: 'N01', workType: 'OBSERVE' }).ok).toBe(true);
    ticks(sim, weaponById[worker.weaponId].windupSec + dt);
    expect(target.suppressionHp).toBe(hp);
    expect(worker.windupEndsAtSec).toBeNull();
    expect(room(sim, 'N01').work?.employeeId).toBe(worker.id);
  });

  it('C14: a chase attack whose target leaves the corridor cannot redirect its existing windup to another employee', () => {
    const sim = fixture();
    sim.forceBreach('N02');
    const enemy = sim.state.enemies[0]!;
    enemy.location = { ...layout.safeEntrance, zone: 'CORRIDOR' };
    employee(sim).location = { ...layout.safeEntrance, zone: 'CORRIDOR' };
    employee(sim, 'E02').location = { x: layout.safeEntrance.x - 10, y: layout.corridorY, zone: 'CORRIDOR' };
    ticks(sim, anomalyById.N02.breach.firstAttackDelaySec);
    expect(enemy.targetEmployeeId).toBe('E01');
    expect(enemy.windupEndsAtSec).not.toBeNull();
    expect(send(sim, { type: 'RETREAT', employeeIds: ['E01'] }).ok).toBe(true);
    ticks(sim, anomalyById.N02.breach.windupSec);
    expect(employee(sim).location.zone).toBe('SAFE_CONNECTOR');
    expect(employee(sim).hp).toBe(config.game.employee.hpMax);
    expect(employee(sim, 'E02').hp).toBe(config.game.employee.hpMax);
    expect(enemy.windupEndsAtSec).toBeNull();
  });

  it('C15: protection begins only on the exact safe-node arrival, not during the final partial step', () => {
    const sim = fixture(2);
    sim.forceBreach('N04');
    const broadcaster = sim.state.enemies.find(e => e.sourceAnomalyId === 'N04')!;
    const worker = employee(sim);
    worker.location = { x: layout.safeCenter.x, y: layout.safeCenter.y - config.game.employee.moveSpeedPxPerSec * dt - 0.1, zone: 'SAFE_CONNECTOR' };
    expect(send(sim, { type: 'RETREAT', employeeIds: [worker.id] }).ok).toBe(true);
    broadcaster.attackPhase = 'WINDUP';
    broadcaster.windupEndsAtSec = sim.state.simulationTimeSec + dt;
    sim.step();
    expect(worker.location.zone).toBe('SAFE_CONNECTOR');
    expect(worker.hp).toBe(96);
    expect(worker.sp).toBe(96);
    broadcaster.attackPhase = 'WINDUP';
    broadcaster.windupEndsAtSec = sim.state.simulationTimeSec + dt;
    sim.step();
    expect(worker.location.zone).toBe('SAFE');
    expect(worker.hp).toBe(96);
    expect(worker.sp).toBe(96);
    expect(worker.safeStayElapsedSec).toBe(0);
  });

  it('C16/S07: restored panic keeps the existing retreat path until arrival and can be overridden after recovery', () => {
    const sim = fixture(3);
    const worker = employee(sim);
    worker.location = { x: layout.roomCentersX[0]!, y: layout.corridorY, zone: 'CORRIDOR' };
    sim.damageEmployee(worker.id, { type: 'WHITE', kind: 'FLAT', amount: worker.spMax });
    ticks(sim, 0.5);
    const x = worker.location.x;
    const remainingPath = structuredClone(worker.path);
    sim.state.progress.unlockedSkills = ['S05'];
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S05', target: { kind: 'POINT', point: { x, y: layout.corridorY } } }).ok).toBe(true);
    expect(worker.status).toBe('MOVING');
    expect(worker.order.kind).toBe('RETREAT');
    expect(worker.path).toEqual(remainingPath);
    ticks(sim, 0.5);
    expect(worker.location.x).toBeGreaterThan(x);
    expect(send(sim, { type: 'MOVE', employeeIds: [worker.id], point: { x: layout.roomCentersX[0]!, y: layout.corridorY } }).ok).toBe(true);
    ticks(sim, 0.5);
    expect(worker.location.x).toBeLessThanOrEqual(x);
    expect(worker.sp).toBe(35);
  });

  it('C13: suppressing a main in the exact enemy-hit tick discards its clones and all their pending damage', () => {
    const sim = fixture();
    sim.forceBreach('N01');
    const main = sim.state.enemies.find(e => !e.isClone)!;
    const worker = employee(sim);
    worker.location = { ...main.location };
    send(sim, { type: 'SUPPRESS', employeeIds: [worker.id], enemyId: main.id });
    sim.step();
    main.suppressionHp = 1;
    worker.windupEndsAtSec = sim.state.simulationTimeSec + dt;
    for (const enemy of sim.state.enemies) {
      enemy.targetEmployeeId = worker.id;
      enemy.attackPhase = 'WINDUP';
      enemy.windupEndsAtSec = sim.state.simulationTimeSec + dt;
    }
    const energy = { wallet: sim.state.progress.wallet, produced: sim.state.producedToday };
    sim.step();
    expect(sim.state.enemies).toHaveLength(0);
    expect(worker.sp).toBe(config.game.employee.spMax);
    expect(worker.order.kind).toBe('IDLE');
    expect(worker.windupEndsAtSec).toBeNull();
    expect(room(sim, 'N01').mode).toBe('RECOVERING');
    expect(sim.state.progress.wallet).toBe(energy.wallet);
    expect(sim.state.producedToday).toBe(energy.produced);
  });

  it('G11/P01: total incapacitation clears telegraphs and work, then freezes every simulation subsystem', () => {
    const sim = fixture(2);
    sim.forceBreach('N03');
    const dog = sim.state.enemies[0]!;
    dog.attackPhase = 'WINDUP';
    dog.windupEndsAtSec = sim.state.simulationTimeSec + 1;
    dog.pendingForcedHowl = true;
    expect(send(sim, { type: 'ASSIGN_WORK', employeeId: 'E01', roomId: 'N01', workType: 'OBSERVE' }).ok).toBe(true);
    sim.state.skillCooldownRemainingSec.S01 = 10;
    for (const worker of sim.state.employees) sim.damageEmployee(worker.id, { type: 'RED', kind: 'FLAT', amount: worker.hpMax });
    sim.step();
    expect(sim.state.phase).toBe('FAILED');
    expect(sim.state.rooms.every(r => r.work === null)).toBe(true);
    expect(dog.windupEndsAtSec).toBeNull();
    expect(dog.pendingForcedHowl).toBe(false);
    const frozen = JSON.stringify(sim.state);
    ticks(sim, 20);
    sim.advance(100);
    expect(JSON.stringify(sim.state)).toBe(frozen);
  });
});

describe('link and control timing boundaries', () => {
  it.each(['LOCKED', 'RECOVERING'] as const)('S09: the one directed link ignores a %s target without changing its lifecycle', mode => {
    const sim = fixture(2);
    const dogRoom = room(sim, 'N03');
    if (mode === 'RECOVERING') {
      sim.forceBreach('N03');
      sim.damageEnemy(dogRoom.mainEnemyId!, { type: 'RED', kind: 'FLAT', amount: 999 });
    } else dogRoom.mode = 'LOCKED';
    const before = structuredClone(dogRoom);
    sim.forceBreach('N04');
    expect(dogRoom).toEqual(before);
    expect(sim.state.enemies.some(e => e.sourceAnomalyId === 'N03')).toBe(false);
    expect(sim.state.processedLinkEventIds.size).toBe(1);
    expect(sim.state.logs.some(log => log.kind === 'LINK' && log.message.includes('忽略联动'))).toBe(true);
  });

  it('S03: normal attacks wait a full period after stun ends, then still play the full windup', () => {
    const sim = fixture();
    sim.forceBreach('N02');
    const enemy = sim.state.enemies[0]!;
    const worker = employee(sim);
    worker.location = { ...enemy.location };
    sim.state.progress.unlockedSkills = ['S01'];
    const stun = skillById.S01;
    if (stun.effect !== 'STUN') throw new Error('S01 should be the stun skill');
    const period = anomalyById.N02.breach.attackPeriodSec;
    const windup = anomalyById.N02.breach.windupSec;
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S01', target: { kind: 'ENEMY', enemyId: enemy.id } }).ok).toBe(true);
    ticks(sim, stun.durationSec + period - dt);
    expect(enemy.windupEndsAtSec).toBeNull();
    expect(worker.hp).toBe(100);
    sim.step();
    expect(enemy.attackPhase).toBe('WINDUP');
    expect(enemy.windupEndsAtSec! - sim.state.simulationTimeSec).toBeCloseTo(windup, 6);
    ticks(sim, windup - dt);
    expect(worker.hp).toBe(100);
    sim.step();
    expect(worker.hp).toBe(90);
  });

  it('S12: a queued forced howl bypasses the post-control normal period but never bypasses its telegraph', () => {
    const sim = fixture(2);
    sim.forceBreach('N03');
    const dog = sim.state.enemies[0]!;
    const worker = employee(sim);
    worker.location = { ...dog.location };
    sim.state.progress.unlockedSkills = ['S01'];
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S01', target: { kind: 'ENEMY', enemyId: dog.id } }).ok).toBe(true);
    sim.forceBreach('N04');
    const stunEnd = dog.stunnedUntilSec;
    ticks(sim, stunEnd - dt);
    expect(dog.windupEndsAtSec).toBeNull();
    sim.step();
    expect(dog.pendingForcedHowl).toBe(false);
    expect(dog.windupEndsAtSec! - sim.state.simulationTimeSec).toBeCloseTo(anomalyById.N03.breach.windupSec, 6);
    ticks(sim, anomalyById.N03.breach.windupSec - dt);
    expect(worker.hp).toBe(100);
    sim.step();
    expect(worker.hp).toBe(86);
    expect(dog.windupEndsAtSec).toBeNull();
    expect(dog.nextAttackStartAtSec).toBeCloseTo(stunEnd + anomalyById.N03.breach.attackPeriodSec, 6);
  });
});
