import type {
  AnomalyId, ArmorId, CastTarget, Command, DamageSpec, DayEntrySnapshot, DayNumber,
  EmployeeId, EmployeeRuntime, EnemyRuntime, Location, Point, Result, RoomRuntime, SkillId, WeaponId, WorkRuntime, WorkType,
} from '../../contracts/data-contract';
import { config, anomalyById, armorById, dayByNumber, skillById, weaponById } from '../data/config';
import { resolveEmployeeDamage, resolveEnemyDamage } from './damage';
import { distance } from './path';
import { legacyNavigation, type AmbientConfig, type Navigation } from './navigation';
import { copy, freshMemory, makeSnapshot, makeState, type RuntimeState } from './state';
export type { RuntimeState } from './state';

const ok = (): Result<void> => ({ ok: true, value: undefined });
const error = (code: string, message: string): Result<void> => ({ ok: false, code, message });
const epsilon = 1e-7;
const allOne = { RED: 1, WHITE: 1, BLACK: 1, PALE: 1 };
const cfg = config.game;
export interface SimulationOptions {
  navigation?: Navigation;
  ambient?: AmbientConfig;
}
interface AmbientPlan {
  active: boolean;
  hold: boolean;
  needsFullRecovery: boolean;
  nextAtSec: number;
  cycle: number;
}

/** 纯模拟内核。浏览器只传命令和帧间隔，任何收入/伤害均由固定步推进。 */
export class Simulation {
  state: RuntimeState;
  pauseOnFirstBreach = cfg.simulation.pauseOnFirstBreachPerDay;
  private panelPauses = new Set<string>();
  private manualPause = false;
  private speed: 1 | 2 = 1;
  private accumulator = 0;
  private sequence = 0;
  private commandResults = new Map<string, Result<void>>();
  private patrolDirections = new Map<string, number>();
  private spent = 0;
  private breaches = 0;
  private skillUses = 0;
  private ambientPlans = new Map<EmployeeId, AmbientPlan>();
  private meetingLandings = new Map<string, { point: Location; employeeId: EmployeeId }>();
  readonly navigation: Navigation;

  constructor(snapshot?: DayEntrySnapshot, readonly options: SimulationOptions = {}) {
    this.navigation = options.navigation ?? legacyNavigation;
    const spawn = this.navigation.locate(this.navigation.safePoint);
    if (!spawn || spawn.zone !== 'SAFE') throw new Error('Navigation safePoint must be a reachable safe location.');
    this.state = makeState(snapshot, spawn);
    this.log('DAY', `第${this.state.day}日准备：${dayByNumber[this.state.day].briefing}`);
  }
  private id(prefix: string): string { return `${prefix}-${++this.sequence}`; }
  private log(kind: string, message: string): void {
    this.state.logs.push({ id: this.id('event'), timeSec: this.state.simulationTimeSec, kind, message });
  }
  private room(id: AnomalyId): RoomRuntime { return this.state.rooms.find(r => r.anomalyId === id)!; }
  private employee(id: EmployeeId): EmployeeRuntime | undefined { return this.state.employees.find(e => e.id === id); }
  private syncPause(): void { this.state.timeScale = this.manualPause || this.panelPauses.size > 0 || this.state.tutorialPending ? 0 : this.speed; this.accumulator = 0; }
  setPaused(paused: boolean): void { this.manualPause = paused; this.syncPause(); }
  setSpeed(speed: 1 | 2): void { this.speed = speed; this.syncPause(); }
  setPanelPaused(key: string, paused: boolean): void { if (paused) this.panelPauses.add(key); else this.panelPauses.delete(key); this.syncPause(); }
  snapshot(): DayEntrySnapshot { return copy(this.state.entrySnapshot); }

  advance(deltaSec: number): void {
    if (this.state.phase !== 'RUNNING' || this.state.timeScale === 0 || !Number.isFinite(deltaSec) || deltaSec < 0) { this.accumulator = 0; return; }
    const dt = cfg.simulation.fixedStepSec;
    this.accumulator += deltaSec * this.state.timeScale;
    let count = 0;
    while (this.accumulator + epsilon >= dt && count < cfg.simulation.maxCatchupTicksPerFrame) {
      this.accumulator = Math.max(0, this.accumulator - dt);
      this.step(); count++;
      if (Number(this.state.timeScale) === 0 || this.state.phase !== 'RUNNING') { this.accumulator = 0; break; }
    }
    if (count >= cfg.simulation.maxCatchupTicksPerFrame && this.accumulator + epsilon >= dt) this.accumulator = 0;
  }

  command(command: Command): Result<void> {
    const previous = this.commandResults.get(command.commandId);
    if (previous) return previous;
    const result = this.execute(command);
    this.state.processedCommandIds.add(command.commandId);
    this.commandResults.set(command.commandId, result);
    if (!result.ok) this.log('ERROR', `[${command.commandId}] ${result.message}`);
    return result;
  }

