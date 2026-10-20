import { describe, expect, it } from 'vitest';
import type { Location, Point } from '../contracts/data-contract';
import { config, anomalyById, skillById } from '../src/data/config';
import { createFacilitySimulation } from '../src/game/createFacilitySimulation';
import { Simulation } from '../src/simulation/engine';
import { facilityDefinition, GraphNavigation, largeFacilityNavigation as nav } from '../src/simulation/graphNavigation';
import { legacyNavigation } from '../src/simulation/navigation';
import { distance } from '../src/simulation/path';
import { initialProgress, makeSnapshot } from '../src/simulation/state';
import { employee, room, send, ticks } from './helpers';

const dt = config.game.simulation.fixedStepSec;
const at = (id: string): Location => nav.locate(nav.nodes.get(id)!)!;
function large(ambient = false): Simulation {
  const progress = initialProgress();
  progress.tutorialOfferHandled = true;
  const sim = new Simulation(makeSnapshot(3, progress), {
    navigation: nav, ...(ambient ? { ambient: facilityDefinition.ambient } : {}),
  });
  sim.pauseOnFirstBreach = false;
  send(sim, { type: 'START_DAY' });
  return sim;
}
function walkUntil(sim: Simulation, predicate: () => boolean, limitSec = 80): void {
  for (let i = 0; i < limitSec / dt && !predicate(); i++) sim.step();
  expect(predicate()).toBe(true);
}
function length(from: Point, path: Point[]): number {
  let previous = from;
  return path.reduce((sum, point) => {
    const segment = distance(previous, point);
    previous = point;
    return sum + segment;
  }, 0);
}

