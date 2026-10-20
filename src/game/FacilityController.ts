import type {
  AnomalyId, CastTarget, Command, EmployeeId, Result, SaveEnvelope, SkillId, WorkType,
} from '../../contracts/data-contract';
import { anomalyById, config, skillById } from '../data/config';
import { loadSave, writeSave } from '../save/storage';
import { Simulation } from '../simulation/engine';
import { createFacilitySimulation, type FacilityMode } from './createFacilitySimulation';

type WithoutId<T> = T extends unknown ? Omit<T, 'commandId'> : never;
export type FacilityCommand = WithoutId<Command>;
export type CommandWithoutId = FacilityCommand;
export type { FacilityMode };
export type FacilityStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface FacilityEvent {
  sequence: number;
  simulationTimeSec: number;
  type: 'COMMAND' | 'SELECT' | 'ROOM' | 'PAUSE' | 'DEBUG_BREACH' | 'MODE' | 'RESTART'
    | 'SKILL_AIM' | 'TUTORIAL' | 'SAVE' | 'LOAD' | 'NEXT_DAY';
  detail: unknown;
}

const success = (): Result<void> => ({ ok: true, value: undefined });

/**
 * 场景/HUD共用的输入入口。绘制不结算玩法；演练从不访问正式存档。
 * 正式模式只有显式保存/成功读档后才启用后续日初、通关边界自动保存。
 */
export class FacilityController {
  simulation: Simulation;
  readonly selected = new Set<EmployeeId>();
  selectedEnemyId: string | null = null;
  selectedRoomId: AnomalyId | null = 'N01';
  activeSkillId: SkillId | null = null;
  inputBlocked = false;
  readonly events: FacilityEvent[] = [];
  message: string;
  private sequence = 0;
  private currentMode: FacilityMode;
  private persistenceEnabled = false;

  constructor(mode: FacilityMode = 'campaign', private readonly storage?: FacilityStorage) {
    this.currentMode = mode;
    this.simulation = createFacilitySimulation(mode);
    this.message = this.modeMessage();
  }

  get mode(): FacilityMode { return this.currentMode; }
  get state() { return this.simulation.state; }
  notify(message: string): void { this.message = message; }

