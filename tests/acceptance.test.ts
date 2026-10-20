import { describe, expect, it } from 'vitest';
import type { AnomalyId, Command } from '../contracts/data-contract';
import { Simulation } from '../src/simulation/engine';
import { send, room, employee, ticks, fixture, workAtPosition, completeWork } from './helpers';

describe('work transactions and five distinct rules', () => {
  it('W06: a broadcast landing in the completion tick interrupts before hazard and income, once', () => {
    const sim = fixture(2);
    sim.forceBreach('N04');
    workAtPosition(sim, 'N01', 'OBSERVE');
    room(sim, 'N01').work!.elapsedSec = 23.95;
    const enemy = sim.state.enemies.find(e => e.sourceAnomalyId === 'N04')!;
    enemy.attackPhase = 'WINDUP';
    enemy.windupEndsAtSec = sim.state.simulationTimeSec + 0.05;
    sim.step();
    expect(room(sim, 'N01').work).toBeNull();
    expect(room(sim, 'N01').pressure).toBe(28);
    expect(sim.state.producedToday).toBe(0);
    expect(employee(sim).hp).toBe(96);
    expect(employee(sim).sp).toBe(96);
  });

  it('W07: N04 completion and linked N03 failure settle before either candidate income', () => {
    const sim = fixture(2);
    workAtPosition(sim, 'N03', 'OBSERVE');
    workAtPosition(sim, 'N04', 'OBSERVE', 'E02');
    room(sim, 'N03').pressure = 60;
    room(sim, 'N04').pressure = 95;
    room(sim, 'N03').work!.elapsedSec = 25.95;
    room(sim, 'N04').work!.elapsedSec = 25.95;
    sim.step();
    expect(room(sim, 'N03').mode).toBe('BREACHED');
    expect(room(sim, 'N04').mode).toBe('BREACHED');
    expect(sim.state.producedToday).toBe(0);
    expect(sim.state.progress.wallet).toBe(50);
    expect(sim.state.processedLinkEventIds.size).toBe(1);
    expect(sim.state.enemies.find(e => e.sourceAnomalyId === 'N03')!.pendingForcedHowl).toBe(false);
  });

  it.each([['N01', 'sp'], ['N02', 'hp']] as const)('W08: lethal %s completion uses only emergency pressure', (id, stat) => {
    const sim = fixture();
    employee(sim)[stat] = 2;
    const initial = room(sim, id).pressure;
    completeWork(sim, id, 'OBSERVE');
    expect(sim.state.producedToday).toBe(0);
    expect(room(sim, id).pressure).toBe(initial + 8);
    expect(room(sim, id).memory.lastCompletedWorkType).toBeNull();
    expect(room(sim, id).work).toBeNull();
  });

  it('W09: N01-N04 never receive a hidden idle-pressure penalty', () => {
    const sim = fixture(2);
    const before = sim.state.rooms.map(r => r.pressure);
    ticks(sim, 200);
    expect(sim.state.rooms.map(r => r.pressure)).toEqual(before);
  });

  it('W11: N01 repeat interaction adds 15; a completed soothe breaks the streak', () => {
    const sim = fixture();
    completeWork(sim, 'N01', 'INTERACT');
    expect(room(sim, 'N01').pressure).toBe(45);
    completeWork(sim, 'N01', 'INTERACT');
    expect(room(sim, 'N01').pressure).toBe(85);
    completeWork(sim, 'N01', 'SOOTHE');
    completeWork(sim, 'N01', 'INTERACT');
    expect(room(sim, 'N01').pressure).toBe(90);
  });

  it('W12: N02 repeat-worker penalty respects rotation and twenty actual idle seconds', () => {
    const sim = fixture();
    completeWork(sim, 'N02', 'OBSERVE');
    expect(room(sim, 'N02').pressure).toBe(30);
    completeWork(sim, 'N02', 'OBSERVE');
    expect(room(sim, 'N02').pressure).toBe(50);
    completeWork(sim, 'N02', 'OBSERVE', 'E02');
    expect(room(sim, 'N02').pressure).toBe(55);
    ticks(sim, 20);
    expect(room(sim, 'N02').memory.lastCompletedEmployeeId).toBeNull();
    completeWork(sim, 'N02', 'OBSERVE', 'E02');
    expect(room(sim, 'N02').pressure).toBe(60);
  });

  it.each([[7, 35], [8, 25]])('W13: N03 locks an actual-start gap of %s seconds', (gap, pressure) => {
    const sim = fixture(2);
    ticks(sim, 10);
    room(sim, 'N03').memory.lastCompletedAtSec = sim.state.simulationTimeSec - gap;
    completeWork(sim, 'N03', 'OBSERVE');
    expect(room(sim, 'N03').pressure).toBe(pressure);
  });

  it('W13: an immediate work order arriving after eight seconds does not inherit a false rapid-start flag', () => {
    const sim = fixture(2);
    room(sim, 'N03').memory.lastCompletedAtSec = 0;
    expect(send(sim, { type: 'ASSIGN_WORK', roomId: 'N03', employeeId: 'E01', workType: 'OBSERVE' }).ok).toBe(true);
    for (let n = 0; n < 400 && room(sim, 'N03').work?.phase !== 'EXECUTING'; n++) sim.step();
    expect(sim.state.simulationTimeSec).toBeGreaterThanOrEqual(8);
    expect(room(sim, 'N03').work?.rapidRestart).toBe(false);
    ticks(sim, 26);
    expect(room(sim, 'N03').pressure).toBe(25);
  });

  it('W14: N04 third non-soothe completion triggers once and soothe clears the count', () => {
    const sim = fixture(2);
    for (let n = 0; n < 3; n++) completeWork(sim, 'N04', 'OBSERVE');
    expect(room(sim, 'N04').pressure).toBe(55);
    expect(room(sim, 'N04').memory.nonSootheCount).toBe(0);
    completeWork(sim, 'N04', 'OBSERVE');
    completeWork(sim, 'N04', 'SOOTHE');
    expect(room(sim, 'N04').memory.nonSootheCount).toBe(0);
  });

  it('W15/W16: N05 crosses grace precisely, freezes during work, and cannot reset by cancelling', () => {
    const sim = fixture(3);
    ticks(sim, 35);
    expect(room(sim, 'N05').pressure).toBeCloseTo(25, 6);
    workAtPosition(sim, 'N05', 'OBSERVE');
    const idle = room(sim, 'N05').memory.idleElapsedSec;
    ticks(sim, 5);
    expect(room(sim, 'N05').memory.idleElapsedSec).toBeCloseTo(idle, 6);
    expect(send(sim, { type: 'RETREAT', employeeIds: ['E01'] }).ok).toBe(true);
    expect(room(sim, 'N05').memory.idleElapsedSec).toBeCloseTo(idle, 6);
    ticks(sim, 1);
    expect(room(sim, 'N05').memory.idleElapsedSec).toBeCloseTo(idle + 1, 6);
    completeWork(sim, 'N05', 'OBSERVE');
    expect(room(sim, 'N05').memory.idleElapsedSec).toBeLessThanOrEqual(0.051);
  });

  it('W17: N05 stays idle-zero while locked or recovering, and recovers cleanly', () => {
    const locked = fixture(2);
    ticks(locked, 60);
    expect(room(locked, 'N05').memory.idleElapsedSec).toBe(0);
    const sim = fixture(3);
    ticks(sim, 35);
    sim.forceBreach('N05');
    sim.damageEnemy(room(sim, 'N05').mainEnemyId!, { type: 'RED', kind: 'FLAT', amount: 999 });
    ticks(sim, 10);
    expect(room(sim, 'N05').mode).toBe('CONTAINED');
    expect(room(sim, 'N05').memory.idleElapsedSec).toBe(0);
    expect(room(sim, 'N05').pressure).toBe(25);
  });

  it('W16: N05 pressure-failed completion still resets the completed-process idle memory', () => {
    const sim = fixture(3);
    ticks(sim, 35);
    room(sim, 'N05').pressure = 97;
    completeWork(sim, 'N05', 'OBSERVE');
    expect(room(sim, 'N05').mode).toBe('BREACHED');
    expect(sim.state.producedToday).toBe(0);
    expect(room(sim, 'N05').memory.idleElapsedSec).toBe(0);
  });
});

