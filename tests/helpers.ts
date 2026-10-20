import { expect } from 'vitest';
import type { AnomalyId, Command, DayNumber, EmployeeId, WorkType } from '../contracts/data-contract';
import { Simulation } from '../src/simulation/engine';
import anomalyJson from '../config/anomalies.json';

type Input = Command extends infer C ? C extends Command ? Omit<C, 'commandId'> : never : never;
let sequence = 0;
export function send(sim: Simulation, input: Input) {
  return sim.command({ ...input, commandId: `test-${++sequence}` } as Command);
}
export function room(sim: Simulation, id: AnomalyId) { return sim.state.rooms.find(r => r.anomalyId === id)!; }
export function employee(sim: Simulation, id: EmployeeId = 'E01') { return sim.state.employees.find(e => e.id === id)!; }
export function ticks(sim: Simulation, seconds: number) {
  for (let n = 0; n < Math.round(seconds / 0.05); n++) sim.step();
}
export function fixture(day: DayNumber = 1) {
  const snapshot = new Simulation().snapshot();
  snapshot.day = day;
  snapshot.progress.tutorialOfferHandled = true;
  const sim = new Simulation(snapshot);
  sim.pauseOnFirstBreach = false;
  expect(send(sim, { type: 'START_DAY' }).ok).toBe(true);
  return sim;
}
export function workAtPosition(sim: Simulation, id: AnomalyId, workType: WorkType, employeeId: EmployeeId = 'E01') {
  const index = Number(id.slice(1)) - 1;
  const worker = employee(sim, employeeId);
  worker.location = { x: [154, 364, 574, 784, 994][index]!, y: 275, zone: 'ROOM', roomId: id };
  worker.path = [];
  worker.order = { kind: 'IDLE' };
  worker.status = 'IDLE';
  expect(send(sim, { type: 'ASSIGN_WORK', employeeId, roomId: id, workType }).ok).toBe(true);
  sim.step();
  expect(room(sim, id).work?.phase).toBe('EXECUTING');
}
export function completeWork(sim: Simulation, id: AnomalyId, workType: WorkType, employeeId: EmployeeId = 'E01') {
  workAtPosition(sim, id, workType, employeeId);
  const profile = anomalyJson.anomalies.find(a => a.id === id)!.workProfiles.find(p => p.type === workType)!;
  ticks(sim, profile.durationSec);
}