  private execute(c: Command): Result<void> {
    const s = this.state;
    if (c.type === 'RETRY_DAY') { this.retryDay(); return ok(); }
    if (c.type === 'START_DAY') {
      if (s.phase !== 'DAY_PREP') return error('PHASE', '当前不能开始工作。');
      s.phase = 'RUNNING'; this.log('DAY', '本日工作开始；工作需要手动派遣。'); return ok();
    }
    if (c.type === 'FINISH_DAY') return this.finishDay();
    if (s.phase !== 'RUNNING' && s.phase !== 'DAY_PREP') return error('PHASE', '当前阶段不能执行此操作。');
    if (c.type === 'PURCHASE') return this.purchase(c.anomalyId, c.item);
    if (c.type === 'EQUIP_WEAPON') return this.equip(c.employeeId, c.weaponId, 'weaponId');
    if (c.type === 'EQUIP_ARMOR') return this.equip(c.employeeId, c.armorId, 'armorId');
    if (s.phase !== 'RUNNING') return error('PHASE', '先点击开始工作，再派遣或施放技能。');
    if (c.type === 'CAST_SKILL') return this.cast(c.skillId, c.target);
    if (c.type === 'ASSIGN_WORK') {
      const e = this.employee(c.employeeId), r = this.room(c.roomId);
      if (!e || !this.controllable(e)) return error('EMPLOYEE', config.localization['error.employeeUnavailable']);
      if (!r || r.mode !== 'CONTAINED') return error('ROOM', config.localization['error.roomUnavailable']);
      if (r.work) return error('BUSY', config.localization['error.roomBusy']);
      if (!anomalyById[c.roomId].workProfiles.some(p => p.type === c.workType)) return error('WORK', '未知工作类型。');
      const path = this.navigation.route(e.location, this.navigation.workPoint(c.roomId));
      if (path === null) return error('PATH', '员工当前位置无法到达该工作位。');
      this.cancelEmployeeOrder(e, false, '主动改派');
      const work: WorkRuntime = { workId: this.id('work'), employeeId: e.id, roomId: r.anomalyId, type: c.workType, phase: 'TRAVELLING', elapsedSec: 0, rapidRestart: false };
      r.work = work; e.order = { kind: 'WORK', roomId: r.anomalyId, workId: work.workId };
      e.path = path;
      e.status = 'MOVING';
      this.log('ORDER', `${e.displayName} → ${r.anomalyId} ${config.localization[`work.${c.workType}`]}，已预约，抵达后开始计时。`);
      return ok();
    }
    const ids = c.employeeIds;
    const employees = ids.map(id => this.employee(id));
    if (!employees.length || employees.some(e => !e || !this.controllable(e))) return error('EMPLOYEE', config.localization['error.employeeUnavailable']);
    if (c.type === 'MOVE' && !this.navigation.corridorAt(c.point)) return error('LOCATION', '移动目标需要在可通行的走廊内。');
    if (c.type === 'SUPPRESS' && !s.enemies.some(e => e.id === c.enemyId)) return error('TARGET', '目标已不在现场。');
    const destination = c.type === 'MOVE' ? c.point : c.type === 'RETREAT' ? this.navigation.safePoint : null;
    if (destination && employees.some(e => e && this.navigation.route(e.location, destination) === null)) return error('PATH', '选中员工无法到达目标位置。');
    for (const e of employees as EmployeeRuntime[]) {
      this.cancelEmployeeOrder(e, false, '主动改令');
      if (c.type === 'RETREAT') this.retreat(e);
      if (c.type === 'MOVE') { e.order = { kind: 'MOVE', destination: { ...c.point } }; e.path = this.navigation.route(e.location, c.point)!; e.status = 'MOVING'; }
      if (c.type === 'SUPPRESS') { e.order = { kind: 'SUPPRESS', enemyId: c.enemyId }; e.status = 'SUPPRESSING'; }
      if (c.type === 'STOP') this.ambientPlan(e).hold = true;
    }
    return ok();
  }

  private controllable(e: EmployeeRuntime): boolean { return e.status !== 'PANICKED' && e.status !== 'INCAPACITATED'; }
  private cancelAttack(e: EmployeeRuntime | EnemyRuntime): void { e.windupEndsAtSec = null; e.attackPhase = 'RECOVERY'; }
  private retreat(e: EmployeeRuntime): void {
    e.order = { kind: 'RETREAT' }; e.path = this.navigation.route(e.location, this.navigation.safePoint) ?? [];
    const plan = this.ambientPlan(e);
    plan.active = false; plan.hold = false; plan.needsFullRecovery = true;
    if (e.status !== 'PANICKED') e.status = e.path.length ? 'MOVING' : 'IDLE';
  }
  private cancelEmployeeOrder(e: EmployeeRuntime, emergency: boolean, reason: string): void {
    for (const [enemyId, meeting] of this.meetingLandings) if (meeting.employeeId === e.id) this.meetingLandings.delete(enemyId);
    const r = this.state.rooms.find(room => room.work?.employeeId === e.id);
    if (r?.work) this.releaseWork(r, emergency, reason);
    this.cancelAttack(e); e.path = []; e.order = { kind: 'IDLE' };
    const plan = this.ambientPlan(e);
    plan.active = false; plan.hold = false; plan.needsFullRecovery = false;
    plan.nextAtSec = this.state.simulationTimeSec + this.ambientDelay(e, plan.cycle);
    if (this.controllable(e)) e.status = 'IDLE';
  }
  private releaseWork(r: RoomRuntime, emergency: boolean, reason: string): void {
    const work = r.work;
    if (!work) return;
    r.work = null;
    if (anomalyById[r.anomalyId].specialWorkRule.kind === 'REPEAT_WORKER') r.memory.idleElapsedSec = 0;
    if (emergency && r.mode === 'CONTAINED') r.pressure = Math.min(cfg.pressure.breachThreshold, r.pressure + cfg.work.emergencyInterruptPressure);
    const e = this.employee(work.employeeId);
    if (e) {
      e.order = { kind: 'IDLE' }; e.path = []; this.cancelAttack(e);
      if (this.controllable(e)) {
        if (e.location.zone === 'ROOM') {
          const destination = this.navigation.doorPoint(r.anomalyId);
          e.order = { kind: 'MOVE', destination }; e.path = this.navigation.route(e.location, destination) ?? []; e.status = 'MOVING';
        } else e.status = 'IDLE';
      }
    }
    if (reason !== '工作完成') this.log('INTERRUPT', `${r.anomalyId} ${work.workId}：${reason}，本次未入账${emergency && r.mode === 'CONTAINED' ? `，紧急压力+${cfg.work.emergencyInterruptPressure}` : ''}。`);
  }