describe('employee state, combat lifecycle and loadouts', () => {
  it('C07/C08/C09: armor changes real damage, unique equipment transfers atomically and combat locks both holders', () => {
    const sim = new Simulation();
    sim.state.progress.wallet = 200;
    expect(send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'BEHAVIOR' }).ok).toBe(true);
    expect(send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'EQUIPMENT' }).ok).toBe(true);
    expect(send(sim, { type: 'EQUIP_ARMOR', employeeId: 'E01', armorId: 'A01' }).ok).toBe(true);
    sim.damageEmployee('E01', { type: 'WHITE', kind: 'FLAT', amount: 10 });
    expect(employee(sim).sp).toBe(94);
    expect(send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E01', weaponId: 'W01' }).ok).toBe(true);
    expect(send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E02', weaponId: 'W01' }).ok).toBe(true);
    expect(employee(sim).weaponId).toBe('W00');
    expect(employee(sim, 'E02').weaponId).toBe('W01');
    send(sim, { type: 'START_DAY' });
    employee(sim, 'E02').location = { x: 154, y: 440, zone: 'CORRIDOR' };
    expect(send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E01', weaponId: 'W01' }).ok).toBe(false);
    expect(employee(sim, 'E02').weaponId).toBe('W01');
    expect(send(sim, { type: 'EQUIP_ARMOR', employeeId: 'E02', armorId: 'A01' }).ok).toBe(false);
  });

  it('C10/C11: retreat cancels an unhit attack and losing a target never retargets a clone', () => {
    const sim = fixture();
    sim.forceBreach('N01');
    const main = sim.state.enemies.find(e => !e.isClone)!;
    employee(sim).location = { x: 154, y: 440, zone: 'CORRIDOR' };
    expect(send(sim, { type: 'SUPPRESS', employeeIds: ['E01'], enemyId: main.id }).ok).toBe(true);
    sim.step();
    expect(employee(sim).windupEndsAtSec).not.toBeNull();
    const hp = main.suppressionHp;
    expect(send(sim, { type: 'RETREAT', employeeIds: ['E01'] }).ok).toBe(true);
    ticks(sim, 0.5);
    expect(main.suppressionHp).toBe(hp);
    expect(employee(sim).order.kind).toBe('RETREAT');
    const clone = sim.state.enemies.find(e => e.isClone)!;
    send(sim, { type: 'SUPPRESS', employeeIds: ['E02'], enemyId: clone.id });
    sim.damageEnemy(clone.id, { type: 'RED', kind: 'FLAT', amount: 999 });
    expect(employee(sim, 'E02').order.kind).toBe('IDLE');
    expect(sim.state.enemies).toHaveLength(2);
  });

  it.each(['N03', 'N05'] as AnomalyId[])('C14: %s checks actual hit position after its telegraph', id => {
    const sim = fixture(3);
    sim.forceBreach(id);
    const enemy = sim.state.enemies.find(e => e.sourceAnomalyId === id)!;
    enemy.location.x = 574;
    enemy.attackPhase = 'WINDUP';
    enemy.windupEndsAtSec = sim.state.simulationTimeSec + 1;
    employee(sim).location = { x: 724, y: 440, zone: 'CORRIDOR' };
    send(sim, { type: 'MOVE', employeeIds: ['E01'], point: { x: 1000, y: 440 } });
    ticks(sim, 1.05);
    expect(employee(sim).hp).toBe(100);
  });

  it('C15: broadcasting spares the safe node but hits the unfinished safe connector', () => {
    const sim = fixture(2);
    employee(sim, 'E02').location = { x: 1190, y: 500, zone: 'SAFE_CONNECTOR' };
    sim.forceBreach('N04');
    ticks(sim, 5.5);
    expect(employee(sim).hp).toBe(100);
    expect(employee(sim).sp).toBe(100);
    expect(employee(sim, 'E02').hp).toBe(96);
    expect(employee(sim, 'E02').sp).toBe(96);
  });

  it('G11/C16: panic retreats without failing; simultaneous zero health takes incapacitation priority', () => {
    const sim = fixture();
    for (const e of sim.state.employees) {
      e.location = { x: 900, y: 440, zone: 'CORRIDOR' };
      sim.damageEmployee(e.id, { type: 'WHITE', kind: 'FLAT', amount: 100 });
    }
    expect(sim.state.employees.every(e => e.status === 'PANICKED')).toBe(true);
    sim.step();
    expect(sim.state.phase).toBe('RUNNING');
    for (const e of sim.state.employees) sim.damageEmployee(e.id, { type: 'BLACK', kind: 'FLAT', amount: 100 });
    sim.step();
    expect(sim.state.employees.every(e => e.status === 'INCAPACITATED')).toBe(true);
    expect(sim.state.phase).toBe('FAILED');
  });

  it('C17: safety recovery waits three seconds, heals rates exactly, and resets on departure', () => {
    const sim = fixture();
    employee(sim).hp = 40;
    employee(sim).sp = 40;
    ticks(sim, 3);
    expect(employee(sim).hp).toBeCloseTo(40, 6);
    expect(employee(sim).sp).toBeCloseTo(40, 6);
    ticks(sim, 2);
    expect(employee(sim).hp).toBeCloseTo(50, 6);
    expect(employee(sim).sp).toBeCloseTo(56, 6);
    send(sim, { type: 'MOVE', employeeIds: ['E01'], point: { x: 1190, y: 440 } });
    ticks(sim, 0.1);
    expect(employee(sim).safeStayElapsedSec).toBe(0);
  });

  it('C10: enemy attack period measures start-to-start and spawn grace prevents instant damage', () => {
    const sim = fixture();
    employee(sim).location = { x: 364, y: 440, zone: 'CORRIDOR' };
    sim.forceBreach('N02');
    ticks(sim, 1.7);
    expect(employee(sim).hp).toBe(100);
    ticks(sim, 0.05);
    expect(employee(sim).hp).toBe(90);
    ticks(sim, 0.85);
    expect(employee(sim).hp).toBe(90);
    ticks(sim, 0.05);
    expect(employee(sim).hp).toBe(80);
  });
});

