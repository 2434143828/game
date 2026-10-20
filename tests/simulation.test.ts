import { describe, expect, it } from 'vitest';
import type { Resistances } from '../contracts/data-contract';
import { Simulation } from '../src/simulation/engine';
import { resolveEmployeeDamage, resolveEnemyDamage } from '../src/simulation/damage';

import { send, room, employee, ticks, fixture, workAtPosition, completeWork } from './helpers';

describe('M1: a real work / breach / recovery / report slice', () => {
  it('G01: starts at day 1 preparation with first funding only and four starter employees', () => {
    const sim = new Simulation();
    expect(sim.state.phase).toBe('DAY_PREP');
    expect(sim.state.progress.wallet).toBe(50);
    expect(sim.state.producedToday).toBe(0);
    expect(sim.state.employees).toHaveLength(4);
    expect(sim.state.rooms.filter(r => r.mode === 'CONTAINED').map(r => r.anomalyId)).toEqual(['N01', 'N02']);
    expect(sim.state.employees.every(e => e.weaponId === 'W00' && e.armorId === 'A00')).toBe(true);
  });

  it('G02/W01/W02: travel reserves a unique room and pays only after the complete work duration', () => {
    const sim = fixture();
    expect(send(sim, { type: 'ASSIGN_WORK', employeeId: 'E01', roomId: 'N01', workType: 'OBSERVE' }).ok).toBe(true);
    expect(room(sim, 'N01').work?.phase).toBe('TRAVELLING');
    expect(send(sim, { type: 'ASSIGN_WORK', employeeId: 'E02', roomId: 'N01', workType: 'OBSERVE' }).ok).toBe(false);
    for (let n = 0; n < 1000 && room(sim, 'N01').work?.phase !== 'EXECUTING'; n++) sim.step();
    expect(room(sim, 'N01').work?.phase).toBe('EXECUTING');
    ticks(sim, 23.8);
    expect(sim.state.producedToday).toBe(0);
    ticks(sim, 0.2);
    expect(sim.state.producedToday).toBe(12);
    expect(sim.state.progress.wallet).toBe(62);
    expect(employee(sim).sp).toBe(96);
    expect(room(sim, 'N01').pressure).toBe(25);
  });

  it('W03/W10: voluntary cancellation is free, releases both associations; completion never auto repeats', () => {
    const sim = fixture();
    workAtPosition(sim, 'N01', 'OBSERVE');
    ticks(sim, 10);
    expect(send(sim, { type: 'RETREAT', employeeIds: ['E01'] }).ok).toBe(true);
    expect(room(sim, 'N01').work).toBeNull();
    expect(room(sim, 'N01').pressure).toBe(20);
    expect(sim.state.producedToday).toBe(0);
    completeWork(sim, 'N01', 'OBSERVE');
    ticks(sim, 30);
    expect(sim.state.producedToday).toBe(12);
    expect(employee(sim).status).toBe('IDLE');
    expect(employee(sim).location.zone).toBe('CORRIDOR');
  });

  it('W04/C12: threshold completion earns nothing and creates exactly one main and two clones', () => {
    const sim = fixture();
    room(sim, 'N01').pressure = 90;
    completeWork(sim, 'N01', 'INTERACT');
    expect(room(sim, 'N01').mode).toBe('BREACHED');
    expect(room(sim, 'N01').work).toBeNull();
    expect(sim.state.producedToday).toBe(0);
    expect(sim.state.progress.wallet).toBe(50);
    expect(sim.state.enemies.filter(e => !e.isClone)).toHaveLength(1);
    expect(sim.state.enemies.filter(e => e.isClone)).toHaveLength(2);
    sim.forceBreach('N01');
    expect(sim.state.enemies).toHaveLength(3);
  });

  it('W05/G09/C13: suppression pays nothing, clears clones, and leaves ten full seconds without production', () => {
    const sim = fixture();
    sim.forceBreach('N01');
    expect(send(sim, { type: 'ASSIGN_WORK', employeeId: 'E01', roomId: 'N01', workType: 'OBSERVE' }).ok).toBe(false);
    const main = sim.state.enemies.find(e => !e.isClone)!;
    sim.damageEnemy(main.id, { type: 'RED', kind: 'FLAT', amount: 999 });
    expect(sim.state.enemies).toHaveLength(0);
    expect(room(sim, 'N01').mode).toBe('RECOVERING');
    expect(send(sim, { type: 'ASSIGN_WORK', employeeId: 'E01', roomId: 'N01', workType: 'OBSERVE' }).ok).toBe(false);
    ticks(sim, 9.95);
    expect(room(sim, 'N01').mode).toBe('RECOVERING');
    ticks(sim, 0.05);
    expect(room(sim, 'N01').mode).toBe('CONTAINED');
    expect(room(sim, 'N01').pressure).toBe(25);
    expect(sim.state.progress.wallet).toBe(50);
    expect(sim.state.producedToday).toBe(0);
  });

  it('G05/G06/G07: quota uses earned production and permits a report with accidents and unfinished work', () => {
    const sim = fixture();
    sim.state.progress.wallet = 1000;
    expect(send(sim, { type: 'FINISH_DAY' }).ok).toBe(false);
    sim.state.producedToday = 150;
    sim.forceBreach('N01');
    expect(send(sim, { type: 'ASSIGN_WORK', employeeId: 'E01', roomId: 'N02', workType: 'OBSERVE' }).ok).toBe(true);
    expect(send(sim, { type: 'FINISH_DAY' }).ok).toBe(true);
    expect(sim.state.phase).toBe('DAY_REPORT');
    ticks(sim, 100);
    expect(sim.state.producedToday).toBe(150);
    expect(sim.state.progress.wallet).toBe(1000);
    expect(sim.state.rooms.every(r => r.work === null)).toBe(true);
    expect(sim.state.report?.unresolved).toBeGreaterThan(0);
  });

  it('P01: manual pause freezes motion, work and simulation clock even with a long frame', () => {
    const sim = fixture();
    expect(send(sim, { type: 'ASSIGN_WORK', employeeId: 'E01', roomId: 'N01', workType: 'OBSERVE' }).ok).toBe(true);
    sim.setPaused(true);
    const before = JSON.stringify(sim.state);
    sim.advance(20);
    ticks(sim, 20);
    expect(JSON.stringify(sim.state)).toBe(before);
  });
});