  damageEmployee(id: EmployeeId, damage: DamageSpec): void {
    const e = this.employee(id);
    if (!e || e.status === 'INCAPACITATED') return;
    const result = resolveEmployeeDamage(e.hp, e.sp, e.hpMax, damage, armorById[e.armorId].resistances);
    e.hp = result.hp; e.sp = result.sp;
    this.log('HIT', `${e.displayName} 受到${config.localization[`damage.${damage.type}`]}，HP ${e.hp.toFixed(1)} / SP ${e.sp.toFixed(1)}。`);
    this.checkEmployee(e);
  }
  private checkEmployee(e: EmployeeRuntime): void {
    if (e.hp <= epsilon) {
      if (e.status !== 'INCAPACITATED') {
        this.cancelEmployeeOrder(e, true, '员工重伤'); e.hp = 0; e.status = 'INCAPACITATED'; e.order = { kind: 'IDLE' }; e.path = [];
        this.log('INCAPACITATED', `${e.displayName} 重伤，本日离场，装备保留。`);
      }
    } else if (e.sp <= cfg.employee.panicAtSp + epsilon && e.status !== 'PANICKED') {
      this.cancelEmployeeOrder(e, true, '员工精神归零'); e.sp = 0; e.status = 'PANICKED'; this.retreat(e);
      this.log('PANIC', `${e.displayName} 惊慌，撤往安全室。`);
    } else if (e.status === 'PANICKED' && e.sp + epsilon >= e.spMax * cfg.employee.panicRecoverFraction) {
      e.status = e.location.zone === 'SAFE' ? 'IDLE' : 'MOVING';
      if (e.location.zone === 'SAFE') { e.order = { kind: 'IDLE' }; e.path = []; }
      this.log('RECOVER', `${e.displayName} 恢复控制。`);
    }
  }
  damageEnemy(id: string, damage: DamageSpec): void {
    const enemy = this.state.enemies.find(e => e.id === id);
    if (!enemy) return;
    const loss = resolveEnemyDamage(enemy.suppressionHpMax, damage, enemy.isClone ? allOne : anomalyById[enemy.sourceAnomalyId].resistances);
    enemy.suppressionHp = Math.max(0, enemy.suppressionHp - loss);
    this.log('HIT', `${enemy.sourceAnomalyId} ${enemy.isClone ? '分身' : '主样本'} 镇压值 −${loss.toFixed(1)}。`);
    if (enemy.suppressionHp <= epsilon) {
      if (enemy.isClone) { this.state.enemies = this.state.enemies.filter(e => e.id !== id); this.log('SUPPRESS', `${enemy.sourceAnomalyId} 分身清除，无能量掉落。`); }
      else {
        this.state.enemies = this.state.enemies.filter(e => e.breachInstanceId !== enemy.breachInstanceId);
        const room = this.room(enemy.sourceAnomalyId);
        room.mode = 'RECOVERING'; room.recoveryRemainingSec = cfg.pressure.recoverySec; room.mainEnemyId = null; room.breachInstanceId = null;
        this.log('SUPPRESS', `${room.anomalyId} 主样本镇压完成，分身已清除；恢复${cfg.pressure.recoverySec}秒，期间不产能。`);
      }
      this.clearLostTargets();
    }
  }

  forceBreach(id: AnomalyId, reason = '测试夹具触发'): void {
    const room = this.room(id);
    if (!room || room.mode !== 'CONTAINED') return;
    room.pressure = cfg.pressure.breachThreshold;
    this.enterBreach(room, reason);
    this.resolveThresholds();
  }
  private enterBreach(room: RoomRuntime, reason: string): void {
    if (room.mode !== 'CONTAINED') return;
    room.mode = 'BREACHED'; this.releaseWork(room, false, '收容失效');
    for (const e of this.state.employees) {
      const ambient = this.ambientPlans.get(e.id);
      if (ambient?.active) { ambient.active = false; e.path = []; e.status = 'IDLE'; }
    }
    const a = anomalyById[room.anomalyId], b = a.breach, now = this.state.simulationTimeSec;
    const breachId = this.id('breach'), mainId = this.id('enemy');
    room.breachInstanceId = breachId; room.mainEnemyId = mainId; this.breaches++;
    const create = (id: string, clone: boolean): EnemyRuntime => ({
      id, sourceAnomalyId: a.id, breachInstanceId: breachId, isClone: clone, mainEnemyId: clone ? mainId : null,
      location: this.navigation.locate(this.navigation.doorPoint(a.id))!,
      suppressionHp: clone ? b.cloneHp! : b.suppressionHpMax, suppressionHpMax: clone ? b.cloneHp! : b.suppressionHpMax,
      targetEmployeeId: null, attackPhase: 'RECOVERY', nextAttackStartAtSec: now + Math.max(cfg.combat.breachSpawnGraceSec, b.firstAttackDelaySec), windupEndsAtSec: null, stunnedUntilSec: 0, pendingForcedHowl: false,
    });
    this.state.enemies.push(create(mainId, false));
    for (let i = 0; i < (b.cloneCount ?? 0); i++) this.state.enemies.push(create(this.id('clone'), true));
    this.log('BREACH', `${a.id} ${a.name}失效：${reason}；停止产能，事件 ${breachId}。`);
    if (!this.state.firstBreachOccurred) { this.state.firstBreachOccurred = true; if (this.pauseOnFirstBreach) this.setPaused(true); }
    for (const link of config.anomalyData.links.filter(l => l.sourceAnomalyId === room.anomalyId)) {
      const key = `${breachId}:${link.id}`;
      if (this.state.processedLinkEventIds.has(key)) continue;
      this.state.processedLinkEventIds.add(key);
      const target = this.room(link.targetAnomalyId);
      if (target.mode === 'CONTAINED') {
        const old = target.pressure;
        target.pressure = Math.min(cfg.pressure.breachThreshold, old + link.ifTargetContained.pressureAdd);
        this.log('LINK', `${a.name}失效 → ${anomalyById[target.anomalyId].name}压力 ${old.toFixed(1)}→${target.pressure.toFixed(1)}。`);
      } else if (target.mode === 'BREACHED') {
        const enemy = this.state.enemies.find(e => e.id === target.mainEnemyId);
        if (enemy && enemy.windupEndsAtSec === null) enemy.pendingForcedHowl = true;
        this.log('LINK', `${a.name}失效 → 大狗请求一次吠叫（已有前摇不叠加）。`);
      } else this.log('LINK', `${a.name}失效 → 大狗${target.mode === 'LOCKED' ? '未开放' : '恢复中'}，忽略联动。`);
    }
  }
  private resolveThresholds(): void {
    let pending = this.state.rooms.filter(r => r.mode === 'CONTAINED' && r.pressure + epsilon >= cfg.pressure.breachThreshold);
    while (pending.length) {
      pending.sort((a, b) => a.anomalyId.localeCompare(b.anomalyId));
      for (const r of pending) this.enterBreach(r, '压力达到阈值，本次不产能');
      pending = this.state.rooms.filter(r => r.mode === 'CONTAINED' && r.pressure + epsilon >= cfg.pressure.breachThreshold);
    }
  }