describe('atomic purchases, skills and the unique link', () => {
  function skillFixture() {
    const sim = fixture(3);
    sim.state.progress.wallet = 500;
    sim.state.progress.unlockedSkills = ['S01', 'S02', 'S03', 'S04', 'S05'];
    return sim;
  }

  it('G04/S01: purchase prerequisites, locked source and duplicate purchase never partly commit', () => {
    const sim = new Simulation();
    expect(send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'EQUIPMENT' }).ok).toBe(false);
    expect(send(sim, { type: 'PURCHASE', anomalyId: 'N03', item: 'SKILL' }).ok).toBe(false);
    expect(send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'SKILL' }).ok).toBe(true);
    expect(sim.state.progress.wallet).toBe(15);
    expect(sim.state.progress.unlockedSkills).toEqual(['S01']);
    expect(send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'SKILL' }).ok).toBe(false);
    expect(send(sim, { type: 'PURCHASE', anomalyId: 'N02', item: 'SKILL' }).ok).toBe(false);
    expect(sim.state.progress.wallet).toBe(15);
    expect(sim.state.progress.research.N01.behavior).toBe(false);
  });

  it('S02: absent enemies, empty/off-map areas, insufficient funds and cooldown are rejected without effects', () => {
    const sim = skillFixture();
    const invalid: Command[] = [
      { commandId: 'missing', type: 'CAST_SKILL', skillId: 'S01', target: { kind: 'ENEMY', enemyId: 'gone' } },
      { commandId: 'empty', type: 'CAST_SKILL', skillId: 'S03', target: { kind: 'POINT', point: { x: 154, y: 440 } } },
      { commandId: 'offmap', type: 'CAST_SKILL', skillId: 'S05', target: { kind: 'POINT', point: { x: -100, y: -100 } } },
      { commandId: 'full', type: 'CAST_SKILL', skillId: 'S05', target: { kind: 'POINT', point: { x: 1190, y: 600 } } },
    ];
    for (const cmd of invalid) expect(sim.command(cmd).ok).toBe(false);
    expect(sim.state.progress.wallet).toBe(500);
    expect(Object.values(sim.state.skillCooldownRemainingSec)).toEqual([0, 0, 0, 0, 0]);
    sim.state.progress.wallet = 0;
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S04', target: { kind: 'GLOBAL' } }).ok).toBe(false);
    expect(employee(sim).moveBuffRemainingSec).toBe(0);
  });

  it('S03/S08: paused stun is immediate, cancels windup, freezes all timers and deduplicates input', () => {
    const sim = skillFixture();
    sim.forceBreach('N02');
    const enemy = sim.state.enemies[0]!;
    enemy.attackPhase = 'WINDUP';
    enemy.windupEndsAtSec = sim.state.simulationTimeSec + 0.2;
    sim.setPaused(true);
    const cast: Command = { commandId: 'same-cast', type: 'CAST_SKILL', skillId: 'S01', target: { kind: 'ENEMY', enemyId: enemy.id } };
    expect(sim.command(cast).ok).toBe(true);
    sim.command(cast);
    expect(sim.state.progress.wallet).toBe(490);
    expect(enemy.windupEndsAtSec).toBeNull();
    expect(enemy.stunnedUntilSec - sim.state.simulationTimeSec).toBe(4);
    expect(sim.state.skillCooldownRemainingSec.S01).toBe(24);
    sim.advance(10);
    expect(enemy.stunnedUntilSec - sim.state.simulationTimeSec).toBe(4);
    expect(sim.state.skillCooldownRemainingSec.S01).toBe(24);
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S01', target: { kind: 'ENEMY', enemyId: enemy.id } }).ok).toBe(false);
    expect(sim.state.progress.wallet).toBe(490);
  });

  it('S04: rage uses target resistance without needing source gear', () => {
    const sim = skillFixture();
    sim.forceBreach('N02');
    const enemy = sim.state.enemies[0]!;
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S02', target: { kind: 'ENEMY', enemyId: enemy.id } }).ok).toBe(true);
    expect(enemy.suppressionHp).toBeCloseTo(137.6, 6);
    expect(sim.state.progress.wallet).toBe(488);
    expect(sim.state.skillCooldownRemainingSec.S02).toBe(18);
  });

  it('S03: after stun ends, a normal attacker waits a complete start period before a fresh windup', () => {
    const sim = skillFixture();
    employee(sim).location = { x: 364, y: 440, zone: 'CORRIDOR' };
    sim.forceBreach('N02');
    const enemy = sim.state.enemies[0]!;
    send(sim, { type: 'CAST_SKILL', skillId: 'S01', target: { kind: 'ENEMY', enemyId: enemy.id } });
    ticks(sim, 4.85);
    expect(enemy.windupEndsAtSec).toBeNull();
    expect(employee(sim).hp).toBe(100);
    ticks(sim, 0.05);
    expect(enemy.windupEndsAtSec).toBeCloseTo(5.15, 6);
    ticks(sim, 0.25);
    expect(employee(sim).hp).toBe(90);
  });

  it('S05: area attack damages each enemy once, pushes outward with a rightward tie and cancels telegraphs', () => {
    const sim = skillFixture();
    sim.forceBreach('N01');
    const positions = [154, 100, 220];
    sim.state.enemies.forEach((e, index) => {
      e.location.x = positions[index]!;
      e.attackPhase = 'WINDUP';
      e.windupEndsAtSec = 10;
    });
    employee(sim).location = { x: 154, y: 440, zone: 'CORRIDOR' };
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S03', target: { kind: 'POINT', point: { x: 154, y: 440 } } }).ok).toBe(true);
    expect(sim.state.enemies.map(e => e.location.x)).toEqual([314, 54, 380]);
    expect(sim.state.enemies.map(e => e.suppressionHp)).toEqual([172, 27, 27]);
    expect(sim.state.enemies.every(e => e.windupEndsAtSec === null)).toBe(true);
    expect(employee(sim).hp).toBe(100);
  });

  it('S06: notification speeds panicked retreat to 165 px/sec without accelerating work timers', () => {
    const sim = skillFixture();
    employee(sim).location = { x: 700, y: 440, zone: 'CORRIDOR' };
    sim.damageEmployee('E01', { type: 'WHITE', kind: 'FLAT', amount: 100 });
    workAtPosition(sim, 'N03', 'OBSERVE', 'E02');
    const elapsed = room(sim, 'N03').work!.elapsedSec;
    const x = employee(sim).location.x;
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S04', target: { kind: 'GLOBAL' } }).ok).toBe(true);
    ticks(sim, 1);
    expect(employee(sim).location.x - x).toBeCloseTo(165, 6);
    expect(room(sim, 'N03').work!.elapsedSec - elapsed).toBeCloseTo(1, 6);
    expect(employee(sim).moveBuffRemainingSec).toBeCloseTo(7, 6);
  });

  it('G03/S07: restoration recovers panic at 35 SP, never life/revival and never quota progress', () => {
    const sim = skillFixture();
    sim.state.progress.wallet = 80;
    sim.state.producedToday = 340;
    for (const e of sim.state.employees) e.location = { x: 700, y: 440, zone: 'CORRIDOR' };
    sim.damageEmployee('E01', { type: 'WHITE', kind: 'FLAT', amount: 100 });
    employee(sim).hp = 40;
    sim.damageEmployee('E02', { type: 'BLACK', kind: 'FLAT', amount: 100 });
    employee(sim, 'E03').sp = 90;
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S05', target: { kind: 'POINT', point: { x: 700, y: 440 } } }).ok).toBe(true);
    expect(employee(sim).sp).toBe(35);
    expect(employee(sim).status).not.toBe('PANICKED');
    expect(employee(sim).hp).toBe(40);
    expect(employee(sim, 'E02').status).toBe('INCAPACITATED');
    expect(employee(sim, 'E03').sp).toBe(100);
    expect(sim.state.progress.wallet).toBe(64);
    expect(sim.state.producedToday).toBe(340);
    expect(send(sim, { type: 'FINISH_DAY' }).ok).toBe(true);
  });

  it('S09/S10/S13: N04 enter emits one link, repeated broadcasts never emit links, and N03 has no reverse link', () => {
    const sim = fixture(2);
    room(sim, 'N03').pressure = 65;
    sim.forceBreach('N04');
    expect(room(sim, 'N03').mode).toBe('BREACHED');
    expect(sim.state.processedLinkEventIds.size).toBe(1);
    ticks(sim, 110);
    expect(sim.state.processedLinkEventIds.size).toBe(1);
    const reverse = fixture(2);
    sim.forceBreach('N04');
    reverse.forceBreach('N03');
    expect(room(reverse, 'N04').pressure).toBe(20);
    expect(room(reverse, 'N04').mode).toBe('CONTAINED');
  });

  it('S11/S12: a link never duplicates a windup; controlled dog queues only one full telegraph', () => {
    const sim = skillFixture();
    sim.forceBreach('N03');
    const dog = sim.state.enemies.find(e => e.sourceAnomalyId === 'N03')!;
    dog.attackPhase = 'WINDUP';
    dog.windupEndsAtSec = 1;
    sim.forceBreach('N04');
    expect(dog.windupEndsAtSec).toBe(1);
    expect(dog.pendingForcedHowl).toBe(false);

    const held = skillFixture();
    held.forceBreach('N03');
    const heldDog = held.state.enemies.find(e => e.sourceAnomalyId === 'N03')!;
    send(held, { type: 'CAST_SKILL', skillId: 'S01', target: { kind: 'ENEMY', enemyId: heldDog.id } });
    held.forceBreach('N04');
    expect(heldDog.pendingForcedHowl).toBe(true);
    employee(held).location = { x: heldDog.location.x, y: 440, zone: 'CORRIDOR' };
    ticks(held, 3.95);
    expect(heldDog.windupEndsAtSec).toBeNull();
    ticks(held, 0.1);
    expect(heldDog.windupEndsAtSec).not.toBeNull();
    expect(heldDog.windupEndsAtSec! - held.state.simulationTimeSec).toBeGreaterThan(1.1);
    expect(employee(held).hp).toBe(100);
  });
});

