import Phaser from 'phaser';
import type { EmployeeRuntime, EnemyRuntime, Point } from '../../contracts/data-contract';
import { anomalyById, config, skillById, weaponById } from '../data/config';
import type { GameInterface } from '../ui/GameInterface';
import { number, text } from '../ui/format';

const palette = { ink: 0x243640, muted: 0x7b8788, line: 0xb8c0bc, paper: 0xf6f5ed, yellow: 0xedbd42, green: 0x4f826c, red: 0xc86147, blue: 0x5e8799 };
const anomalyColors = [0xe5bf58, 0xb08670, 0x7c9199, 0xa08da9, 0x8ca58b];
const damageColors = { RED: 0xc86147, WHITE: 0x8aadc3, BLACK: 0x8b7a96, PALE: 0x73a699 };

/** Rendering and input only. All work, damage, timers and resource changes live in Simulation. */
export class FacilityScene extends Phaser.Scene {
  private graphics!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private labelCursor = 0;
  private dragStart: Point | null = null;
  private dragEnd: Point | null = null;
  private pointerPoint: Point = { x: 0, y: 0 };
  private previousVitals = new Map<string, { hp: number; sp?: number }>();
  private feedback: { id: string; point: Point; label: string; healing: boolean; until: number }[] = [];
  private previousSimulationTime = 0;
  private displayPositions = new Map<string, Point>();

  constructor(private readonly ui: GameInterface) { super('facility'); }