  private modeMessage(): string {
    return this.mode === 'sandbox'
      ? '先点医疗休整区的小人，再点收容室安排工作；右键走廊移动。五室演练不写正式存档。'
      : '正式流程：第一日四名员工。可显式读取存档，或开始新的三日流程。';
  }
  private record(type: FacilityEvent['type'], detail: unknown): void {
    this.events.push({ sequence: ++this.sequence, simulationTimeSec: this.state.simulationTimeSec, type, detail: structuredClone(detail) });
  }
  private fail(code: string, message: string): Result<void> {
    this.notify(message);
    return { ok: false, code, message };
  }
  private clearInput(): void {
    this.selected.clear();
    this.selectedEnemyId = null;
    this.selectedRoomId = 'N01';
    this.activeSkillId = null;
    this.inputBlocked = false;
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
  selectRoom(id: AnomalyId): void {
    if (!this.state.rooms.some(room => room.anomalyId === id)) return;
    this.selectedRoomId = id;
    this.record('ROOM', { anomalyId: id });
  }
  issue(command: FacilityCommand): Result<void> {
    // 保存的是不可变入口快照，不把班前购买或运行中的状态伪装成日初。
    if (command.type === 'START_DAY' && this.state.phase === 'DAY_PREP' && this.mode === 'campaign' && this.persistenceEnabled) {
      const saved = this.persist(this.envelope());
      if (!saved.ok) return saved;
    }
    const fullCommand = { ...command, commandId: `facility-input-${++this.sequence}` } as Command;
    const result = this.simulation.command(fullCommand);
    this.record('COMMAND', { command: fullCommand, result });
    if (!result.ok) { this.notify(result.message); return result; }
    if (command.type === 'RETRY_DAY') this.clearInput();
    if (command.type === 'FINISH_DAY') {
      this.activeSkillId = null;
      if (this.mode === 'campaign' && this.persistenceEnabled && this.state.phase === 'COMPLETE') {
        const saved = this.persist(this.envelope());
        if (!saved.ok) {
          this.notify(`第三日已完成，但完成标记保存失败。可再次点击保存：${saved.message}`);
          return saved;
        }
      }
    }
    this.notify(command.type === 'CAST_SKILL' ? '技能已生效。' : this.state.timeScale === 0 ? '命令已登记；恢复后执行。' : '命令已下达。');
    return result;
  }
  assignWork(type: WorkType, roomId = this.selectedRoomId): Result<void> {
    const employeeId = [...this.selected][0];
    if (!employeeId || this.selected.size !== 1) return this.fail('SELECTION', '工作只派遣一人，请在场景里单选一名员工。');
    if (!roomId) return this.fail('ROOM_SELECTION', '请先选择一间收容室。');
    return this.issue({ type: 'ASSIGN_WORK', employeeId, roomId, workType: type });
  }
  retreat(): Result<void> { return this.issue({ type: 'RETREAT', employeeIds: [...this.selected] }); }
  stop(): Result<void> { return this.issue({ type: 'STOP', employeeIds: [...this.selected] }); }
  togglePause(): void {
    const paused = this.state.timeScale !== 0;
    this.simulation.setPaused(paused);
    this.record('PAUSE', { paused });
    this.notify(paused ? '已暂停。可选择、改令；移动和动作冻结。' : this.state.timeScale === 0 ? '仍被教学或弹窗暂停；关闭对应面板后继续。' : '模拟已继续，执行当前命令。');
  }
  triggerBreach(id = this.selectedRoomId): Result<void> {
    if (this.mode !== 'sandbox') return this.fail('MODE', '主动失效按钮只用于五室演练；正式流程遵循压力和教学机制。');
    if (this.state.phase !== 'RUNNING') return this.fail('PHASE', '当前阶段不能触发演练失效。');
    const room = this.state.rooms.find(item => item.anomalyId === id);
    if (!room || room.mode !== 'CONTAINED') return this.fail('ROOM', '请选择仍在收容中的异常。');
    this.simulation.forceBreach(room.anomalyId, '五室演练：主管主动触发');
    this.record('DEBUG_BREACH', { anomalyId: room.anomalyId });
    this.notify(`${anomalyById[room.anomalyId].name}真实失效，工作已中断。首次事故暂停；选员工后右键敌人镇压。`);
    return success();
  }
  armSkill(id: SkillId): Result<void> {
    if (this.state.phase !== 'RUNNING') return this.fail('PHASE', '先开始工作，再使用技能。');
    if (!this.state.progress.unlockedSkills.includes(id)) return this.fail('LOCKED', '该技能尚未解锁。');
    if (this.state.skillCooldownRemainingSec[id] > 1e-7) return this.fail('COOLDOWN', config.localization['error.cooldown']);
    if (this.state.progress.wallet < skillById[id].energyCost) return this.fail('FUNDS', config.localization['error.notEnoughEnergy']);
    this.activeSkillId = id;
    this.record('SKILL_AIM', { skillId: id });
    if (skillById[id].target === 'ALL_ACTIVE_EMPLOYEES') return this.castAt({ kind: 'GLOBAL' });
    this.notify(`${skillById[id].name}：点击有效目标；右键或 Esc 取消瞄准。`);
    return success();
  }
  cancelSkill(): void {
    if (!this.activeSkillId) return;
    this.record('SKILL_AIM', { skillId: this.activeSkillId, cancelled: true });
    this.activeSkillId = null;
    this.notify('已取消技能瞄准，未消耗能量。');
  }
  castAt(target: CastTarget): Result<void> {
    if (!this.activeSkillId) return this.fail('SKILL_SELECTION', '请先选择技能。');
    const result = this.issue({ type: 'CAST_SKILL', skillId: this.activeSkillId, target });
    if (result.ok) this.activeSkillId = null;
    return result;
  }
  handleTutorial(accept: boolean): void {
    if (!this.state.tutorialPending) return;
    this.simulation.handleTutorial(accept);
    this.record('TUTORIAL', { accepted: accept });
    this.notify(accept ? '已接受教学失效；首次事故暂停，准备后继续。' : '已跳过教学失效，可继续正常派遣。');
  }
  setMode(mode: FacilityMode): void {
    if (mode === this.mode) return;
    this.currentMode = mode;
    this.simulation = createFacilitySimulation(mode);
    this.persistenceEnabled = false;
    this.clearInput();
    this.record('MODE', { mode });
    this.notify(this.modeMessage());
  }
  restart(): void {
    if (this.mode === 'campaign') {
      this.issue({ type: 'RETRY_DAY' });
      this.record('RESTART', { mode: this.mode, day: this.state.day });
      this.notify(`已恢复第${this.state.day}日日初快照；本日购买和产能已回退，之前各日进度保留。`);
      return;
    }
    this.simulation = createFacilitySimulation(this.mode);
    this.persistenceEnabled = false;
    this.clearInput();
    this.record('RESTART', { mode: this.mode });
    this.notify(this.modeMessage());
  }
  newCampaign(): void {
    this.currentMode = 'campaign';
    this.simulation = createFacilitySimulation('campaign');
    this.persistenceEnabled = false;
    this.clearInput();
    this.record('RESTART', { mode: 'campaign', newCampaign: true });
    this.notify('新一轮正式值班已准备：第一日四名员工。原存档仍保留，点击保存才会替换。');
  }
  nextDay(): Result<void> {
    if (this.mode !== 'campaign') return this.fail('MODE', '五室演练没有下一日；可重新开始演练。');
    // 在独立候选模拟上调用引擎的日切换，写盘成功后才替换可见场景。
    const candidate = new Simulation(this.simulation.snapshot(), this.simulation.options);
    candidate.state = structuredClone(this.state);
    candidate.pauseOnFirstBreach = this.simulation.pauseOnFirstBreach;
    const result = candidate.nextDay();
    if (!result.ok) { this.notify(result.message); return result; }
    if (this.persistenceEnabled) {
      const saved = this.persist({ snapshot: candidate.snapshot(), demoCompleted: false });
      if (!saved.ok) return saved;
    }
    this.simulation = candidate;
    this.clearInput();
    this.record('NEXT_DAY', { day: this.state.day });
    this.notify(`已进入第${this.state.day}日日初；开始工作前可调整装备。`);
    return success();
  }
  private envelope(): SaveEnvelope {
    return { snapshot: this.simulation.snapshot(), demoCompleted: this.state.phase === 'COMPLETE' };
  }
  private persist(envelope: SaveEnvelope): Result<void> {
    const result = writeSave(envelope, this.storage);
    this.record('SAVE', { day: envelope.snapshot.day, demoCompleted: envelope.demoCompleted, result });
    if (!result.ok) this.notify(result.message);
    return result;
  }
  saveCampaign(): Result<void> {
    if (this.mode !== 'campaign') return this.fail('MODE', '五室演练不读写正式存档。');
    const result = this.persist(this.envelope());
    if (result.ok) {
      this.persistenceEnabled = true;
      this.notify('已保存本日日初快照；读档会从日初重试，不保存日内位置、产能或消费。');
    }
    return result;
  }
  loadCampaign(): Result<void> {
    if (this.mode !== 'campaign') return this.fail('MODE', '请切换正式流程后再读取存档；五室演练不访问正式存档。');
    const result = loadSave(this.storage);
    this.record('LOAD', { result: result.ok ? { ok: true, exists: result.value !== null } : result });
    if (!result.ok) { this.notify(result.message); return result; }
    if (!result.value) return this.fail('NO_SAVE', '没有正式存档。当前场景保持不变。');
    const candidate = createFacilitySimulation('campaign', result.value.snapshot);
    if (result.value.demoCompleted) candidate.state.phase = 'COMPLETE';
    this.simulation = candidate;
    this.persistenceEnabled = true;
    this.clearInput();
    this.notify(result.value.demoCompleted ? '已读取三日完成标记。' : `已读取第${this.state.day}日日初快照，可从本日重新开始。`);
    return success();
  }
}