  private ambientPlan(e: EmployeeRuntime): AmbientPlan {
    let plan = this.ambientPlans.get(e.id);
    if (!plan) {
      plan = { active: false, hold: false, needsFullRecovery: false, nextAtSec: this.state.simulationTimeSec + this.ambientDelay(e, 0), cycle: 0 };
      this.ambientPlans.set(e.id, plan);
    }
    return plan;
  }
  private ambientDelay(e: EmployeeRuntime, cycle: number): number {
    const cfg = this.options.ambient;
    if (!cfg) return Infinity;
    const fraction = ((Number(e.id.slice(1)) * 31 + cycle * 17) % 101) / 100;
    return cfg.waitMinSec + (cfg.waitMaxSec - cfg.waitMinSec) * fraction;
  }
  private updateAmbient(e: EmployeeRuntime): void {
    if (!this.options.ambient || !this.navigation.idlePoints.length) return;
    const plan = this.ambientPlan(e), now = this.state.simulationTimeSec;
    const incident = this.state.enemies.length > 0 || this.state.rooms.some(room => room.mode === 'BREACHED' || room.mode === 'RECOVERING');
    if (incident) {
      if (plan.active) { e.path = []; e.status = 'IDLE'; plan.active = false; }
      plan.nextAtSec = now + this.ambientDelay(e, plan.cycle);
      return;
    }
    if (plan.active && !e.path.length) {
      plan.active = false; e.status = 'IDLE';
      plan.nextAtSec = now + this.ambientDelay(e, ++plan.cycle);
    }
    if (plan.active || plan.hold || e.order.kind !== 'IDLE' || e.status !== 'IDLE') return;
    if (plan.needsFullRecovery) {
      if (e.location.zone !== 'SAFE' || e.hp < e.hpMax - epsilon || e.sp < e.spMax - epsilon || e.safeStayElapsedSec < cfg.employee.safeRecoveryDelaySec) return;
      plan.needsFullRecovery = false;
      plan.nextAtSec = now + this.ambientDelay(e, plan.cycle);
    }
    if (now + epsilon < plan.nextAtSec) return;
    const points = this.navigation.idlePoints;
    const start = (Number(e.id.slice(1)) * 7 + plan.cycle * 11) % points.length;
    for (let index = 0; index < points.length; index++) {
      const target = points[(start + index) % points.length];
      const path = this.navigation.route(e.location, target);
      if (path?.length) {
        e.path = path; e.status = 'MOVING'; plan.active = true;
        return;
      }
    }
    plan.nextAtSec = now + this.ambientDelay(e, ++plan.cycle);
  }
  private advancePath(location: Location, path: Point[], budget: number): Location {
    let current = location;
    while (path.length && budget > epsilon) {
      const next = path[0], length = distance(current, next);
      if (length <= budget + epsilon) {
        current = this.navigation.locate(next, current, next) ?? current;
        path.shift(); budget -= length;
      } else {
        const point = { x: current.x + (next.x - current.x) / length * budget, y: current.y + (next.y - current.y) / length * budget };
        current = this.navigation.locate(point, current, next) ?? current;
        budget = 0;
      }
    }
    return current;
  }
  private meetingLanding(enemy: EnemyRuntime): Location | null {
    const meeting = this.meetingLandings.get(enemy.id);
    if (!meeting) return null;
    const employee = this.employee(meeting.employeeId);
    if (!employee || !this.controllable(employee) || employee.order.kind !== 'SUPPRESS' || employee.order.enemyId !== enemy.id
      || Number.isFinite(this.navigation.combatDistance(employee.location, enemy.location))) {
      this.meetingLandings.delete(enemy.id);
      return null;
    }
    return meeting.point;
  }
  private approachPoint(employee: EmployeeRuntime, enemy: EnemyRuntime, range: number): Point {
    let landing = this.meetingLanding(enemy);
    if (!landing && enemy.location.zone === 'TRANSIT') {
      landing = this.navigation.nearestCorridor(enemy.location);
      if (landing) this.meetingLandings.set(enemy.id, { point: landing, employeeId: employee.id });
    }
    // Both participants finish the real connector traversal before taking combat positions.
    // Keeping this anchor avoids an opposing pair chasing each other's moving stair position.
    if (landing) return landing;
    const candidates = [this.navigation.knockback(enemy.location, -range), this.navigation.knockback(enemy.location, range)];
    candidates.sort((a, b) => this.navigation.travelDistance(employee.location, a) - this.navigation.travelDistance(employee.location, b));
    return candidates[0];
  }
  private moveEmployee(e: EmployeeRuntime, dt: number): void {
    const buff = config.skills.find(s => s.effect === 'MOVE_SPEED_BUFF');
    const stroll = this.ambientPlans.get(e.id)?.active ? this.options.ambient?.speedMultiplier ?? 1 : 1;
    const budget = cfg.employee.moveSpeedPxPerSec * dt * stroll * (e.moveBuffRemainingSec > epsilon && buff?.effect === 'MOVE_SPEED_BUFF' ? buff.moveSpeedMultiplier : 1);
    e.location = this.advancePath(e.location, e.path, budget);
  }
  private updateEmployees(dt: number): void {
    for (const e of this.state.employees) {
      if (e.status === 'INCAPACITATED') continue;
      this.updateAmbient(e);
      if (e.order.kind === 'SUPPRESS') {
        const enemy = this.state.enemies.find(n => n.id === (e.order.kind === 'SUPPRESS' ? e.order.enemyId : ''));
        if (!enemy) { e.order = { kind: 'IDLE' }; e.status = 'IDLE'; e.path = []; this.cancelAttack(e); }
        else if (e.windupEndsAtSec === null) {
          const weapon = weaponById[e.weaponId];
          if (this.navigation.combatDistance(e.location, enemy.location) <= weapon.rangePx + epsilon) e.path = [];
          else e.path = this.navigation.route(e.location, this.approachPoint(e, enemy, weapon.rangePx)) ?? [];
        }
      }
      const wasSafe = e.location.zone === 'SAFE';
      this.moveEmployee(e, dt);
      e.moveBuffRemainingSec = Math.max(0, e.moveBuffRemainingSec - dt);
      if (!e.path.length) {
        if (e.order.kind === 'WORK') {
          const room = this.room(e.order.roomId), work = room.work;
          if (work?.workId === e.order.workId && work.phase === 'TRAVELLING') {
            work.phase = 'EXECUTING'; e.status = 'WORKING';
            const rule = anomalyById[room.anomalyId].specialWorkRule;
            work.rapidRestart = rule.kind === 'RAPID_RESTART' && room.memory.lastCompletedAtSec !== null && this.state.simulationTimeSec - room.memory.lastCompletedAtSec < rule.gapSec - epsilon;
            if (rule.kind === 'REPEAT_WORKER') room.memory.idleElapsedSec = 0;
            this.log('WORK', `${room.anomalyId} ${e.displayName} 已到位，开始${config.localization[`work.${work.type}`]}。`);
          }
        } else if (e.order.kind === 'MOVE' || e.order.kind === 'RETREAT') {
          if (e.status !== 'PANICKED') {
            e.order = { kind: 'IDLE' }; e.status = 'IDLE';
            const plan = this.ambientPlan(e);
            plan.nextAtSec = this.state.simulationTimeSec + this.ambientDelay(e, plan.cycle);
          }
        }
      }
      if (e.location.zone === 'SAFE') {
        const old = wasSafe ? e.safeStayElapsedSec : 0;
        e.safeStayElapsedSec = old + (wasSafe ? dt : 0);
        const active = Math.max(0, e.safeStayElapsedSec - cfg.employee.safeRecoveryDelaySec) - Math.max(0, old - cfg.employee.safeRecoveryDelaySec);
        e.hp = Math.min(e.hpMax, e.hp + active * cfg.employee.safeHpPerSec);
        e.sp = Math.min(e.spMax, e.sp + active * cfg.employee.safeSpPerSec);
        this.checkEmployee(e);
      } else e.safeStayElapsedSec = 0;
    }
  }
  private clearLostTargets(): void {
    for (const e of this.state.employees) if (e.order.kind === 'SUPPRESS' && !this.state.enemies.some(n => e.order.kind === 'SUPPRESS' && n.id === e.order.enemyId)) {
      e.order = { kind: 'IDLE' }; e.status = 'IDLE'; e.path = []; this.cancelAttack(e);
    }
  }
  private employeeAttacks(): void {
    const now = this.state.simulationTimeSec;
    for (const e of this.state.employees) {
      if (e.order.kind !== 'SUPPRESS' || !this.controllable(e)) continue;
      const enemy = this.state.enemies.find(n => e.order.kind === 'SUPPRESS' && n.id === e.order.enemyId);
      if (!enemy) continue;
      const weapon = weaponById[e.weaponId];
      if (e.windupEndsAtSec !== null && now + epsilon >= e.windupEndsAtSec) {
        this.cancelAttack(e);
        if (this.navigation.combatDistance(e.location, enemy.location) <= weapon.rangePx + epsilon) this.damageEnemy(enemy.id, weapon.damage);
      } else if (e.windupEndsAtSec === null && now + epsilon >= e.nextAttackStartAtSec && this.navigation.combatDistance(e.location, enemy.location) <= weapon.rangePx + epsilon) {
        e.attackPhase = 'WINDUP'; e.windupEndsAtSec = now + weapon.windupSec; e.nextAttackStartAtSec = now + weapon.attackPeriodSec;
      }
    }
  }
  private enemyPeriod(enemy: EnemyRuntime): number { const b = anomalyById[enemy.sourceAnomalyId].breach; return enemy.isClone ? b.cloneAttackPeriodSec! : b.attackPeriodSec; }
  private enemyAttacks(dt: number): void {
    const now = this.state.simulationTimeSec;
    for (const enemy of [...this.state.enemies]) {
      if (!this.state.enemies.includes(enemy) || enemy.stunnedUntilSec > now + epsilon) continue;
      const b = anomalyById[enemy.sourceAnomalyId].breach;
      // Stair travel remains a chase target, but combatDistance forbids attacks between landings.
      const candidates = this.state.employees.filter(e => e.status !== 'INCAPACITATED'
        && (e.location.zone === 'CORRIDOR' || e.location.zone === 'TRANSIT'));
      let target = candidates.find(e => e.id === enemy.targetEmployeeId);
      // 已开始的单体前摇不能临时转嫁给另一名员工；原目标离开则本次落空。
      if (!target && enemy.windupEndsAtSec === null) { target = candidates.sort((a, z) => this.navigation.travelDistance(enemy.location, a.location) - this.navigation.travelDistance(enemy.location, z.location) || a.id.localeCompare(z.id))[0]; enemy.targetEmployeeId = target?.id ?? null; }
      if (enemy.windupEndsAtSec !== null) {
        if (now + epsilon >= enemy.windupEndsAtSec) {
          this.cancelAttack(enemy);
          const targets = b.ai === 'STATIONARY_BROADCAST'
            ? this.state.employees.filter(e => e.status !== 'INCAPACITATED' && e.location.zone !== 'SAFE')
            : b.ai === 'CHASE'
              ? candidates.filter(e => e.id === enemy.targetEmployeeId && this.navigation.combatDistance(e.location, enemy.location) <= b.attackRangePx + epsilon)
              : candidates.filter(e => this.navigation.combatDistance(e.location, enemy.location) <= b.attackRangePx + epsilon);
          for (const e of targets) {
            this.damageEmployee(e.id, enemy.isClone ? b.cloneDamage! : b.damage);
            if (b.interruptWork) {
              const room = this.state.rooms.find(r => r.work?.employeeId === e.id && r.work.phase === 'EXECUTING');
              if (room) this.releaseWork(room, true, '广播中断');
            }
            if (b.knockbackPx && e.status !== 'INCAPACITATED') {
              e.location = this.navigation.knockback(e.location, (e.location.x >= enemy.location.x ? 1 : -1) * b.knockbackPx);
              if (e.order.kind === 'RETREAT') e.path = this.navigation.route(e.location, this.navigation.safePoint) ?? [];
              else if (e.order.kind === 'MOVE') e.path = this.navigation.route(e.location, e.order.destination) ?? [];
              else if (e.order.kind === 'WORK') e.path = this.navigation.route(e.location, this.navigation.workPoint(e.order.roomId)) ?? [];
            }
          }
          if (b.ai === 'STATIONARY_BROADCAST') this.log('BROADCAST', 'N04 广播命中：安全室外黑伤与工作中断。');
        }
        continue;
      }
      const forced = enemy.pendingForcedHowl;
      const inRange = target && this.navigation.combatDistance(target.location, enemy.location) <= b.attackRangePx + epsilon;
      const canAttack = b.ai === 'STATIONARY_BROADCAST' || b.ai === 'PATROL_AOE' || inRange;
      if ((forced || now + epsilon >= enemy.nextAttackStartAtSec) && (forced || canAttack)) {
        enemy.pendingForcedHowl = false; enemy.attackPhase = 'WINDUP'; enemy.windupEndsAtSec = now + b.windupSec; enemy.nextAttackStartAtSec = now + this.enemyPeriod(enemy);
        this.log('WINDUP', `${enemy.sourceAnomalyId} ${enemy.isClone ? '分身' : '主样本'} 蓄力 ${b.windupSec}秒。`);
        continue;
      }
      const speed = enemy.isClone ? b.cloneSpeedPxPerSec! : b.moveSpeedPxPerSec;
      const meeting = this.meetingLanding(enemy);
      if (meeting && b.ai !== 'STATIONARY_BROADCAST') {
        const path = this.navigation.route(enemy.location, meeting);
        if (path) enemy.location = this.advancePath(enemy.location, path, speed * dt);
      } else if (b.ai === 'PATROL_AOE') {
        const points = this.navigation.patrolPoints;
        let index = this.patrolDirections.get(enemy.id) ?? 0;
        if (points.length) {
          if (distance(enemy.location, points[index]) < epsilon) index = (index + 1) % points.length;
          const path = this.navigation.route(enemy.location, points[index]);
          if (path) enemy.location = this.advancePath(enemy.location, path, speed * dt);
          this.patrolDirections.set(enemy.id, index);
        }
      } else if (b.ai !== 'STATIONARY_BROADCAST' && target && !inRange) {
        const path = this.navigation.route(enemy.location, target.location);
        if (path) enemy.location = this.advancePath(enemy.location, path, speed * dt);
      }
    }
  }

