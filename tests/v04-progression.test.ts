import { describe, expect, it } from 'vitest';
import { V3Simulation } from '../src/v3/engine';

const run = (simulation: V3Simulation, seconds: number): void => {
  for (let i = 0; i < Math.ceil(seconds / 0.05); i += 1) simulation.step();
};

function winChallenge(simulation: V3Simulation, anomalyId: 'N01'|'N02'|'N03'): void {
  expect(simulation.startEncounter('BREACH_CHALLENGE', anomalyId).ok).toBe(true);
  simulation.state.encounter!.enemies.find(enemy => !enemy.isClone)!.suppressionHp = 0;
  simulation.step();
  expect(simulation.state.encounter!.result).toBe('VICTORY');
  expect(simulation.finishEncounter().ok).toBe(true);
}

function capture(simulation: V3Simulation, anomalyId: 'N02'|'N03'|'N04'|'N05'): void {
  expect(simulation.startEncounter('CAPTURE', anomalyId).ok).toBe(true);
  const encounter = simulation.state.encounter!;
  const target = encounter.enemies.find(enemy => !enemy.isClone)!;
  target.suppressionHp = 1;
  target.nextAttackStartAtSec = Number.POSITIVE_INFINITY;
  simulation.state.employees.forEach((employee, index) => {
    employee.location = { ...target.location, x: target.location.x - 40 - index * 20 };
    employee.nextAttackStartAtSec = simulation.state.simulationTimeSec;
  });
  run(simulation, 0.5);
  expect(encounter.capturePhase).toBe('CAPTURABLE');
  expect(simulation.startCapture(encounter.squadIds[0]).ok).toBe(true);
  run(simulation, 5);
  expect(encounter.result).toBe('VICTORY');
  expect(simulation.finishEncounter().ok).toBe(true);
  expect(simulation.state.rooms.find(room => room.anomalyId === anomalyId)).toMatchObject({ owned: true, rank: 1, state: 'STABLE' });
}

describe('v0.4 normal progression frontier', () => {
  it('moves from N01 II into the next capture, then exposes N05 rank gate', () => {
    const simulation = new V3Simulation();
    simulation.state.wallet = 1000;

    winChallenge(simulation, 'N01');
    expect(simulation.nextTarget()).toMatchObject({ anomalyId: 'N02', mode: 'CAPTURE', available: true });
    capture(simulation, 'N02');
    expect(simulation.nextTarget()).toMatchObject({ anomalyId: 'N03', mode: 'CAPTURE', available: true });
    capture(simulation, 'N03');
    expect(simulation.nextTarget()).toMatchObject({ anomalyId: 'N04', mode: 'CAPTURE', available: true });
    capture(simulation, 'N04');

    // N05 requires three owned objects at II. The frontier points at a real
    // upgrade rather than pretending the N05 capture is available.
    expect(simulation.nextTarget()).toMatchObject({ anomalyId: 'N02', mode: 'BREACH_CHALLENGE', available: true });
    winChallenge(simulation, 'N01');
    winChallenge(simulation, 'N02');
    winChallenge(simulation, 'N03');
    expect(simulation.nextTarget()).toMatchObject({ anomalyId: 'N05', mode: 'CAPTURE', available: true });
  });
});
