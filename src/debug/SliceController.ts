import type { Command, EmployeeId, Result, WorkType } from '../../contracts/data-contract';
import { createSliceSimulation } from './createSliceSimulation';
import type { Simulation } from '../simulation/engine';

type WithoutId<T> = T extends unknown ? Omit<T, 'commandId'> : never;
export type SliceCommand = WithoutId<Command>;
export interface SliceEvent {
  sequence: number;
  simulationTimeSec: number;
  type: 'COMMAND' | 'SELECT' | 'PAUSE' | 'DEBUG_BREACH';
  detail: unknown;
}

/** 只转换用户输入。世界位置、计时、工作和战斗始终属于同一个 Simulation。 */
export class SliceController {
  readonly simulation: Simulation;
  readonly selected = new Set<EmployeeId>();
  selectedEnemyId: string | null = null;
  readonly events: SliceEvent[] = [];
  message = '点击场内员工，右键走廊移动；点击收容室派遣。';
  private sequence = 0;

  constructor(simulation = createSliceSimulation()) { this.simulation = simulation; }
  get state() { return this.simulation.state; }
  notify(message: string): void { this.message = message; }
  private record(type: SliceEvent['type'], detail: unknown): void {
    this.events.push({ sequence: ++this.sequence, simulationTimeSec: this.state.simulationTimeSec, type, detail });
  }
  select(ids: EmployeeId[], add = false): void {
    if (!add) this.selected.clear();
    for (const id of ids) {
      if (!this.state.employees.some(employee => employee.id === id)) continue;
      if (add && ids.length === 1 && this.selected.has(id)) this.selected.delete(id);
      else this.selected.add(id);
    }
    this.selectedEnemyId = null;
    this.record('SELECT', { ids: [...this.selected] });
  }
  issue(command: SliceCommand): Result<void> {
    const fullCommand = { ...command, commandId: `slice-input-${++this.sequence}` } as Command;
    const result = this.simulation.command(fullCommand);
    this.record('COMMAND', { command: fullCommand, result });
    if (!result.ok) this.notify(result.message);
    else this.notify(this.state.timeScale === 0 ? '命令已登记；恢复后执行。' : '命令已下达。');
    return result;
  }
  assignWork(type: WorkType): Result<void> {
    const employeeId = [...this.selected][0];
    if (!employeeId || this.selected.size !== 1) {
      const result = { ok: false as const, code: 'SELECTION', message: '工作只派遣一人，请在场景里单选一名员工。' };
      this.notify(result.message); return result;
    }
    return this.issue({ type: 'ASSIGN_WORK', employeeId, roomId: 'N01', workType: type });
  }
  retreat(): Result<void> { return this.issue({ type: 'RETREAT', employeeIds: [...this.selected] }); }
  stop(): Result<void> { return this.issue({ type: 'STOP', employeeIds: [...this.selected] }); }
  togglePause(): void {
    const paused = this.state.timeScale !== 0;
    this.simulation.setPaused(paused);
    this.record('PAUSE', { paused });
    this.notify(paused ? '已暂停。可选择、改令；移动和动作冻结。' : '模拟已继续，执行当前命令。');
  }
  triggerBreach(): void {
    const room = this.state.rooms.find(item => item.anomalyId === 'N01')!;
    if (room.mode !== 'CONTAINED') { this.notify('奶龙已失效或正在恢复。'); return; }
    this.record('DEBUG_BREACH', { anomalyId: 'N01', reason: '独立场景失效调试' });
    this.simulation.forceBreach('N01', '独立场景失效调试');
    this.notify('真实失效：一主两分身。首次事故暂停，空格继续；选员工后右键敌人镇压。');
  }
}