  private specialPressure(r: RoomRuntime, w: WorkRuntime): { amount: number; reason: string } {
    const rule = anomalyById[r.anomalyId].specialWorkRule, m = r.memory;
    let amount = 0, reason = '';
    if (rule.kind === 'REPEAT_INTERACT' && w.type === 'INTERACT' && m.lastCompletedWorkType === 'INTERACT') { amount = rule.extraPressure; reason = '连续互动'; }
    if (rule.kind === 'REPEAT_WORKER' && m.lastCompletedEmployeeId === w.employeeId) { amount = rule.extraPressure; reason = '相同员工'; }
    if (rule.kind === 'RAPID_RESTART' && w.rapidRestart) { amount = rule.extraPressure; reason = '工作间隔过短'; }
    if (rule.kind === 'NON_SOOTHE_STREAK') {
      m.nonSootheCount = w.type === 'SOOTHE' ? 0 : m.nonSootheCount + 1;
      if (m.nonSootheCount >= rule.threshold) { amount = rule.extraPressure; reason = '三次非安抚'; m.nonSootheCount = 0; }
    }
    m.lastCompletedWorkType = w.type; m.lastCompletedEmployeeId = w.employeeId; m.lastCompletedAtSec = this.state.simulationTimeSec;
    if (rule.kind === 'NEGLECT' || rule.kind === 'REPEAT_WORKER') m.idleElapsedSec = 0;
    return { amount, reason };
  }