describe('large facility graph: real, connected, orthogonal movement', () => {
  it('retains the old default navigation and snapshot format while the facility opts into the new world', () => {
    const original = new Simulation();
    const facility = createFacilitySimulation();
    expect(original.navigation).toBe(legacyNavigation);
    expect(original.state.employees[0].location).toMatchObject({ ...config.game.layout.safeCenter, zone: 'SAFE' });
    expect(facility.navigation).toBe(nav);
    expect(facility.state.employees[0].location).toMatchObject({ ...facilityDefinition.safePoint, zone: 'SAFE' });
    expect(facility.snapshot()).toEqual(original.snapshot());
    expect(facility.state.employees).toHaveLength(4);
    expect(facilityDefinition.bounds).toMatchObject({ width: 3600, height: 2500 });
  });

  it('reaches each room through its corridor entry and side door, without diagonal or disconnected shortcuts', () => {
    for (const id of ['N01', 'N02', 'N03', 'N04', 'N05'] as const) {
      const path = nav.route(nav.locate(nav.safePoint)!, nav.workPoint(id))!;
      const definition = facilityDefinition.rooms[id];
      const entry = nav.nodes.get(definition.entryNodeId)!;
      const door = nav.nodes.get(definition.doorNodeId)!;
      expect(path.some(p => distance(p, entry) < 0.001)).toBe(true);
      expect(path.some(p => distance(p, door) < 0.001)).toBe(true);
      expect(path.at(-1)).toMatchObject(nav.workPoint(id));
      let previous: Point = nav.safePoint;
      for (const next of path) {
        expect(previous.x === next.x || previous.y === next.y).toBe(true);
        expect(nav.locate({ x: (previous.x + next.x) / 2, y: (previous.y + next.y) / 2 }, nav.locate(previous)!, next)).not.toBeNull();
        previous = next;
      }
      expect(length(nav.safePoint, path)).toBeGreaterThan(distance(nav.safePoint, nav.workPoint(id)));
    }
    expect(nav.locate({ x: 50, y: 50 })).toBeNull();
    expect(nav.corridorAt({ x: 1500, y: 850.01 })).toBeNull();
  });

  it('does not turn a geometric crossing into a graph junction or safe-room immunity', () => {
    // Explicit geometric regression fixture: a shaft happens to cross the safe-center coordinate.
    const definition = structuredClone(facilityDefinition);
    for (const node of definition.nodes) if (node.id.startsWith('b-')) node.x = 1930;
    const crossing = new GraphNavigation(definition);
    const edgeId = 'edge:b-hub:b-mid';
    const transit = crossing.locate({ ...definition.safePoint, segmentId: edgeId } as Point)!;
    expect(transit.zone).toBe('TRANSIT');
    expect(transit.segmentId).toBe(edgeId);
    expect(crossing.route(transit, definition.safePoint)!.length).toBeGreaterThan(3);
    expect(crossing.travelDistance(transit, definition.safePoint)).toBeGreaterThan(500);
    expect(crossing.corridorAt(transit)).toBeNull();
    expect(crossing.locate(definition.safePoint)!.zone).toBe('SAFE');
  });

  it('rejects disconnected map data rather than silently allowing straight-line travel', () => {
    const definition = structuredClone(facilityDefinition);
    definition.edges = definition.edges.filter(edge => edge.to !== 'n05-work');
    expect(() => new GraphNavigation(definition)).toThrow(/n05-work.*unreachable/);
  });

  it('walks at the configured speed, stops on a connector, and replans from that exact location', () => {
    const sim = large();
    const e = employee(sim);
    expect(send(sim, { type: 'MOVE', employeeIds: [e.id], point: at('n01-entry') }).ok).toBe(true);
    walkUntil(sim, () => e.location.zone === 'TRANSIT');
    const before = { ...e.location };
    sim.step();
    expect(distance(before, e.location)).toBeCloseTo(config.game.employee.moveSpeedPxPerSec * dt);
    expect(send(sim, { type: 'STOP', employeeIds: [e.id] }).ok).toBe(true);
    const stopped = { ...e.location };
    ticks(sim, 10);
    expect(e.location).toEqual(stopped);
    expect(send(sim, { type: 'MOVE', employeeIds: [e.id], point: at('n05-entry') }).ok).toBe(true);
    expect(e.path[0].x).toBe(stopped.x);
    walkUntil(sim, () => e.order.kind === 'IDLE');
    expect(e.location).toMatchObject(at('n05-entry'));
    expect(sim.state.producedToday).toBe(0);
  });

  it('requires real travel before work starts and permits a new order on a staircase without old income', () => {
    const sim = large();
    const e = employee(sim);
    send(sim, { type: 'ASSIGN_WORK', employeeId: e.id, roomId: 'N01', workType: 'OBSERVE' });
    walkUntil(sim, () => e.location.zone === 'TRANSIT');
    expect(room(sim, 'N01').work).toMatchObject({ phase: 'TRAVELLING', elapsedSec: 0 });
    send(sim, { type: 'ASSIGN_WORK', employeeId: e.id, roomId: 'N05', workType: 'OBSERVE' });
    expect(room(sim, 'N01').work).toBeNull();
    walkUntil(sim, () => room(sim, 'N05').work?.phase === 'EXECUTING');
    expect(e.location).toMatchObject({ ...nav.workPoint('N05'), zone: 'ROOM', roomId: 'N05' });
    expect(sim.state.producedToday).toBe(0);
    ticks(sim, anomalyById.N05.workProfiles.find(work => work.type === 'OBSERVE')!.durationSec);
    expect(sim.state.producedToday).toBe(anomalyById.N05.workProfiles.find(work => work.type === 'OBSERVE')!.energy);
  });
});