describe('four damage attributes', () => {
  const resistance: Resistances = { RED: 0.6, WHITE: 0.6, BLACK: 0.6, PALE: 0.55 };
  it.each([
    ['RED', 92.8, 100], ['WHITE', 100, 92.8], ['BLACK', 92.8, 92.8],
  ] as const)('C01-C03: %s applies to its intended bars only', (type, hp, sp) => {
    const result = resolveEmployeeDamage(100, 100, 100, { type, kind: 'FLAT', amount: 12 }, resistance);
    expect(result.hp).toBeCloseTo(hp, 6);
    expect(result.sp).toBeCloseTo(sp, 6);
  });
  it('C04: pale employee damage uses maximum life even while wounded', () => {
    expect(resolveEmployeeDamage(50, 100, 100, { type: 'PALE', kind: 'MAX_RATIO', amount: 0.06 }, resistance).hp).toBeCloseTo(46.7, 6);
  });
  it('C05/C06: pale enemy damage uses maximum suppression and black hits a single bar once', () => {
    const res = { RED: 1, WHITE: 1, BLACK: 0.7, PALE: 1.2 };
    expect(resolveEnemyDamage(240, { type: 'PALE', kind: 'MAX_RATIO', amount: 0.04 }, res)).toBeCloseTo(11.52, 6);
    expect(resolveEnemyDamage(240, { type: 'BLACK', kind: 'FLAT', amount: 9 }, res)).toBeCloseTo(6.3, 6);
  });
});