  step(): void {
    if (this.state.phase !== 'RUNNING' || this.state.timeScale === 0) return;
    const s = this.state, dt = cfg.simulation.fixedStepSec;
    s.simulationTimeSec += dt;
    // 记住本步开始时已在执行的工作，刚抵达不偷算一整步工作时长。
    const executing = new Set(s.rooms.filter(r => r.work?.phase === 'EXECUTING').map(r => r.work!.workId));
    const recovering = new Set(s.rooms.filter(r => r.mode === 'RECOVERING').map(r => r.anomalyId));
    for (const skill of config.skills) s.skillCooldownRemainingSec[skill.id] = Math.max(0, s.skillCooldownRemainingSec[skill.id] - dt);
    this.updateEmployees(dt);
    for (const r of s.rooms) {
      if (r.mode !== 'CONTAINED') continue;
      if (r.work?.phase === 'EXECUTING') { if (executing.has(r.work.workId)) r.work.elapsedSec += dt; }
      else {
        const rule = anomalyById[r.anomalyId].specialWorkRule, old = r.memory.idleElapsedSec;
        r.memory.idleElapsedSec += dt;
        if (rule.kind === 'REPEAT_WORKER' && r.memory.idleElapsedSec + epsilon >= rule.clearAfterIdleSec) r.memory.lastCompletedEmployeeId = null;
        if (rule.kind === 'NEGLECT') r.pressure = Math.min(cfg.pressure.breachThreshold, r.pressure + rule.pressurePerSecAfterGrace * (Math.max(0, r.memory.idleElapsedSec - rule.idleGraceSec) - Math.max(0, old - rule.idleGraceSec)));
      }
    }
    this.employeeAttacks();
    this.enemyAttacks(dt);
    // 两阶段提交：所有损伤/压力/联动处理完后，仍然有效的工作才入账。
    const candidates: Array<{ room: RoomRuntime; work: WorkRuntime; energy: number }> = [];
    for (const r of s.rooms) {
      const w = r.work;
      if (r.mode !== 'CONTAINED' || !w || w.phase !== 'EXECUTING') continue;
      const profile = anomalyById[r.anomalyId].workProfiles.find(p => p.type === w.type)!;
      if (w.elapsedSec + epsilon < profile.durationSec) continue;
      const e = this.employee(w.employeeId)!;
      this.damageEmployee(e.id, profile.hazard);
      if (r.work !== w || !this.controllable(e)) continue;
      const extra = this.specialPressure(r, w);
      r.pressure = Math.max(cfg.pressure.min, Math.min(cfg.pressure.breachThreshold, r.pressure + profile.pressureDelta + extra.amount));
      this.log('PRESSURE', `${r.anomalyId} 基础${profile.pressureDelta >= 0 ? '+' : ''}${profile.pressureDelta}${extra.amount ? `、${extra.reason}+${extra.amount}` : ''} → 压力${r.pressure.toFixed(1)}${r.pressure >= cfg.pressure.breachThreshold ? '，达到阈值，本次未入账' : ''}。`);
      candidates.push({ room: r, work: w, energy: profile.energy });
    }
    this.resolveThresholds();
    for (const c of candidates) {
      if (c.room.mode !== 'CONTAINED' || c.room.work !== c.work || !this.controllable(this.employee(c.work.employeeId)!) || s.processedWorkIncomeIds.has(c.work.workId)) continue;
      s.processedWorkIncomeIds.add(c.work.workId); s.producedToday += c.energy; s.progress.wallet += c.energy;
      this.log('INCOME', `${c.room.anomalyId} ${c.work.workId} 完成，累计与钱包各+${c.energy}。`);
      this.releaseWork(c.room, false, '工作完成');
    }
    for (const r of s.rooms) if (r.mode === 'RECOVERING' && recovering.has(r.anomalyId)) {
      r.recoveryRemainingSec = Math.max(0, r.recoveryRemainingSec - dt);
      if (r.recoveryRemainingSec <= epsilon) { r.recoveryRemainingSec = 0; r.mode = 'CONTAINED'; r.pressure = cfg.pressure.afterRecovery; r.memory = freshMemory(); this.log('RECOVER', `${r.anomalyId} 恢复完成，压力${r.pressure}，可派遣。`); }
    }
    if (s.employees.every(e => e.status === 'INCAPACITATED')) { s.phase = 'FAILED'; this.freezeScene(); this.log('FAILED', '全员重伤，本日失败。可以重试日初快照。'); }
    else if (s.day === cfg.tutorial.day && !s.progress.tutorialOfferHandled && !s.tutorialPending && s.producedToday >= cfg.tutorial.offerAtProduced) { s.tutorialPending = true; this.syncPause(); }
  }