describe('multi-floor combat and skill topology', () => {
  it.each([
    { employeeY: 487, enemyY: 487, landingY: 460 },
    { employeeY: 654, enemyY: 656, landingY: 850 },
    { employeeY: 656, enemyY: 654, landingY: 460 },
  ])('resolves opposing suppression on the connector at $employeeY/$enemyY by walking to one legal landing', ({ employeeY, enemyY, landingY }) => {
    // Reproduces the real browser deadlock; no production state fixture is used by the browser proof.
    const sim = large();
    sim.forceBreach('N01');
    const enemy = sim.state.enemies[0], workers = sim.state.employees.slice(0, 4);
    for (const unit of sim.state.enemies) unit.location = nav.locate({ x: 1400, y: enemyY })!;
    for (const worker of workers) worker.location = nav.locate({ x: 1400, y: employeeY })!;
    send(sim, { type: 'SUPPRESS', employeeIds: workers.map(worker => worker.id), enemyId: enemy.id });
    const hp = enemy.suppressionHp;
    for (let step = 0; step < 10 / dt && enemy.suppressionHp === hp; step++) {
      const before = new Map([...workers, ...sim.state.enemies].map(unit => [unit.id, { ...unit.location }]));
      sim.step();
      for (const worker of workers) {
        expect(distance(before.get(worker.id)!, worker.location)).toBeLessThanOrEqual(config.game.employee.moveSpeedPxPerSec * dt + 0.00001);
        if (worker.location.zone === 'TRANSIT') expect(worker.windupEndsAtSec).toBeNull();
      }
      for (const unit of sim.state.enemies) {
        expect(distance(before.get(unit.id)!, unit.location)).toBeLessThanOrEqual(anomalyById.N01.breach.moveSpeedPxPerSec * dt + 0.00001);
        if (unit.location.zone === 'TRANSIT') expect(unit.windupEndsAtSec).toBeNull();
      }
    }
    expect(enemy.suppressionHp).toBeLessThan(hp);
    expect(enemy.location).toMatchObject({ x: 1400, y: landingY, zone: 'CORRIDOR' });
    expect(workers.every(worker => worker.location.zone === 'CORRIDOR' && worker.location.y === landingY)).toBe(true);
  });

  it('breaks an equal-distance landing tie deterministically along the graph', () => {
    const middle = nav.locate({ x: 1400, y: 655 })!;
    expect(nav.nearestCorridor(middle)).toEqual(at('a-hub'));
    expect(nav.nearestCorridor(middle)).toEqual(nav.nearestCorridor(middle));
  });

  it('completes the natural hub-to-N01 suppression approach without getting stuck in the stair shaft', () => {
    const sim = large();
    sim.forceBreach('N01');
    const enemy = sim.state.enemies[0], workers = sim.state.employees.slice(0, 4);
    for (const worker of workers) worker.location = at('hub-center');
    send(sim, { type: 'SUPPRESS', employeeIds: workers.map(worker => worker.id), enemyId: enemy.id });
    const hp = enemy.suppressionHp;
    walkUntil(sim, () => workers.some(worker => worker.location.zone === 'TRANSIT'), 15);
    walkUntil(sim, () => enemy.suppressionHp < hp, 20);
    expect(enemy.location.zone).toBe('CORRIDOR');
    expect(workers.some(worker => Number.isFinite(nav.combatDistance(worker.location, enemy.location)))).toBe(true);
  });

  it.each(['STOP', 'RETREAT'] as const)('immediately discards the stair suppression rendezvous when the player issues %s', command => {
    const sim = large();
    sim.forceBreach('N01');
    const enemy = sim.state.enemies[0], e = employee(sim);
    enemy.location = nav.locate({ x: 1400, y: 656 })!;
    e.location = nav.locate({ x: 1400, y: 654 })!;
    send(sim, { type: 'SUPPRESS', employeeIds: [e.id], enemyId: enemy.id });
    sim.step();
    expect(e.path.at(-1)).toMatchObject({ x: at('a-hub').x, y: at('a-hub').y });
    expect(send(sim, { type: command, employeeIds: [e.id] }).ok).toBe(true);
    const before = { ...e.location };
    if (command === 'STOP') {
      ticks(sim, 2);
      expect(e.order.kind).toBe('IDLE');
      expect(e.path).toEqual([]);
      expect(e.location).toEqual(before);
    } else {
      expect(e.order.kind).toBe('RETREAT');
      expect(e.path.at(-1)).toMatchObject(nav.safePoint);
      sim.step();
      expect(e.location).not.toEqual(before);
      expect(e.path.at(-1)).toMatchObject(nav.safePoint);
    }
  });

  it('separates corridor floors and connectors, and clamps knockback to the hit floor', () => {
    expect(nav.combatDistance(at('b-top'), at('b-hub'))).toBe(Infinity);
    const transit = nav.locate({ x: 2350, y: 645 })!;
    expect(nav.combatDistance(at('b-top'), transit)).toBe(Infinity);
    expect(nav.combatDistance(at('b-top'), at('n02-entry'))).toBe(60);
    expect(nav.knockback(at('b-top'), -160)).toMatchObject(at('b-top'));
    expect(nav.knockback(at('b-top'), 160)).toMatchObject(at('n02-entry'));
    expect(nav.knockback(transit, 160)).toEqual(transit);
  });

  it('chases across actual landings, including a target on a connector, without hitting through it', () => {
    const sim = large();
    sim.forceBreach('N02');
    const enemy = sim.state.enemies[0];
    const e = employee(sim);
    e.location = nav.locate({ x: 2350, y: 645 })!;
    send(sim, { type: 'STOP', employeeIds: [e.id] });
    const hp = e.hp;
    ticks(sim, 2);
    expect(enemy.targetEmployeeId).toBe(e.id);
    expect(enemy.location).toMatchObject({ x: 2350, y: 645, zone: 'TRANSIT' });
    expect(e.hp).toBe(hp);
    send(sim, { type: 'MOVE', employeeIds: [e.id], point: at('b-hub') });
    walkUntil(sim, () => e.location.zone === 'CORRIDOR');
    walkUntil(sim, () => e.hp < hp, 10);
    expect(enemy.location.y).toBe(at('b-hub').y);
  });

  it('moves a suppressing employee through the graph and starts a hit only on the target corridor', () => {
    const sim = large();
    sim.forceBreach('N02');
    const enemy = sim.state.enemies[0];
    enemy.stunnedUntilSec = 100;
    const e = employee(sim);
    e.location = nav.locate({ x: 2350, y: 645 })!;
    send(sim, { type: 'SUPPRESS', employeeIds: [e.id], enemyId: enemy.id });
    const hp = enemy.suppressionHp;
    sim.step();
    expect(enemy.suppressionHp).toBe(hp);
    walkUntil(sim, () => enemy.suppressionHp < hp, 10);
    expect(e.location.zone).toBe('CORRIDOR');
    expect(e.location.y).toBe(640);
  });

  it('casts S03 on a corridor only, ignores a nearby connector, and pushes the same-floor enemy to its boundary', () => {
    const sim = large();
    sim.state.progress.unlockedSkills.push('S03');
    sim.forceBreach('N01');
    const [main, clone] = sim.state.enemies;
    main.location = nav.locate({ x: 2380, y: 640 })!;
    clone.location = nav.locate({ x: 2350, y: 700 })!;
    const cloneHp = clone.suppressionHp, mainHp = main.suppressionHp;
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S03', target: { kind: 'POINT', point: clone.location } }).ok).toBe(false);
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S03', target: { kind: 'POINT', point: at('b-top') } }).ok).toBe(true);
    expect(main.suppressionHp).toBeLessThan(mainHp);
    expect(main.location).toMatchObject(at('n02-entry'));
    expect(clone.suppressionHp).toBe(cloneHp);
    expect(clone.location.zone).toBe('TRANSIT');
  });

  it('keeps the broadcast global outside SAFE and S05 Euclidean within expanded world bounds', () => {
    const sim = large();
    sim.forceBreach('N04');
    const e = employee(sim), safe = employee(sim, 'E02');
    e.location = at('n01-work');
    send(sim, { type: 'STOP', employeeIds: [e.id] });
    const hp = e.hp, safeHp = safe.hp;
    ticks(sim, anomalyById.N04.breach.firstAttackDelaySec + anomalyById.N04.breach.windupSec + dt);
    expect(e.hp).toBeLessThan(hp);
    expect(safe.hp).toBe(safeHp);
    sim.state.progress.unlockedSkills.push('S05');
    e.location = at('n05-work'); e.sp = 40;
    expect(send(sim, { type: 'CAST_SKILL', skillId: 'S05', target: { kind: 'POINT', point: at('n05-work') } }).ok).toBe(true);
    const restore = skillById.S05;
    if (restore.effect !== 'RESTORE_SP') throw new Error('S05 fixture expects RESTORE_SP');
    expect(e.sp).toBe(40 + restore.restoreSp);
  });

  it('patrols N05 along corridors and stairs instead of scanning a single global y coordinate', () => {
    const sim = large();
    sim.forceBreach('N05');
    const enemy = sim.state.enemies[0];
    walkUntil(sim, () => enemy.location.zone === 'TRANSIT', 20);
    expect(enemy.location.x).toBe(at('c-bottom').x);
    expect(enemy.location.y).toBeLessThan(at('c-bottom').y);
    expect(enemy.location.y).toBeGreaterThan(at('n03-entry').y);
    expect(sim.state.producedToday).toBe(0);
  });
});

