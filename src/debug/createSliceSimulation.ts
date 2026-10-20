import { Simulation } from '../simulation/engine';

/** 独立两人场景夹具，不读取/写入正式存档，不修改正式日初四人配置。 */
export function createSliceSimulation(): Simulation {
  const simulation = new Simulation();
  simulation.state.employees = simulation.state.employees.filter(employee => employee.id === 'E01' || employee.id === 'E02');
  for (const room of simulation.state.rooms) {
    if (room.anomalyId !== 'N01') room.mode = 'LOCKED';
  }
  simulation.state.progress.tutorialOfferHandled = true;
  simulation.state.logs[0].message = '两人调试场景：仅开放奶龙收容室，正式日1四人配置与存档保持。';
  simulation.command({ type: 'START_DAY', commandId: 'slice-start' });
  return simulation;
}