  private spend(amount: number): void { this.state.progress.wallet -= amount; this.spent += amount; }
  private purchase(id: AnomalyId, item: 'BEHAVIOR' | 'COMBAT' | 'EQUIPMENT' | 'SKILL'): Result<void> {
    const a = anomalyById[id], r = this.room(id), p = this.state.progress;
    if (!a || r.mode === 'LOCKED') return error('LOCKED', '该收容物尚未开放。');
    const research = p.research[id];
    const owned = item === 'BEHAVIOR' ? research.behavior : item === 'COMBAT' ? research.combat : item === 'EQUIPMENT' ? research.equipmentDeveloped : p.unlockedSkills.includes(a.skillId);
    if (owned) return error('OWNED', '已完成购买，请勿重复购买。');
    if ((item === 'COMBAT' || item === 'EQUIPMENT') && !research.behavior) return error('PREREQUISITE', '请先解锁行为档案。');
    const cost = item === 'BEHAVIOR' ? cfg.economy.archiveBehaviorCost : item === 'COMBAT' ? cfg.economy.archiveCombatCost : item === 'EQUIPMENT' ? cfg.economy.equipmentPairCost : cfg.economy.skillUnlockCost;
    if (p.wallet < cost) return error('FUNDS', config.localization['error.notEnoughEnergy']);
    this.spend(cost);
    if (item === 'BEHAVIOR') research.behavior = true;
    if (item === 'COMBAT') research.combat = true;
    if (item === 'EQUIPMENT') { research.equipmentDeveloped = true; p.ownedWeapons.push(a.weaponId); p.ownedArmors.push(a.armorId); }
    if (item === 'SKILL') p.unlockedSkills.push(a.skillId);
    this.log('PURCHASE', `${id} 购买${item === 'BEHAVIOR' ? '行为档案' : item === 'COMBAT' ? '镇压档案' : item === 'EQUIPMENT' ? '专属武器与防具' : '主动技能'}，可用能量−${cost}，累计产能不变。`);
    return ok();
  }
  private canEquip(e: EmployeeRuntime): boolean {
    return this.state.phase === 'DAY_PREP' || (e.location.zone === 'SAFE' && e.status === 'IDLE' && !this.state.rooms.some(r => r.work?.employeeId === e.id));
  }
  private equip(employeeId: EmployeeId, itemId: WeaponId | ArmorId, slot: 'weaponId' | 'armorId'): Result<void> {
    const e = this.employee(employeeId), p = this.state.progress;
    if (!e || !this.canEquip(e)) return error('LOCATION', config.localization['error.equipLocation']);
    const starter = slot === 'weaponId' ? 'W00' : 'A00';
    const owned: readonly string[] = slot === 'weaponId' ? p.ownedWeapons : p.ownedArmors;
    if (itemId !== starter && !owned.includes(itemId)) return error('OWNERSHIP', '未开发该装备。');
    const old = itemId === starter ? undefined : this.state.employees.find(other => other.id !== e.id && other[slot] === itemId);
    if (old && !this.canEquip(old)) return error('HOLDER_LOCATION', '原持有人不满足换装条件，不能远程转移。');
    if (slot === 'weaponId') { if (old) old.weaponId = 'W00'; e.weaponId = itemId as WeaponId; }
    else { if (old) old.armorId = 'A00'; e.armorId = itemId as ArmorId; }
    this.syncLoadouts();
    this.log('EQUIP', `${e.displayName} 穿戴 ${slot === 'weaponId' ? weaponById[itemId as WeaponId].name : armorById[itemId as ArmorId].name}${old ? `（从 ${old.displayName} 转移）` : ''}。`);
    return ok();
  }
  private syncLoadouts(): void { for (const e of this.state.employees) this.state.progress.employeeLoadouts[e.id] = { weaponId: e.weaponId, armorId: e.armorId }; }

