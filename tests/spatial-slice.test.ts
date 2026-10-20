import { describe, expect, it, vi } from 'vitest';
import type { Command } from '../contracts/data-contract';
import { config } from '../src/data/config';
import { Simulation } from '../src/simulation/engine';
import { createSliceSimulation } from '../src/debug/createSliceSimulation';
import { SliceController } from '../src/debug/SliceController';

type Input = Command extends infer C ? C extends Command ? Omit<C, 'commandId'> : never : never;
let serial = 0;
function command(simulation: Simulation, input: Input) {
  return simulation.command({ ...input, commandId: `spatial-${++serial}` } as Command);
}
function runningSlice() {
  const simulation = createSliceSimulation();
  if (simulation.state.phase === 'DAY_PREP') expect(command(simulation, { type: 'START_DAY' }).ok).toBe(true);
  return simulation;
}
function ticks(simulation: Simulation, seconds: number) {
  for (let index = 0; index < Math.round(seconds / config.game.simulation.fixedStepSec); index++) simulation.step();
}

describe('v0.2 isolated spatial slice: shared real simulation, not visual acceptance', () => {
  it('keeps the debug roster at two, only N01 open, and leaves formal day one at four', () => {
    const before = JSON.stringify(config);
    const slice = createSliceSimulation();
    expect(slice).toBeInstanceOf(Simulation);
    expect(slice.state.employees.map(employee => employee.id)).toEqual(['E01', 'E02']);
    expect(slice.state.rooms.filter(room => room.mode === 'CONTAINED').map(room => room.anomalyId)).toEqual(['N01']);
    expect(slice.state.rooms.filter(room => room.anomalyId !== 'N01').every(room => room.mode === 'LOCKED')).toBe(true);
    const formal = new Simulation();
    expect(formal.state.employees).toHaveLength(4);
    expect(formal.state.rooms.filter(room => room.mode === 'CONTAINED').map(room => room.anomalyId)).toEqual(['N01', 'N02']);
    expect(JSON.stringify(config)).toBe(before);
  });

  it('neither reads nor overwrites the formal local save when constructing or resetting a debug slice', () => {
    const getItem = vi.fn(() => 'existing player save');
    const setItem = vi.fn();
    const removeItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem, setItem, removeItem });
    try {
      const first = createSliceSimulation();
      const second = createSliceSimulation();
      expect(first.state).not.toBe(second.state);
      expect(first.state.employees[0]).not.toBe(second.state.employees[0]);
      expect(getItem).not.toHaveBeenCalled();
      expect(setItem).not.toHaveBeenCalled();
      expect(removeItem).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it('moves by fixed steps and replaces a destination while travelling rather than teleporting', () => {
    const sim = runningSlice();
    const employee = sim.state.employees[0]!;
    expect(command(sim, { type: 'MOVE', employeeIds: [employee.id], point: { x: 400, y: 440 } }).ok).toBe(true);
    let total = 0;
    for (let index = 0; index < 50; index++) {
      const previous = { ...employee.location };
      sim.step();
      const distance = Math.hypot(employee.location.x - previous.x, employee.location.y - previous.y);
      expect(distance).toBeLessThanOrEqual(config.game.employee.moveSpeedPxPerSec * config.game.simulation.fixedStepSec + 1e-6);
      total += distance;
    }
    expect(total).toBeGreaterThan(100);
    const atRedirect = { ...employee.location };
    expect(command(sim, { type: 'MOVE', employeeIds: [employee.id], point: { x: 1000, y: 440 } }).ok).toBe(true);
    expect(employee.location).toEqual(atRedirect);
    expect(employee.order).toEqual({ kind: 'MOVE', destination: { x: 1000, y: 440 } });
    expect(employee.path.at(-1)).toEqual({ x: 1000, y: 440 });
    ticks(sim, 20);
    expect(employee.location).toMatchObject({ x: 1000, y: 440, zone: 'CORRIDOR' });
  });

  it('accepts a paused work order then a paused retreat without moving, starting work or earning energy', () => {
    const sim = runningSlice();
    const employee = sim.state.employees[0]!;
    command(sim, { type: 'MOVE', employeeIds: ['E01'], point: { x: 154, y: 440 } });
    ticks(sim, 3);
    sim.setPaused(true);
    const stopped = { ...employee.location };
    expect(command(sim, { type: 'ASSIGN_WORK', employeeId: 'E01', roomId: 'N01', workType: 'OBSERVE' }).ok).toBe(true);
    expect(sim.state.rooms[0]!.work).toMatchObject({ phase: 'TRAVELLING', elapsedSec: 0 });
    ticks(sim, 5);
    expect(employee.location).toEqual(stopped);
    expect(sim.state.rooms[0]!.work!.elapsedSec).toBe(0);
    expect(command(sim, { type: 'RETREAT', employeeIds: ['E01'] }).ok).toBe(true);
    expect(sim.state.rooms[0]!.work).toBeNull();
    expect(sim.state.producedToday).toBe(0);
    ticks(sim, 5);
    expect(employee.location).toEqual(stopped);
    sim.setPaused(false);
    ticks(sim, 20);
    expect(employee.location.zone).toBe('SAFE');
    expect(sim.state.producedToday).toBe(0);
  });

  it('starts work only after reaching the actual room node and awards once after the full process', () => {
    const sim = runningSlice();
    const employee = sim.state.employees[0]!;
    const room = sim.state.rooms.find(value => value.anomalyId === 'N01')!;
    command(sim, { type: 'ASSIGN_WORK', employeeId: 'E01', roomId: 'N01', workType: 'OBSERVE' });
    let travelTicks = 0;
    while (room.work?.phase === 'TRAVELLING' && travelTicks < 1000) {
      expect(room.work.elapsedSec).toBe(0);
      expect(sim.state.producedToday).toBe(0);
      sim.step(); travelTicks++;
    }
    expect(travelTicks).toBeGreaterThan(0);
    expect(employee.location).toMatchObject({ x: config.game.layout.roomCentersX[0], y: config.game.layout.roomCenterY, zone: 'ROOM', roomId: 'N01' });
    expect(room.work?.phase).toBe('EXECUTING');
    ticks(sim, 23.8);
    expect(sim.state.producedToday).toBe(0);
    ticks(sim, 0.2);
    expect(sim.state.producedToday).toBe(12);
    ticks(sim, 25);
    expect(sim.state.producedToday).toBe(12);
    expect(employee.location.zone).toBe('CORRIDOR');
    expect(employee.status).toBe('IDLE');
  });

  it('debug breach invokes the normal main/clone lifecycle and never provides energy', () => {
    const sim = runningSlice();
    const before = { wallet: sim.state.progress.wallet, produced: sim.state.producedToday };
    sim.forceBreach('N01', 'spatial fixture formal breach');
    expect(sim.state.enemies.filter(enemy => !enemy.isClone)).toHaveLength(1);
    expect(sim.state.enemies.filter(enemy => enemy.isClone)).toHaveLength(2);
    expect(new Set(sim.state.enemies.map(enemy => enemy.id)).size).toBe(3);
    const main = sim.state.enemies.find(enemy => !enemy.isClone)!;
    sim.damageEnemy(main.id, { type: 'RED', kind: 'FLAT', amount: 999 });
    expect(sim.state.enemies).toHaveLength(0);
    expect(sim.state.rooms[0]!.mode).toBe('RECOVERING');
    expect({ wallet: sim.state.progress.wallet, produced: sim.state.producedToday }).toEqual(before);
  });

  it('STOP cancels a moving route in place, including while paused', () => {
    const controller = new SliceController();
    controller.select(['E01']);
    controller.issue({ type: 'MOVE', employeeIds: ['E01'], point: { x: 154, y: 440 } });
    ticks(controller.simulation, 3);
    const employee = controller.state.employees[0]!;
    const position = { ...employee.location };
    controller.togglePause();
    expect(controller.stop().ok).toBe(true);
    expect(employee.order.kind).toBe('IDLE');
    expect(employee.path).toEqual([]);
    ticks(controller.simulation, 2);
    expect(employee.location).toEqual(position);
    controller.togglePause();
    ticks(controller.simulation, 3);
    expect(employee.location).toEqual(position);
    expect(controller.events.some(event => event.type === 'COMMAND' && JSON.stringify(event.detail).includes('STOP'))).toBe(true);
  });

  it.each(['TRAVELLING', 'EXECUTING'] as const)('STOP releases a %s work reservation without income, pressure or residual motion', phase => {
    const controller = new SliceController();
    controller.select(['E01']);
    expect(controller.assignWork('OBSERVE').ok).toBe(true);
    const room = controller.state.rooms[0]!;
    if (phase === 'EXECUTING') {
      for (let n = 0; n < 1000 && room.work?.phase === 'TRAVELLING'; n++) controller.simulation.step();
      expect(room.work?.phase).toBe('EXECUTING');
    }
    const employee = controller.state.employees[0]!;
    const position = { ...employee.location };
    const pressure = room.pressure;
    expect(controller.stop().ok).toBe(true);
    ticks(controller.simulation, 25);
    expect(room.work).toBeNull();
    expect(room.pressure).toBe(pressure);
    expect(controller.state.producedToday).toBe(0);
    expect(employee.location).toEqual(position);
    expect(employee.order.kind).toBe('IDLE');
  });

  it('STOP during paused attack windup cancels the pending hit and does not silently reattack', () => {
    const controller = new SliceController();
    controller.select(['E01']);
    controller.issue({ type: 'MOVE', employeeIds: ['E01'], point: { x: 154, y: 440 } });
    ticks(controller.simulation, 15);
    controller.triggerBreach();
    const enemy = controller.state.enemies.find(value => !value.isClone)!;
    controller.issue({ type: 'SUPPRESS', employeeIds: ['E01'], enemyId: enemy.id });
    if (controller.state.timeScale === 0) controller.togglePause();
    controller.simulation.step();
    const employee = controller.state.employees[0]!;
    expect(employee.windupEndsAtSec).not.toBeNull();
    const hp = enemy.suppressionHp;
    controller.togglePause();
    expect(controller.stop().ok).toBe(true);
    expect(employee.windupEndsAtSec).toBeNull();
    controller.togglePause();
    ticks(controller.simulation, 3);
    expect(enemy.suppressionHp).toBe(hp);
    expect(employee.order.kind).toBe('IDLE');
  });

  it('requires a single selected employee for room work, without consuming a partial group command', () => {
    const controller = new SliceController();
    controller.select(['E01', 'E02']);
    expect(controller.assignWork('OBSERVE').ok).toBe(false);
    expect(controller.state.rooms[0]!.work).toBeNull();
  });
});