describe('ambient movement: deterministic simulation, explicit command priority', () => {
  it('starts real walks after configured idle waits, at the configured stroll speed, without jobs or income', () => {
    const sim = large(true), e = employee(sim);
    ticks(sim, facilityDefinition.ambient.waitMinSec);
    expect(e.path).toEqual([]);
    walkUntil(sim, () => e.path.length > 0, facilityDefinition.ambient.waitMaxSec);
    expect(e.order.kind).toBe('IDLE');
    expect(e.status).toBe('MOVING');
    const before = { ...e.location };
    sim.step();
    expect(distance(before, e.location)).toBeCloseTo(config.game.employee.moveSpeedPxPerSec * facilityDefinition.ambient.speedMultiplier * dt);
    expect(sim.state.rooms.every(room => room.work === null)).toBe(true);
    expect(sim.state.producedToday).toBe(0);
    expect(sim.state.progress.wallet).toBe(50);
  });

  it('freezes ambient movement and wait timers under pause, then replaces its path on manual work', () => {
    const sim = large(true), e = employee(sim);
    ticks(sim, 2);
    const before = structuredClone(e.location), time = sim.state.simulationTimeSec;
    sim.setPaused(true);
    for (let i = 0; i < 100; i++) sim.advance(0.1);
    expect(sim.state.simulationTimeSec).toBe(time);
    expect(e.location).toEqual(before);
    sim.setPaused(false);
    walkUntil(sim, () => e.path.length > 0);
    expect(send(sim, { type: 'ASSIGN_WORK', employeeId: e.id, roomId: 'N02', workType: 'OBSERVE' }).ok).toBe(true);
    expect(e.order.kind).toBe('WORK');
    expect(e.path.at(-1)).toMatchObject(nav.workPoint('N02'));
    walkUntil(sim, () => room(sim, 'N02').work?.phase === 'EXECUTING');
    expect(e.location).toMatchObject({ ...nav.workPoint('N02'), zone: 'ROOM' });
  });

  it('holds STOP indefinitely, including on a stair, until the next player command', () => {
    const sim = large(true), e = employee(sim);
    send(sim, { type: 'MOVE', employeeIds: [e.id], point: at('n01-entry') });
    walkUntil(sim, () => e.location.zone === 'TRANSIT');
    send(sim, { type: 'STOP', employeeIds: [e.id] });
    const before = { ...e.location };
    ticks(sim, 30);
    expect(e.location).toEqual(before);
    expect(e.path).toEqual([]);
    expect(send(sim, { type: 'MOVE', employeeIds: [e.id], point: at('a-hub') }).ok).toBe(true);
    sim.step();
    expect(e.location).not.toEqual(before);
  });

  it('retreats into SAFE and recovers fully before waiting and resuming idle movement', () => {
    const sim = large(true), e = employee(sim);
    e.location = at('safe-entry'); e.hp = 20; e.sp = 40;
    send(sim, { type: 'RETREAT', employeeIds: [e.id] });
    walkUntil(sim, () => e.order.kind === 'IDLE');
    expect(e.location).toMatchObject({ ...nav.safePoint, zone: 'SAFE' });
    while (e.hp < e.hpMax || e.sp < e.spMax) {
      expect(e.path).toEqual([]);
      expect(e.location.zone).toBe('SAFE');
      sim.step();
    }
    ticks(sim, facilityDefinition.ambient.waitMinSec - dt);
    expect(e.path).toEqual([]);
    walkUntil(sim, () => e.path.length > 0, facilityDefinition.ambient.waitMaxSec + dt);
    expect(e.hp).toBe(e.hpMax);
    expect(e.sp).toBe(e.spMax);
  });

  it('cancels active wandering immediately for an incident but retains deliberate player movement', () => {
    const sim = large(true), e = employee(sim), commanded = employee(sim, 'E02');
    walkUntil(sim, () => e.path.length > 0);
    send(sim, { type: 'MOVE', employeeIds: [commanded.id], point: at('n05-entry') });
    const before = { ...e.location }, commandedBefore = { ...commanded.location };
    sim.forceBreach('N01');
    expect(e.path).toEqual([]);
    ticks(sim, 1);
    expect(e.location).toEqual(before);
    expect(commanded.location).not.toEqual(commandedBefore);
    expect(commanded.order.kind).toBe('MOVE');
    expect(sim.state.rooms.every(room => room.work === null)).toBe(true);
  });
});