  create(): void {
    this.graphics = this.add.graphics();
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.pointerDown(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.pointerPoint = { x: pointer.x, y: pointer.y };
      if (this.dragStart) this.dragEnd = { ...this.pointerPoint };
    });
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.pointerUp(pointer));
  }

  update(_time: number, delta: number): void {
    this.ui.simulation.advance(delta / 1000);
    this.ui.update(delta / 1000);
    this.interpolateDisplay(delta / 1000);
    this.paint();
  }

  private interpolateDisplay(deltaSec: number): void {
    const state = this.ui.simulation.state;
    const frozen = state.phase !== 'RUNNING' || state.timeScale === 0;
    const blend = 1 - Math.exp(-Math.min(deltaSec, 0.1) * 25);
    const visible = [...state.employees, ...state.enemies];
    const ids = new Set(visible.map((entity) => entity.id));
    for (const entity of visible) {
      const prior = this.displayPositions.get(entity.id);
      if (!prior || frozen || entity.attackPhase === 'WINDUP') this.displayPositions.set(entity.id, { x: entity.location.x, y: entity.location.y });
      else this.displayPositions.set(entity.id, { x: Phaser.Math.Linear(prior.x, entity.location.x, blend), y: Phaser.Math.Linear(prior.y, entity.location.y, blend) });
    }
    for (const id of this.displayPositions.keys()) if (!ids.has(id)) this.displayPositions.delete(id);
  }

  private pointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.ui.blocked || pointer.x >= config.game.layout.inspectorX || pointer.y >= config.game.layout.toolbarY) return;
    const point = { x: pointer.x, y: pointer.y };
    const enemy = this.enemyAt(point);
    if (pointer.rightButtonDown()) {
      if (this.ui.aiming || this.ui.pointerMode) { this.ui.cancelAim(); return; }
      if (!enemy && !(point.x > 1095 && point.y > 525) && !this.inCorridor(point)) { this.ui.notify('移动目的地请选择走廊；撤退请选择安全室。', true); return; }
      this.ui.mapRightClick({ x: point.x, y: config.game.layout.corridorY }, enemy?.id, point.x > 1095 && point.y > 525);
      return;
    }
    if (this.ui.aiming || this.ui.pointerMode) {
      if ((this.ui.aiming && skillById[this.ui.aiming].target === 'CORRIDOR_POINT' || this.ui.pointerMode === 'MOVE') && !this.inCorridor(point)) { this.ui.notify('请选择走廊内的位置。', true); return; }
      this.ui.mapClick(this.ui.aiming && skillById[this.ui.aiming].target !== 'CORRIDOR_POINT' ? point : { x: point.x, y: config.game.layout.corridorY }, enemy?.id);
      return;
    }
    const employee = this.employeeAt(point);
    if (employee) {
      this.ui.select([employee.id], pointer.event.shiftKey);
      return;
    }
    const room = config.anomalyData.anomalies.find((a) => Math.abs(point.x - config.game.layout.roomCentersX[a.roomIndex]) < 89 && point.y >= 164 && point.y <= 353);
    if (room) { this.ui.roomClick(room.id); return; }
    this.dragStart = point;
    this.dragEnd = point;
  }

  private pointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.dragStart || !this.dragEnd) return;
    const start = this.dragStart; const end = this.dragEnd;
    this.dragStart = null; this.dragEnd = null;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 8) return;
    const selected = this.ui.simulation.state.employees.filter((employee, index) => {
      const point = this.employeeDisplayPoint(employee, index);
      return employee.status !== 'INCAPACITATED' && point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x) && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);
    });
    this.ui.select(selected.map((e) => e.id), pointer.event.shiftKey);
  }

  private employeeAt(point: Point): EmployeeRuntime | undefined {
    return this.ui.simulation.state.employees.find((employee, index) => {
      const visible = this.employeeDisplayPoint(employee, index);
      return employee.status !== 'INCAPACITATED' && Math.hypot(point.x - visible.x, point.y - visible.y) < 23;
    });
  }

  private enemyAt(point: Point): EnemyRuntime | undefined {
    return this.ui.simulation.state.enemies.map((enemy) => {
      const display = this.enemyDisplayPoint(enemy);
      return { enemy, distance: Math.hypot(point.x - display.x, point.y - display.y) };
    }).filter(({ enemy, distance }) => distance < (enemy.isClone ? 22 : 30)).sort((a, b) => a.distance - b.distance)[0]?.enemy;
  }

  private inCorridor(point: Point): boolean {
    const layout = config.game.layout;
    return point.x >= layout.corridorMinX && point.x <= layout.corridorMaxX && Math.abs(point.y - layout.corridorY) <= 48;
  }

  private enemyDisplayPoint(enemy: EnemyRuntime): Point {
    const base = this.displayPositions.get(enemy.id) ?? enemy.location;
    if (!enemy.isClone) return base;
    const clones = this.ui.simulation.state.enemies.filter((e) => e.isClone && e.breachInstanceId === enemy.breachInstanceId);
    return { x: base.x + (clones.indexOf(enemy) % 2 ? 28 : -28), y: base.y - 28 };
  }

  private label(value: string, x: number, y: number, size = 13, color = '#243640', align: 'left' | 'center' | 'right' = 'center', bold = false): void {
    let label = this.labels[this.labelCursor++];
    if (!label) {
      label = this.add.text(x, y, value, { fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif', fontSize: `${size}px`, color });
      this.labels.push(label);
    }
    label.setText(value).setPosition(x, y).setFontSize(size).setColor(color).setFontStyle(bold ? 'bold' : 'normal').setOrigin(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5).setVisible(true);
  }

  private paint(): void {
    const g = this.graphics;
    if (!g) return;
    g.clear(); this.labelCursor = 0;
    this.trackVitals();
    this.paintFacility(); this.paintRooms(); this.paintTelegraphs();
    this.ui.simulation.state.enemies.forEach((enemy) => this.paintEnemy(enemy));
    this.ui.simulation.state.employees.forEach((employee, index) => this.paintEmployee(employee, index));
    this.paintAim(); this.paintFeedback();
    if (this.dragStart && this.dragEnd) {
      const x = Math.min(this.dragStart.x, this.dragEnd.x); const y = Math.min(this.dragStart.y, this.dragEnd.y);
      const width = Math.abs(this.dragStart.x - this.dragEnd.x); const height = Math.abs(this.dragStart.y - this.dragEnd.y);
      g.fillStyle(palette.yellow, 0.15).fillRect(x, y, width, height);
      g.lineStyle(1, palette.yellow).strokeRect(x, y, width, height);
    }
    for (let index = this.labelCursor; index < this.labels.length; index++) this.labels[index].setVisible(false);
  }

  private paintFacility(): void {
    const g = this.graphics;
    const layout = config.game.layout;
    g.fillStyle(0xf0f0e7).fillRoundedRect(30, 95, 1220, 585, 12);
    g.lineStyle(1, 0xd3d6cb).strokeRoundedRect(30, 95, 1220, 585, 12);
    g.lineStyle(1, 0xdfe1d6, 0.8);
    for (let x = 48; x < 1250; x += 24) for (let y = 152; y < 680; y += 24) g.strokeRect(x, y, 1, 1);
    // Fixed node graph; floor ornament does not change logical positions.
    for (const x of layout.roomCentersX) {
      g.fillStyle(0xd0d4c8).fillRect(x - 23, layout.roomCenterY, 46, layout.corridorY - layout.roomCenterY);
      g.lineStyle(1, 0xb3bcb5).strokeRect(x - 23, 350, 46, 47);
      g.lineStyle(2, 0x9aa89f).lineBetween(x, 358, x, 372);
    }
    g.fillStyle(0x283b42).fillRoundedRect(layout.corridorMinX - 15, layout.corridorY - 48, layout.corridorMaxX - layout.corridorMinX + 44, 97, 9);
    g.lineStyle(2, 0x8fa29a).strokeRoundedRect(layout.corridorMinX - 15, layout.corridorY - 48, layout.corridorMaxX - layout.corridorMinX + 44, 97, 9);
    g.fillStyle(0x33484e).fillRect(1166, 450, 48, 125);
    g.lineStyle(1, 0x61766f);
    for (let x = layout.corridorMinX; x < layout.corridorMaxX; x += 36) g.lineBetween(x, 397, x, 479);
    g.lineStyle(1, 0x61766f, 0.65).lineBetween(51, 414, 1200, 414).lineBetween(51, 467, 1200, 467);
    g.lineStyle(2, 0xc3ac5c, 0.7);
    for (let x = 65; x < 1190; x += 64) g.lineBetween(x, 440, x + 23, 440);
    g.fillStyle(0xe1e7d9).fillRoundedRect(1095, 535, 143, 120, 7);
    g.lineStyle(2, 0x73957e).strokeRoundedRect(1095, 535, 143, 120, 7);
    g.fillStyle(0x73957e).fillRect(1105, 547, 5, 20).fillRect(1098, 554, 19, 5);
    this.label('安全室', 1143, 557, 16, '#426650', 'left', true);
    this.label('抵达后免费恢复', 1167, 645, 10, '#607568');
    this.label('右键此处撤退', 1190, 513, 11, '#5b7165');
    this.label('CORRIDOR  /  C-01', 65, 496, 10, '#78897e', 'left');
    this.label('危险单位仅沿走廊移动', 1044, 496, 11, '#78897e', 'right');
    // Facility signage is static spatial context, never a fake gameplay display.
    g.fillStyle(palette.ink).fillRoundedRect(1108, 175, 112, 153, 4);
    this.label('设施 07', 1164, 195, 15, '#ecece2', 'center', true);
    this.label('MANUAL', 1164, 226, 11, '#94aaa4');
    this.label('手动调度', 1164, 249, 18, '#e8c462', 'center', true);
    this.label('失效即停产', 1164, 282, 12, '#c3cfca');
    this.label('镇压无产能', 1164, 304, 12, '#c3cfca');
  }

  private paintRooms(): void {
    const g = this.graphics;
    const state = this.ui.simulation.state;
    for (const room of state.rooms) {
      const anomaly = anomalyById[room.anomalyId];
      const center = config.game.layout.roomCentersX[anomaly.roomIndex];
      const left = center - 89; const locked = room.mode === 'LOCKED';
      const breached = room.mode === 'BREACHED';
      const warning = room.pressure >= config.game.pressure.warning;
      const danger = room.pressure >= config.game.pressure.danger;
      const selected = this.ui.selectedRoom === room.anomalyId;
      const tint = locked ? 0xb4bbb1 : breached ? palette.red : danger ? palette.red : warning ? 0xb89534 : palette.green;
      g.fillStyle(locked ? 0xdce0d4 : palette.paper).fillRoundedRect(left, 164, 178, 189, 7);
      g.lineStyle(selected ? 3 : 1, selected ? palette.yellow : breached ? palette.red : 0xb6c0b5).strokeRoundedRect(left, 164, 178, 189, 7);
      g.fillStyle(locked ? 0xa4aea1 : palette.ink).fillRoundedRect(left + 1, 165, 176, 30, { tl: 6, tr: 6, bl: 0, br: 0 });
      this.label(room.anomalyId, left + 13, 181, 13, '#f2f2e9', 'left', true);
      this.label(locked ? `第 ${anomaly.unlockDay} 日` : '收容室', left + 164, 181, 11, '#c6d3c9', 'right');
      this.label(anomaly.name, center, 211, 19, locked ? '#889484' : '#243640', 'center', true);
      this.label(locked ? '尚未开放' : breached ? '◆ 收容失效 · 停产' : room.mode === 'RECOVERING' ? `↻ 恢复 ${Math.ceil(room.recoveryRemainingSec)}秒` : room.work ? `${room.work.phase === 'EXECUTING' ? '● 作业中' : '→ 已预约'} · ${state.employees.find((e) => e.id === room.work!.employeeId)?.displayName}` : danger ? '△ 危险压力' : warning ? '△ 压力警戒' : '● 已收容', center, 235, 11, `#${tint.toString(16).padStart(6, '0')}`);
      if (!breached && room.mode !== 'RECOVERING') {
        const pulse = room.work?.phase === 'EXECUTING' ? Math.sin(state.simulationTimeSec * 4) * 0.05 : 0;
        this.silhouette(center, 270, anomaly.roomIndex, locked ? 0xbcc5b5 : anomalyColors[anomaly.roomIndex], 0.9 + pulse);
      }
      else {
        g.lineStyle(1, 0xc4c9bd).strokeCircle(center, 272, 23);
        this.label(breached ? '!' : '↻', center, 271, 27, breached ? '#c86147' : '#789485', 'center', true);
      }
      this.label(locked ? '封存中' : breached ? '主样本已进入走廊' : '编号轮廓占位', center, 303, 10, '#919a8c');
      const enemy = state.enemies.find((e) => e.id === room.mainEnemyId);
      const value = breached ? enemy?.suppressionHp ?? 0 : room.pressure;
      const max = breached ? enemy?.suppressionHpMax ?? anomaly.breach.suppressionHpMax : config.game.pressure.breachThreshold;
      g.fillStyle(0xdce2d6).fillRoundedRect(left + 15, 317, 148, 5, 2);
      if (!locked) g.fillStyle(tint).fillRoundedRect(left + 15, 317, Math.max(0, Math.min(148, value / max * 148)), 5, 2);
      this.label(locked ? '—' : `${breached ? '镇压' : '压力'} ${Math.ceil(value)} / ${max}`, center, 336, 11, '#71806f');
      if (room.work) {
        const duration = anomaly.workProfiles.find((p) => p.type === room.work!.type)!.durationSec;
        g.fillStyle(palette.yellow).fillRect(left + 1, 348, 176 * room.work.elapsedSec / duration, 4);
      }
      if (anomaly.specialWorkRule.kind === 'NEGLECT' && !locked && !breached) this.label(`空闲 ${Math.floor(room.memory.idleElapsedSec)} / ${anomaly.specialWorkRule.idleGraceSec}秒`, center, 369, 11, room.memory.idleElapsedSec >= anomaly.specialWorkRule.idleGraceSec ? '#c86147' : '#71806f');
      if (breached) {
        g.lineStyle(2, palette.red).lineBetween(center - 18, 366, center + 18, 382).lineBetween(center + 18, 366, center - 18, 382);
      }
    }
  }

  private silhouette(x: number, y: number, index: number, color: number, scale = 1): void {
    const g = this.graphics;
    g.fillStyle(color);
    // Abstract numbered shapes are deliberately not representations of the named IP.
    if (index === 0) {
      g.fillEllipse(x, y + 5 * scale, 45 * scale, 36 * scale).fillCircle(x, y - 13 * scale, 17 * scale);
      g.fillCircle(x - 13 * scale, y - 26 * scale, 6 * scale).fillCircle(x + 13 * scale, y - 26 * scale, 6 * scale);
    } else if (index === 1) {
      g.fillTriangle(x - 24 * scale, y - 10 * scale, x - 11 * scale, y - 33 * scale, x + 4 * scale, y - 10 * scale);
      g.fillTriangle(x + 24 * scale, y - 10 * scale, x + 11 * scale, y - 33 * scale, x - 4 * scale, y - 10 * scale);
      g.fillRoundedRect(x - 24 * scale, y - 13 * scale, 48 * scale, 36 * scale, 12 * scale);
    } else if (index === 2) {
      g.fillRoundedRect(x - 28 * scale, y - 15 * scale, 56 * scale, 32 * scale, 8 * scale);
      g.fillRect(x - 22 * scale, y + 10 * scale, 10 * scale, 14 * scale).fillRect(x + 12 * scale, y + 10 * scale, 10 * scale, 14 * scale);
    } else if (index === 3) {
      g.fillTriangle(x, y - 31 * scale, x - 29 * scale, y + 21 * scale, x + 29 * scale, y + 21 * scale);
      g.fillRect(x - 5 * scale, y + 20 * scale, 10 * scale, 8 * scale);
    } else {
      g.fillEllipse(x, y + 2 * scale, 43 * scale, 52 * scale);
      g.fillCircle(x - 21 * scale, y + 2 * scale, 9 * scale).fillCircle(x + 21 * scale, y + 2 * scale, 9 * scale);
    }
    g.fillStyle(0x334a44, 0.65).fillRoundedRect(x - 13 * scale, y - 6 * scale, 26 * scale, 12 * scale, 3 * scale);
    this.label(String(index + 1).padStart(2, '0'), x, y, 11 * scale, '#f9f4dd', 'center', true);
  }

  private paintTelegraphs(): void {
    const state = this.ui.simulation.state;
    const g = this.graphics;
    for (const enemy of state.enemies) {
      if (enemy.attackPhase !== 'WINDUP' || enemy.windupEndsAtSec === null) continue;
      const breach = anomalyById[enemy.sourceAnomalyId].breach;
      if (breach.ai === 'STATIONARY_BROADCAST') {
        g.fillStyle(0xb187bf, 0.08).fillRoundedRect(43, 155, 1039, 335, 8);
        g.lineStyle(2, 0xb187bf, 0.75).strokeRoundedRect(43, 155, 1039, 335, 8);
        this.label('△ 广播蓄力 · 安全室外全部员工将受影响', 640, 513, 13, '#98699b', 'center', true);
      } else {
        const range = breach.attackRangePx;
        g.fillStyle(palette.red, 0.13).fillCircle(enemy.location.x, enemy.location.y, range);
        g.lineStyle(2, palette.red, 0.75).strokeCircle(enemy.location.x, enemy.location.y, range);
      }
      const ratio = Math.max(0, (enemy.windupEndsAtSec - state.simulationTimeSec) / breach.windupSec);
      g.fillStyle(palette.red).fillRect(enemy.location.x - 28, enemy.location.y + 45, 56 * (1 - ratio), 4);
      this.label(`蓄力 ${number(Math.max(0, enemy.windupEndsAtSec - state.simulationTimeSec))}`, enemy.location.x, enemy.location.y + 61, 10, '#a73d31', 'center', true);
    }
  }

  private paintEnemy(enemy: EnemyRuntime): void {
    const anomaly = anomalyById[enemy.sourceAnomalyId];
    const display = this.enemyDisplayPoint(enemy);
    const x = display.x; const y = display.y;
    const g = this.graphics;
    const scale = enemy.isClone ? 0.6 : 0.84;
    if (!enemy.isClone) g.lineStyle(2, palette.red).strokeRoundedRect(x - 31, y - 36, 62, 65, 6);
    g.fillStyle(0x17292e, 0.45).fillEllipse(x, y + 24, 52 * scale, 12 * scale);
    this.silhouette(x, y - 3, anomaly.roomIndex, enemy.isClone ? 0x9c9d85 : anomalyColors[anomaly.roomIndex], scale);
    g.fillStyle(0x15272a).fillRoundedRect(x - 30, y - 48, 60, 5, 2);
    g.fillStyle(palette.red).fillRoundedRect(x - 30, y - 48, Math.max(0, 60 * enemy.suppressionHp / enemy.suppressionHpMax), 5, 2);
    this.label(enemy.isClone ? '分身' : `${anomaly.id} 主样本`, x, y - 60, 11, enemy.isClone ? '#879b8b' : '#af4c37', 'center', !enemy.isClone);
    if (enemy.stunnedUntilSec > this.ui.simulation.state.simulationTimeSec) {
      g.lineStyle(2, palette.yellow).strokeCircle(x, y - 6, 34);
      this.label('⊗ 受控', x, y + 38, 12, '#b79021', 'center', true);
    }
  }

  private employeeDisplayPoint(employee: EmployeeRuntime, index: number): Point {
    if (employee.location.zone === 'SAFE') return { x: 1121 + index % 3 * 41, y: 588 + Math.floor(index / 3) * 23 };
    const base = this.displayPositions.get(employee.id) ?? employee.location;
    const near = this.ui.simulation.state.employees.filter((other) => other.status !== 'INCAPACITATED' && other.id !== employee.id && Math.hypot(other.location.x - employee.location.x, other.location.y - employee.location.y) < 18);
    return { x: base.x, y: base.y + (near.length ? (index % 3 - 1) * 20 : 0) };
  }

  private paintEmployee(employee: EmployeeRuntime, index: number): void {
    if (employee.status === 'INCAPACITATED') return;
    const point = this.employeeDisplayPoint(employee, index); const x = point.x; const y = point.y;
    const g = this.graphics; const selected = this.ui.selected.has(employee.id);
    if (selected) {
      g.fillStyle(palette.yellow, 0.2).fillEllipse(x, y + 12, 39, 18);
      g.lineStyle(2, palette.yellow).strokeEllipse(x, y + 12, 39, 18);
      if (employee.path.length) {
        g.lineStyle(1, palette.yellow, 0.35).beginPath().moveTo(employee.location.x, employee.location.y);
        employee.path.forEach((node) => g.lineTo(node.x, node.y)); g.strokePath();
      }
    }
    const bob = employee.status === 'MOVING' || employee.status === 'PANICKED' ? Math.sin(this.ui.simulation.state.simulationTimeSec * 14 + index) * 1.6 : 0;
    g.fillStyle(0x122c32, 0.45).fillEllipse(x, y + 13, 27, 9);
    g.fillStyle(employee.status === 'PANICKED' ? palette.red : 0xf2ecce).fillRoundedRect(x - 9, y - 5 + bob, 18, 18, 3);
    g.fillStyle(0xf2ecce).fillCircle(x, y - 13 + bob, 8);
    g.fillStyle(0x2c4d54).fillRect(x - 6, y - 15 + bob, 12, 4);
    g.fillStyle(damageColors[weaponById[employee.weaponId].damage.type]).fillRect(x + 10, y - 2, 5, 15);
    if (employee.attackPhase === 'WINDUP' && employee.order.kind === 'SUPPRESS') {
      const targetId = employee.order.enemyId;
      const target = this.ui.simulation.state.enemies.find((e) => e.id === targetId);
      if (target) g.lineStyle(2, damageColors[weaponById[employee.weaponId].damage.type], 0.8).lineBetween(x, y, target.location.x, target.location.y);
    }
    if (employee.moveBuffRemainingSec > 0) g.lineStyle(2, 0x83bacc).strokeCircle(x, y - 2, 19);
    if (employee.status === 'WORKING') {
      g.lineStyle(2, palette.yellow).strokeCircle(x, y - 3, 21);
      this.label('作业', x + 31, y, 10, '#687e63');
    }
    if (employee.status === 'PANICKED') this.label('!', x, y - 39, 19, '#e07d5c', 'center', true);
    if (employee.location.zone !== 'SAFE') {
      g.fillStyle(0x152d31).fillRect(x - 14, y - 29, 28, 3);
      g.fillStyle(palette.green).fillRect(x - 14, y - 29, 28 * employee.hp / employee.hpMax, 3);
      g.fillStyle(palette.blue).fillRect(x - 14, y - 25, 28 * employee.sp / employee.spMax, 2);
      this.label(employee.displayName, x, y + 27, 10, employee.location.zone === 'CORRIDOR' ? '#e4eadc' : '#607564', 'center', selected);
    } else this.label(employee.id.slice(-2), x, y + 16, 9, '#506c54');
  }

  private paintAim(): void {
    if (!this.ui.aiming || this.ui.blocked) return;
    const skill = skillById[this.ui.aiming];
    const g = this.graphics;
    const point = { ...this.pointerPoint };
    if (skill.target === 'CORRIDOR_POINT') point.y = config.game.layout.corridorY;
    if ('radiusPx' in skill) {
      g.fillStyle(palette.blue, 0.1).fillCircle(point.x, point.y, skill.radiusPx);
      g.lineStyle(2, palette.blue).strokeCircle(point.x, point.y, skill.radiusPx);
    } else {
      g.lineStyle(2, palette.yellow).strokeCircle(point.x, point.y, 20);
    }
    g.lineStyle(2, palette.yellow).lineBetween(point.x - 8, point.y, point.x + 8, point.y).lineBetween(point.x, point.y - 8, point.x, point.y + 8);
  }

  private trackVitals(): void {
    const state = this.ui.simulation.state;
    if (state.simulationTimeSec < this.previousSimulationTime) { this.previousVitals.clear(); this.feedback = []; }
    this.previousSimulationTime = state.simulationTimeSec;
    const currentIds = new Set<string>();
    state.employees.forEach((employee, index) => {
      currentIds.add(employee.id);
      const before = this.previousVitals.get(employee.id);
      if (before) {
        const hp = employee.hp - before.hp; const sp = employee.sp - (before.sp ?? employee.sp);
        if (Math.abs(hp) >= 0.5 || Math.abs(sp) >= 0.5) {
          const values = [Math.abs(hp) >= 0.5 ? `${hp > 0 ? '+' : ''}${number(hp)} HP` : '', Math.abs(sp) >= 0.5 ? `${sp > 0 ? '+' : ''}${number(sp)} SP` : ''].filter(Boolean);
          this.addFeedback(employee.id, this.employeeDisplayPoint(employee, index), values.join(' / '), hp >= 0 && sp >= 0);
        }
      }
      this.previousVitals.set(employee.id, { hp: employee.hp, sp: employee.sp });
    });
    for (const enemy of state.enemies) {
      currentIds.add(enemy.id);
      const before = this.previousVitals.get(enemy.id);
      if (before && enemy.suppressionHp < before.hp) this.addFeedback(enemy.id, this.enemyDisplayPoint(enemy), `−${number(before.hp - enemy.suppressionHp)}`, false);
      this.previousVitals.set(enemy.id, { hp: enemy.suppressionHp });
    }
    for (const id of this.previousVitals.keys()) if (!currentIds.has(id)) this.previousVitals.delete(id);
  }

  private addFeedback(id: string, point: Point, label: string, healing: boolean): void {
    this.feedback = this.feedback.filter((item) => item.id !== id);
    this.feedback.push({ id, point: { ...point }, label, healing, until: this.ui.simulation.state.simulationTimeSec + 0.8 });
  }

  private paintFeedback(): void {
    const now = this.ui.simulation.state.simulationTimeSec;
    this.feedback = this.feedback.filter((item) => item.until > now);
    for (const item of this.feedback) {
      const remaining = item.until - now;
      this.graphics.lineStyle(2, item.healing ? 0x8cb783 : 0xf2bba0, Math.min(1, remaining * 2)).strokeCircle(item.point.x, item.point.y, 23 + (0.8 - remaining) * 12);
      this.label(item.label, item.point.x, item.point.y - 39 - (0.8 - remaining) * 18, 12, item.healing ? '#729766' : '#c36b44', 'center', true);
    }
  }
}