describe('clock, day boundaries and snapshots', () => {
  it('G07: reporting cancels both executing and travelling jobs without late income', () => {
    const sim = fixture(2);
    workAtPosition(sim, 'N01', 'OBSERVE');
    send(sim, { type: 'ASSIGN_WORK', employeeId: 'E02', roomId: 'N02', workType: 'OBSERVE' });
    expect(room(sim, 'N01').work?.phase).toBe('EXECUTING');
    expect(room(sim, 'N02').work?.phase).toBe('TRAVELLING');
    sim.state.producedToday = 240;
    expect(send(sim, { type: 'FINISH_DAY' }).ok).toBe(true);
    ticks(sim, 100);
    expect(sim.state.progress.wallet).toBe(50);
    expect(sim.state.producedToday).toBe(240);
    expect(sim.state.rooms.every(r => r.work === null)).toBe(true);
  });

  it('P02/P03: 30/60/144 fps and 1x/2x create the same state at equal simulation duration', () => {
    const results = [30, 60, 144].flatMap(fps => [1, 2].map(speed => {
      const sim = fixture();
      sim.setSpeed(speed as 1 | 2);
      send(sim, { type: 'ASSIGN_WORK', employeeId: 'E01', roomId: 'N01', workType: 'OBSERVE' });
      for (let n = 0; n < 40 * fps / speed; n++) sim.advance(1 / fps);
      return {
        produced: sim.state.producedToday,
        hp: employee(sim).hp, sp: employee(sim).sp,
        pressure: room(sim, 'N01').pressure,
        time: sim.state.simulationTimeSec,
        x: employee(sim).location.x, y: employee(sim).location.y,
      };
    }));
    for (const result of results) expect(result).toEqual(results[0]);
    expect(results[0]!.time).toBeCloseTo(40, 6);
    expect(results[0]!.produced).toBe(12);
  });

  it('P01: a slow frame is capped at five ticks and discarded time cannot reappear next frame', () => {
    const sim = fixture();
    sim.advance(20);
    expect(sim.state.simulationTimeSec).toBeCloseTo(0.25, 6);
    sim.advance(0);
    expect(sim.state.simulationTimeSec).toBeCloseTo(0.25, 6);
  });

  it('P01: pausing freezes enemy telegraphs, cooldown, buff, N05 neglect and safe healing together', () => {
    const sim = fixture(3);
    sim.state.progress.wallet = 100;
    sim.state.progress.unlockedSkills = ['S04'];
    send(sim, { type: 'CAST_SKILL', skillId: 'S04', target: { kind: 'GLOBAL' } });
    employee(sim).hp = 50;
    employee(sim).sp = 50;
    employee(sim).safeStayElapsedSec = 5;
    room(sim, 'N05').memory.idleElapsedSec = 35;
    sim.forceBreach('N04');
    const enemy = sim.state.enemies.find(e => e.sourceAnomalyId === 'N04')!;
    enemy.attackPhase = 'WINDUP';
    enemy.windupEndsAtSec = 0.05;
    sim.setPaused(true);
    const before = JSON.stringify(sim.state);
    sim.advance(20);
    ticks(sim, 20);
    expect(JSON.stringify(sim.state)).toBe(before);
  });

  it('P11: closing nested panels preserves both remaining modal pause and pre-existing manual pause', () => {
    const sim = fixture();
    sim.setPaused(true);
    sim.setPanelPaused('archive', true);
    sim.setPanelPaused('equipment', true);
    sim.setPanelPaused('archive', false);
    sim.setPanelPaused('equipment', false);
    expect(sim.state.timeScale).toBe(0);
    sim.setPaused(false);
    sim.setPanelPaused('archive', true);
    sim.setPanelPaused('equipment', true);
    sim.setPanelPaused('archive', false);
    expect(sim.state.timeScale).toBe(0);
    sim.setPanelPaused('equipment', false);
    expect(sim.state.timeScale).toBe(1);
  });

  it('P05: retry deep-restores day entry, including purchases and equipment from preparation', () => {
    const sim = new Simulation();
    send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'BEHAVIOR' });
    expect(sim.state.progress.wallet).toBe(38);
    sim.state.progress.wallet += 100;
    send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'EQUIPMENT' });
    send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E01', weaponId: 'W01' });
    sim.retryDay();
    expect(sim.state.phase).toBe('DAY_PREP');
    expect(sim.state.progress.wallet).toBe(50);
    expect(sim.state.progress.ownedWeapons).toEqual([]);
    expect(sim.state.progress.research.N01.behavior).toBe(false);
    expect(employee(sim).weaponId).toBe('W00');
  });

  it('G08/G10/C18: new day keeps purchases and gear, restores employees and resets transient states once', () => {
    const sim = fixture();
    sim.state.progress.wallet = 200;
    send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'BEHAVIOR' });
    send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'EQUIPMENT' });
    send(sim, { type: 'PURCHASE', anomalyId: 'N01', item: 'SKILL' });
    send(sim, { type: 'EQUIP_WEAPON', employeeId: 'E01', weaponId: 'W01' });
    sim.damageEmployee('E01', { type: 'RED', kind: 'FLAT', amount: 100 });
    expect(employee(sim).weaponId).toBe('W01');
    sim.state.producedToday = 150;
    sim.forceBreach('N01');
    sim.state.skillCooldownRemainingSec.S01 = 20;
    const wallet = sim.state.progress.wallet;
    send(sim, { type: 'FINISH_DAY' });
    expect(sim.nextDay().ok).toBe(true);
    expect(sim.state.phase).toBe('DAY_PREP');
    expect(sim.state.day).toBe(2);
    expect(sim.state.progress.wallet).toBe(wallet);
    expect(sim.state.producedToday).toBe(0);
    expect(sim.state.employees).toHaveLength(5);
    expect(employee(sim).hp).toBe(100);
    expect(employee(sim).sp).toBe(100);
    expect(employee(sim).status).toBe('IDLE');
    expect(employee(sim).weaponId).toBe('W01');
    expect(sim.state.progress.unlockedSkills).toContain('S01');
    expect(sim.state.enemies).toHaveLength(0);
    expect(sim.state.skillCooldownRemainingSec.S01).toBe(0);
    expect(room(sim, 'N01').pressure).toBe(20);
    expect(room(sim, 'N03').mode).toBe('CONTAINED');
    expect(sim.nextDay().ok).toBe(false);
    const restored = new Simulation(sim.snapshot());
    expect(restored.state.progress.wallet).toBe(wallet);
    expect(restored.state.employees).toHaveLength(5);
  });

  it('G12: finishing the third day ends the demo, never creates day four', () => {
    const sim = fixture(3);
    sim.state.producedToday = 340;
    expect(send(sim, { type: 'FINISH_DAY' }).ok).toBe(true);
    // Implementations may present the final report first, but next-day must finish, never open a fourth day.
    if (sim.state.phase === 'DAY_REPORT') sim.nextDay();
    expect(sim.state.phase).toBe('COMPLETE');
    expect(sim.state.day).toBe(3);
  });
});