  private cast(id: SkillId, target: CastTarget): Result<void> {
    const skill = skillById[id], s = this.state;
    if (!skill || !s.progress.unlockedSkills.includes(id)) return error('LOCKED', '该技能尚未解锁。');
    if (s.skillCooldownRemainingSec[id] > epsilon) return error('COOLDOWN', config.localization['error.cooldown']);
    if (s.progress.wallet < skill.energyCost) return error('FUNDS', config.localization['error.notEnoughEnergy']);
    const invalid = () => error('TARGET', config.localization['error.invalidSkillTarget']);
    let enemies: EnemyRuntime[] = [], employees: EmployeeRuntime[] = [];
    if (skill.target === 'SINGLE_ENEMY') {
      if (target.kind !== 'ENEMY') return invalid();
      enemies = s.enemies.filter(e => e.id === target.enemyId);
      if (!enemies.length) return invalid();
    } else if (skill.target === 'CORRIDOR_POINT') {
      if (target.kind !== 'POINT' || !this.navigation.corridorAt(target.point)) return invalid();
      const targetLocation = this.navigation.locate(target.point)!;
      enemies = s.enemies.filter(e => this.navigation.combatDistance(e.location, targetLocation) <= skill.radiusPx + epsilon);
      if (!enemies.length) return invalid();
    } else if (skill.target === 'FACILITY_POINT') {
      if (target.kind !== 'POINT' || !Number.isFinite(target.point.x) || !Number.isFinite(target.point.y)) return invalid();
      const p = target.point, bounds = this.navigation.bounds;
      if (p.x < bounds.x || p.x > bounds.x + bounds.width || p.y < bounds.y || p.y > bounds.y + bounds.height) return invalid();
      employees = s.employees.filter(e => e.status !== 'INCAPACITATED' && e.sp < e.spMax - epsilon && distance(e.location, p) <= skill.radiusPx + epsilon);
      if (!employees.length) return invalid();
    } else {
      if (target.kind !== 'GLOBAL') return invalid();
      employees = s.employees.filter(e => e.status !== 'INCAPACITATED');
      if (!employees.length) return invalid();
    }
    this.spend(skill.energyCost); s.skillCooldownRemainingSec[id] = skill.cooldownSec; this.skillUses++;
    for (const enemy of enemies) {
      if (skill.effect === 'STUN') { enemy.stunnedUntilSec = s.simulationTimeSec + skill.durationSec; this.cancelAttack(enemy); enemy.nextAttackStartAtSec = enemy.stunnedUntilSec + this.enemyPeriod(enemy); }
      if (skill.effect === 'DAMAGE') this.damageEnemy(enemy.id, skill.damage);
      if (skill.effect === 'DAMAGE_AND_KNOCKBACK' && target.kind === 'POINT') {
        this.damageEnemy(enemy.id, skill.damage);
        enemy.location = this.navigation.knockback(enemy.location, (enemy.location.x >= target.point.x ? 1 : -1) * skill.knockbackPx);
        this.cancelAttack(enemy); enemy.nextAttackStartAtSec = Math.max(s.simulationTimeSec, enemy.stunnedUntilSec) + this.enemyPeriod(enemy);
      }
    }
    for (const e of employees) {
      if (skill.effect === 'MOVE_SPEED_BUFF') e.moveBuffRemainingSec = skill.durationSec;
      if (skill.effect === 'RESTORE_SP') { e.sp = Math.min(e.spMax, e.sp + skill.restoreSp); this.checkEmployee(e); }
    }
    this.log('SKILL', `${skill.name}施放成功，可用能量−${skill.energyCost}，冷却${skill.cooldownSec}秒。`);
    return ok();
  }

  handleTutorial(accept: boolean): void {
    if (!this.state.tutorialPending) return;
    this.state.tutorialPending = false; this.state.progress.tutorialOfferHandled = true;
    this.syncPause();
    this.log('TUTORIAL', accept ? '接受可控失效演练。' : '跳过可控失效演练。');
    if (accept) this.forceBreach(cfg.tutorial.anomalyId, '主管接受可控失效演练');
  }
  private freezeScene(): void {
    for (const r of this.state.rooms) if (r.work) this.releaseWork(r, false, '日终取消，未完成不入账');
    for (const e of this.state.employees) { this.cancelAttack(e); e.path = []; e.order = { kind: 'IDLE' }; if (this.controllable(e)) e.status = 'IDLE'; }
    for (const n of this.state.enemies) { this.cancelAttack(n); n.pendingForcedHowl = false; }
    this.accumulator = 0;
  }
  private finishDay(): Result<void> {
    if (this.state.phase !== 'RUNNING') return error('PHASE', '当前不能结束今天。');
    if (this.state.producedToday < dayByNumber[this.state.day].quota) return error('QUOTA', config.localization['error.quotaNotMet']);
    this.state.report = { day: this.state.day, produced: this.state.producedToday, spent: this.spent, breaches: this.breaches, unresolved: this.state.rooms.filter(r => r.mode === 'BREACHED' || r.mode === 'RECOVERING').length, incapacitated: this.state.employees.filter(e => e.status === 'INCAPACITATED').length, skillUses: this.skillUses };
    this.freezeScene(); this.syncLoadouts();
    this.state.tutorialPending = false;
    this.state.phase = this.state.day === config.days[config.days.length - 1].day ? 'COMPLETE' : 'DAY_REPORT';
    this.log('REPORT', `第${this.state.day}日结算：累计${this.state.producedToday}，可用${this.state.progress.wallet}，未处理事故${this.state.report.unresolved}；无额外扣款或奖励。`);
    return ok();
  }
  nextDay(): Result<void> {
    if (this.state.phase !== 'DAY_REPORT' || this.state.day >= config.days.length) return error('PHASE', '当前不能进入下一日。');
    this.syncLoadouts();
    const snapshot = makeSnapshot((this.state.day + 1) as DayNumber, this.state.progress);
    this.reset(snapshot); return ok();
  }
  retryDay(): void { this.reset(this.state.entrySnapshot); }
  private reset(snapshot: DayEntrySnapshot): void {
    this.state = makeState(snapshot, this.navigation.locate(this.navigation.safePoint)!); this.commandResults.clear(); this.patrolDirections.clear(); this.ambientPlans.clear(); this.meetingLandings.clear();
    this.panelPauses.clear(); this.manualPause = false; this.speed = 1; this.accumulator = 0;
    this.spent = 0; this.breaches = 0; this.skillUses = 0;
    this.log('DAY', `第${this.state.day}日日初快照载入；今日产能、购买与消耗从本日入口重新计算。`);
  }
}
