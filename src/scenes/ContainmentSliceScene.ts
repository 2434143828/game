import Phaser from 'phaser';
import type { EmployeeId, EmployeeRuntime, EnemyRuntime, Point, WorkType } from '../../contracts/data-contract';
import type { SliceController } from '../debug/SliceController';
import { anomalyById, config, weaponById } from '../data/config';
import { drawHuman, drawNailongConcept } from './slice/actors';
import { SLICE_GEOMETRY, corridorFeetY, corridorPoint, employeeDepthOffset, employeeLateralOffset, roomWorkFeet, safeFeet, workClickPoint, worldToScreen } from './slice/geometry';

interface DisplayActor {
  world: Point;
  foot: Point;
  stride: number;
  facing: -1 | 1;
  moving: boolean;
  climbing: boolean;
  previousHp: number;
  previousSp?: number;
  hurtUntil: number;
  impactUntil: number;
  previousWindup: number | null;
}
interface FloatingFeedback { key: string; point: Point; text: string; color: string; until: number }
const colors = { wall: 0x303d43, deep: 0x18262d, trim: 0x4f6269, steel: 0x71828a, ink: 0x111e24, light: 0xc9d4cf, yellow: 0xd3b365, cyan: 0x83b5bd, red: 0xca745e };
const inRect = (point: Point, rect: { x: number; y: number; width: number; height: number }): boolean => point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;

/** M0/M1 cutaway. Every selectable actor refers to a live Simulation entity ID. */
export class ContainmentSliceScene extends Phaser.Scene {
  static readonly workClickPoint = workClickPoint;
  static readonly geometry = SLICE_GEOMETRY;
  private background!: Phaser.GameObjects.Graphics;
  private world!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];
  private usedLabels = 0;
  private actors = new Map<string, DisplayActor>();
  private floating: FloatingFeedback[] = [];
  private workMenuOpen = false;
  private dragStart: Point | null = null;
  private dragNow: Point | null = null;
  private roomClickCandidate = false;
  private hovered: Point = { x: 0, y: 0 };
  private lastProduced = 0;
  private lastTime = 0;
  private destination: { point: Point; at: number } | null = null;

  constructor(readonly controller: SliceController) { super('containment-slice'); }

  create(): void {
    this.cameras.main.setBackgroundColor('#19262c');
    this.background = this.add.graphics().setDepth(0);
    this.world = this.add.graphics().setDepth(10);
    this.overlay = this.add.graphics().setDepth(20);
    this.drawArchitecture();
    this.syncActors(0);
    this.drawFrame();
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onDown(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.onUp(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.hovered = { x: pointer.x, y: pointer.y };
      if (this.dragStart) this.dragNow = { ...this.hovered };
    });
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (event.repeat || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName ?? '')) return;
      if (event.code === 'Space') { event.preventDefault(); this.controller.togglePause(); }
      else if (event.code === 'KeyS') this.controller.stop();
      else if (event.code === 'KeyR') this.controller.retreat();
      else if (event.code === 'Escape') this.workMenuOpen = false;
    });
  }

  update(_time: number, delta: number): void {
    this.controller.simulation.advance(delta / 1000);
    this.syncActors(delta / 1000);
    this.drawFrame();
  }

  getEmployeeFootPoint(id: EmployeeId): Point | null {
    const actor = this.actors.get(id);
    if (actor) return { ...actor.foot };
    const employee = this.controller.state.employees.find((item) => item.id === id);
    return employee ? worldToScreen(employee.location) : null;
  }
  getEmployeeScreenPoint(id: EmployeeId): Point | null {
    const point = this.getEmployeeFootPoint(id);
    return point ? { x: point.x, y: point.y - 35 } : null;
  }
  getEnemyScreenPoint(id: string): Point | null {
    const actor = this.actors.get(id);
    return actor ? { x: actor.foot.x, y: actor.foot.y - 42 } : null;
  }
  getCorridorScreenPoint(logicalX: number): Point { return worldToScreen({ x: logicalX, y: config.game.layout.corridorY }); }
  corridorPoint(screenX: number): Point { return corridorPoint(screenX); }
  workClickPoint(): Point { return { ...workClickPoint }; }
  safeClickPoint(): Point { return { x: 1115, y: 680 }; }
  workOptionClickPoint(type: WorkType): Point {
    const index = config.game.work.types.indexOf(type);
    const menu = SLICE_GEOMETRY.workMenu;
    return { x: menu.x + menu.width / 2, y: menu.y + 42 + menu.rowHeight * index + menu.rowHeight / 2 };
  }
  getWorkChoicePoint(type: WorkType = 'OBSERVE'): Point { return this.workOptionClickPoint(type); }
  getAnimationState(): unknown {
    const state = this.controller.state;
    return {
      simulationTimeSec: state.simulationTimeSec,
      actors: [...this.actors].map(([id, actor]) => {
        const employee = state.employees.find((item) => item.id === id);
        const enemy = state.enemies.find((item) => item.id === id);
        const entity = employee ?? enemy;
        return {
          id, foot: { ...actor.foot }, facing: actor.facing, stride: actor.stride,
          pose: actor.climbing ? 'CLIMB' : actor.moving ? 'WALK' : employee?.status === 'WORKING' ? 'WORK' : entity?.attackPhase === 'WINDUP' ? 'WINDUP' : actor.impactUntil > state.simulationTimeSec ? 'SWING' : 'IDLE',
          attackPhase: entity?.attackPhase, attackProgress: entity?.windupEndsAtSec === null ? 0 : (entity?.windupEndsAtSec ?? state.simulationTimeSec) - state.simulationTimeSec,
          hurtRemaining: Math.max(0, actor.hurtUntil - state.simulationTimeSec),
        };
      }),
      room: { mode: state.rooms[0].mode, workElapsed: state.rooms[0].work?.elapsedSec ?? null },
    };
  }

  private onDown(pointer: Phaser.Input.Pointer): void {
    const point = { x: pointer.x, y: pointer.y };
    if (!inRect(point, SLICE_GEOMETRY.view)) return;
    const enemy = this.enemyAt(point);
    if (pointer.rightButtonDown()) {
      if (this.workMenuOpen) { this.workMenuOpen = false; return; }
      if (!this.controller.selected.size) { this.controller.notify('请先在设施中选择员工。'); return; }
      if (enemy) {
        this.controller.selectedEnemyId = enemy.id;
        this.controller.issue({ type: 'SUPPRESS', employeeIds: [...this.controller.selected], enemyId: enemy.id });
      } else if (inRect(point, { ...SLICE_GEOMETRY.safe, y: SLICE_GEOMETRY.safe.y - 10, height: SLICE_GEOMETRY.safe.height + 40 })) {
        this.controller.retreat();
      } else if (point.y >= SLICE_GEOMETRY.corridorClickBand.minY && point.y <= SLICE_GEOMETRY.corridorClickBand.maxY) {
        const target = corridorPoint(point.x);
        if (this.controller.issue({ type: 'MOVE', employeeIds: [...this.controller.selected], point: target }).ok) this.destination = { point: worldToScreen(target), at: this.controller.state.simulationTimeSec };
      } else this.controller.notify('右键走廊移动，右键异常镇压，右键安全室撤退。');
      return;
    }
    if (this.workMenuOpen) {
      const menu = SLICE_GEOMETRY.workMenu;
      const item = config.game.work.types.find((_type, index) => inRect(point, { x: menu.x, y: menu.y + 42 + menu.rowHeight * index, width: menu.width, height: menu.rowHeight }));
      if (item) {
        if (this.controller.selected.size !== 1) this.controller.notify('工作需要单选一名员工。');
        else if (this.controller.assignWork(item).ok) this.workMenuOpen = false;
        return;
      }
      this.workMenuOpen = false;
    }
    const employee = this.employeeAt(point);
    const employeeCenter = employee ? this.getEmployeeScreenPoint(employee.id)! : null;
    const enemyCenter = enemy ? this.getEnemyScreenPoint(enemy.id)! : null;
    const employeeCloser = employeeCenter && (!enemyCenter || Math.hypot(point.x - employeeCenter.x, point.y - employeeCenter.y) <= Math.hypot(point.x - enemyCenter.x, point.y - enemyCenter.y));
    if (employee && employeeCloser) { this.controller.select([employee.id], pointer.event.shiftKey); return; }
    if (enemy) { this.controller.selectedEnemyId = enemy.id; this.controller.notify(`${enemy.isClone ? '复读分身' : 'N01 主样本'}：选员工后右键该实体下达镇压。`); return; }
    this.roomClickCandidate = inRect(point, SLICE_GEOMETRY.room);
    this.dragStart = point; this.dragNow = point;
  }

  private onUp(pointer: Phaser.Input.Pointer): void {
    if (!this.dragStart || !this.dragNow) return;
    const a = this.dragStart; const b = this.dragNow;
    this.dragStart = null; this.dragNow = null;
    if (Math.hypot(a.x - b.x, a.y - b.y) < 6) {
      if (this.roomClickCandidate) this.workMenuOpen = true;
      this.roomClickCandidate = false;
      return;
    }
    this.roomClickCandidate = false;
    const bounds = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
    const ids = this.controller.state.employees.filter((employee) => {
      const point = this.getEmployeeScreenPoint(employee.id);
      return point && employee.status !== 'INCAPACITATED' && inRect(point, bounds);
    }).map((employee) => employee.id);
    this.controller.select(ids, pointer.event.shiftKey);
  }

  private employeeAt(point: Point): EmployeeRuntime | undefined {
    return this.controller.state.employees.filter((employee) => employee.status !== 'INCAPACITATED').map((employee) => {
      const center = this.getEmployeeScreenPoint(employee.id)!;
      return { employee, center, distance: Math.hypot(point.x - center.x, point.y - center.y) };
    }).filter((entry) => Math.abs(point.x - entry.center.x) <= 19 && Math.abs(point.y - entry.center.y) <= 36).sort((a, b) => a.distance - b.distance)[0]?.employee;
  }
  private enemyAt(point: Point): EnemyRuntime | undefined {
    return this.controller.state.enemies.map((enemy) => ({ enemy, point: this.getEnemyScreenPoint(enemy.id)! })).filter((entry) => entry.point && Math.abs(point.x - entry.point.x) < 35 && Math.abs(point.y - entry.point.y) < (entry.enemy.isClone ? 34 : 49)).sort((a, b) => Math.hypot(point.x - a.point.x, point.y - a.point.y) - Math.hypot(point.x - b.point.x, point.y - b.point.y))[0]?.enemy;
  }

  private syncActors(_deltaSec: number): void {
    const state = this.controller.state; const time = state.simulationTimeSec;
    if (time < this.lastTime) { this.actors.clear(); this.floating = []; }
    const advanced = time > this.lastTime;
    this.lastTime = time;
    const all = [...state.employees, ...state.enemies];
    for (const entity of all) {
      const employee = 'hp' in entity ? entity : null;
      const enemy = 'suppressionHp' in entity ? entity : null;
      const hp = employee?.hp ?? enemy!.suppressionHp;
      let actor = this.actors.get(entity.id);
      const point = worldToScreen(entity.location);
      if (employee) {
        const index = state.employees.indexOf(employee);
        point.y += employeeDepthOffset(index);
        point.x += employeeLateralOffset(index);
      }
      else if (enemy?.isClone) {
        const index = state.enemies.filter((e) => e.isClone && e.breachInstanceId === enemy.breachInstanceId).indexOf(enemy);
        point.x += index === 0 ? -35 : 35;
        point.y -= 12;
      }
      if (!actor) {
        actor = { world: { ...entity.location }, foot: point, stride: 0, facing: -1, moving: false, climbing: false, previousHp: hp, previousSp: employee?.sp, hurtUntil: 0, impactUntil: 0, previousWindup: entity.windupEndsAtSec };
        this.actors.set(entity.id, actor);
      }
      if (advanced) {
        const dx = entity.location.x - actor.world.x; const dy = entity.location.y - actor.world.y;
        const moved = Math.hypot(dx, dy);
        actor.moving = moved > 0.00001;
        if (actor.moving) actor.stride += moved / (Math.abs(dy) > Math.abs(dx) ? 5.5 : 8.5);
        if (Math.abs(dx) > 0.00001) actor.facing = dx > 0 ? 1 : -1;
        const layout = config.game.layout;
        const inRoomShaft = Math.abs(entity.location.x - layout.roomCentersX[0]) < 0.00001 && entity.location.y > layout.roomCenterY + 0.00001 && entity.location.y < layout.corridorY - 0.00001;
        const inSafeShaft = Math.abs(entity.location.x - layout.safeCenter.x) < 0.00001 && entity.location.y > layout.corridorY + 0.00001 && entity.location.y < layout.safeCenter.y - 0.00001;
        actor.climbing = Boolean(employee && (inRoomShaft || inSafeShaft));
        actor.world = { x: entity.location.x, y: entity.location.y };
      }
      // Do not lerp through walls or allow a post-pause animation to drift off its true feet.
      actor.foot = point;
      if (advanced && employee?.status === 'WORKING') { actor.facing = 1; actor.moving = false; actor.climbing = false; }
      if (advanced && employee?.order.kind === 'SUPPRESS') {
        const targetId = employee.order.enemyId;
        const target = state.enemies.find((e) => e.id === targetId);
        if (target && !actor.climbing) actor.facing = target.location.x >= employee.location.x ? 1 : -1;
      }
      if (advanced && enemy?.targetEmployeeId) {
        const target = state.employees.find((e) => e.id === enemy.targetEmployeeId);
        if (target) actor.facing = target.location.x >= enemy.location.x ? 1 : -1;
      }
      if (actor.previousWindup !== null && entity.windupEndsAtSec === null && time + 0.000001 >= actor.previousWindup) actor.impactUntil = time + 0.22;
      actor.previousWindup = entity.windupEndsAtSec;
      const hpLoss = actor.previousHp - hp; const spLoss = employee ? (actor.previousSp ?? employee.sp) - employee.sp : 0;
      if (hpLoss > 0.01 || spLoss > 0.01) {
        actor.hurtUntil = time + 0.3;
        const values = [hpLoss > 0.01 ? `−${hpLoss.toFixed(hpLoss % 1 ? 1 : 0)}${employee ? ' HP' : ''}` : '', spLoss > 0.01 ? `−${spLoss.toFixed(spLoss % 1 ? 1 : 0)} SP` : ''].filter(Boolean);
        this.floating.push({ key: entity.id, point: { x: point.x, y: point.y - (employee ? 77 : 111) }, text: values.join(' / '), color: '#edaf8a', until: time + 1.1 });
      }
      actor.previousHp = hp; actor.previousSp = employee?.sp;
    }
    const ids = new Set(all.map((entity) => entity.id));
    for (const id of this.actors.keys()) if (!ids.has(id)) this.actors.delete(id);
    if (state.producedToday > this.lastProduced) {
      this.floating.push({ key: 'energy', point: { x: 250, y: 304 }, text: `+${state.producedToday - this.lastProduced} 共鸣能量`, color: '#dfcf7b', until: time + 2 });
    }
    this.lastProduced = state.producedToday;
    this.floating = this.floating.filter((item) => item.until > time);
  }

  private label(value: string, x: number, y: number, size = 13, color = '#bdcbc8', align: 'left' | 'center' | 'right' = 'center', bold = false): void {
    let label = this.labels[this.usedLabels++];
    if (!label) { label = this.add.text(x, y, value, { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: `${size}px`, color }).setDepth(30); this.labels.push(label); }
    label.setText(value).setPosition(x, y).setFontSize(size).setColor(color).setFontStyle(bold ? 'bold' : 'normal').setOrigin(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5).setVisible(true);
  }

  private drawArchitecture(): void {
    const g = this.background; const view = SLICE_GEOMETRY.view;
    g.fillStyle(0x202f36).fillRect(view.x, view.y, view.width, view.height);
    g.lineStyle(2, 0x56676c).strokeRect(view.x, view.y, view.width, view.height);
    // Structural concrete and enclosed technical voids, not additional playable rooms.
    g.fillStyle(0x36454a).fillRect(38, 102, 1290, 670);
    for (let x = 42; x < 1330; x += 112) {
      g.lineStyle(1, 0x45575b).lineBetween(x, 105, x, 770);
      for (const y of [108, 435, 600, 768]) g.fillStyle(0x647476).fillCircle(x + 4, y, 2);
    }
    // Upper containment room: walls, observation partition, consoles and a live platform.
    this.wallBay(56, 128, 670, 277);
    g.fillStyle(0x1b3037).fillRect(78, 166, 204, 220);
    g.fillStyle(0x2b454e).fillRect(302, 164, 397, 221);
    g.lineStyle(2, 0x617e84).strokeRect(304, 166, 393, 220);
    g.fillStyle(0x7cabb0, 0.08).fillRect(306, 168, 389, 215);
    g.lineStyle(1, 0x709da3, 0.35).lineBetween(332, 168, 428, 383).lineBetween(351, 168, 447, 383).lineBetween(588, 168, 665, 383);
    g.fillStyle(0x455a60).fillRect(287, 155, 16, 250);
    for (let y = 169; y < 400; y += 32) g.fillStyle(0x91a7a3).fillCircle(295, y, 2);
    g.fillStyle(0x1c2d32).fillRect(584, 335, 89, 50);
    g.lineStyle(2, 0x536a6f).strokeRect(585, 335, 87, 50);
    for (let x = 594; x < 672; x += 13) g.lineStyle(3, 0x32484e).lineBetween(x, 344, x, 376);
    // Standing operator console adjacent to the actual work point.
    g.fillStyle(0x4d646b).fillPoints([{ x: 225, y: 356 }, { x: 270, y: 356 }, { x: 261, y: 370 }, { x: 219, y: 370 }], true);
    g.fillStyle(0x243b45).fillRect(225, 370, 34, 35);
    g.fillStyle(0x0e2027).fillRect(231, 359, 26, 7);
    g.fillStyle(0x8ac1b4).fillRect(234, 360, 10, 3);
    g.fillStyle(0xc4ab59).fillCircle(262, 361, 2);
    g.fillStyle(0x748c8c).fillRect(88, 322, 37, 83);
    g.fillStyle(0x1e3843).fillRect(93, 329, 27, 27);
    g.lineStyle(1, 0x61968e).lineBetween(97, 345, 102, 340).lineBetween(102, 340, 109, 346).lineBetween(109, 346, 116, 336);
    for (let y = 366; y < 393; y += 7) g.lineStyle(2, 0x364f57).lineBetween(94, y, 119, y);
    this.platform(56, 405, 670, roomWorkFeet.x - 23, 46);
    // Main observation window frame and reinforced room closure.
    g.fillStyle(0x6f807f).fillRect(60, 131, 663, 11);
    g.fillStyle(0x15282f).fillRect(64, 143, 653, 10);
    this.light(355, 151, 220, 0xd6d5a7);
    this.light(123, 151, 100, 0x9cc5c5);
    // Containment ladder cage: every inch of the vertical path is a visible passage.
    this.ladderShaft(roomWorkFeet.x, 405, corridorFeetY, 74);
    g.fillStyle(0x354b53).fillRect(roomWorkFeet.x - 41, 405, 13, 20).fillRect(roomWorkFeet.x + 28, 405, 13, 20);
    g.fillStyle(0xc6aa59).fillRect(roomWorkFeet.x - 39, 409, 10, 8).fillRect(roomWorkFeet.x + 29, 409, 10, 8);
    // Service machinery occupies the upper right as actual architectural mass.
    this.wallBay(758, 128, 560, 277);
    g.fillStyle(0x22333a).fillRect(780, 163, 512, 220);
    for (const x of [822, 958]) {
      g.fillStyle(0x4d6068).fillRoundedRect(x - 35, 190, 102, 192, 10);
      g.lineStyle(3, 0x71858a).strokeRoundedRect(x - 35, 190, 102, 192, 10);
      g.fillStyle(0x243b45).fillRect(x - 17, 212, 66, 69);
      for (let y = 219; y < 275; y += 9) g.lineStyle(3, 0x596e73).lineBetween(x - 11, y, x + 43, y);
      g.fillStyle(0x111f26).fillCircle(x + 16, 324, 31);
      g.lineStyle(3, 0x768b8f).strokeCircle(x + 16, 324, 29);
      for (const angle of [0, 1.57, 3.14, 4.71]) {
        const cx = x + 16; const cy = 324;
        g.fillStyle(0x4b636b).fillTriangle(cx, cy, cx + Math.cos(angle) * 25, cy + Math.sin(angle) * 25, cx + Math.cos(angle + 0.9) * 19, cy + Math.sin(angle + 0.9) * 19);
      }
      g.fillStyle(0x9aafb1).fillCircle(x + 16, 324, 5);
    }
    g.fillStyle(0x3e555d).fillRect(1080, 190, 192, 188);
    g.lineStyle(2, 0x697e82).strokeRect(1080, 190, 192, 188);
    for (let x = 1097; x < 1260; x += 55) {
      g.fillStyle(0x1d343e).fillRect(x, 211, 38, 95);
      for (let y = 221; y < 300; y += 13) g.fillStyle(0x68888b).fillRect(x + 7, y, 24, 3);
      g.fillStyle(0x8daf95).fillCircle(x + 9, 326, 3);
      g.fillStyle(0xa29961).fillCircle(x + 25, 326, 3);
    }
    this.pipe(786, 175, 1280, 175, 11, 0x7a8580);
    this.pipe(1032, 175, 1032, 390, 9, 0x9b8c60);
    this.platform(758, 405, 560);
    // Corridor with doors, load-bearing pillars, floor depth and overhead lights.
    g.fillStyle(0x1a2b33).fillRect(56, 459, 1262, 111);
    g.fillStyle(0x293f49).fillRect(56, 481, 1262, 75);
    for (let x = 68; x < 1314; x += 126) {
      g.fillStyle(0x3f5761).fillRect(x, 466, 8, 104);
      g.fillStyle(0x253a43).fillRect(x + 12, 490, 100, 64);
      g.lineStyle(1, 0x4b626a).strokeRect(x + 12, 490, 100, 64);
      g.fillStyle(0x809291).fillCircle(x + 18, 497, 2);
    }
    for (const x of [324, 568, 812, 1056]) {
      this.light(x, 460, 84, 0xdac68d);
      g.fillStyle(0xe4d49e, 0.035).fillTriangle(x, 471, x - 42, 569, x + 125, 569);
    }
    this.platform(56, corridorFeetY, 1262, safeFeet.x - 23, 46);
    // The corridor cladding must not occlude the lower half of the real N01 passage.
    this.ladderShaft(roomWorkFeet.x, 405, corridorFeetY, 74);
    // Door frame around N01 ladder exit; the ladder stays visible behind the person.
    g.fillStyle(0x52676c).fillRect(roomWorkFeet.x - 45, 478, 9, 92).fillRect(roomWorkFeet.x + 36, 478, 9, 92).fillRect(roomWorkFeet.x - 45, 474, 90, 9);
    g.fillStyle(0xc3a656).fillRect(roomWorkFeet.x - 39, 481, 3, 78).fillRect(roomWorkFeet.x + 36, 481, 3, 78);
    // Visible lower safe-room access shaft, complete with grip rails and rungs.
    this.ladderShaft(safeFeet.x, corridorFeetY, safeFeet.y, 64);
    this.wallBay(1008, 620, 310, 110);
    g.fillStyle(0x334d4c).fillRect(1020, 641, 285, 87);
    g.fillStyle(0x526b5f).fillRect(1033, 674, 94, 47);
    g.fillStyle(0x94a698).fillRoundedRect(1039, 675, 88, 15, 4);
    g.fillStyle(0x233b3d).fillRect(1040, 715, 5, 16).fillRect(1117, 715, 5, 16);
    g.fillStyle(0x8ba99a).fillRect(1162, 652, 46, 64);
    g.fillStyle(0xd2d9c3).fillRect(1179, 663, 12, 32).fillRect(1169, 673, 32, 12);
    this.light(1061, 628, 106, 0x9ec3ab);
    this.platform(1008, safeFeet.y, 310);
    // Repaint safety ladder inside the room so it visibly meets the room floor.
    this.ladder(safeFeet.x, 620, safeFeet.y);
    // Subfloor industrial systems fill the remaining facility, clearly inaccessible.
    g.fillStyle(0x1f3038).fillRect(56, 620, 923, 133);
    g.lineStyle(3, 0x4d6368).strokeRect(56, 620, 923, 133);
    this.pipe(74, 639, 956, 639, 14, 0x6b7c7c);
    this.pipe(75, 730, 956, 730, 12, 0x536b70);
    for (const x of [146, 394, 644, 884]) {
      g.fillStyle(0x3a505b).fillRoundedRect(x - 30, 655, 101, 65, 13);
      g.lineStyle(3, 0x697d80).strokeRoundedRect(x - 30, 655, 101, 65, 13);
      g.fillStyle(0x1e363f).fillCircle(x + 20, 686, 21);
      g.lineStyle(3, 0xa08f5d).strokeCircle(x + 20, 686, 18);
      g.lineStyle(3, 0xa08f5d).lineBetween(x + 20, 670, x + 20, 702).lineBetween(x + 4, 686, x + 36, 686);
      this.pipe(x + 20, 639, x + 20, 656, 9, 0x6f7f7f);
    }
    // Architectural labels (small signs on actual walls).
    const label = (value: string, x: number, y: number, size = 12, color = '#9aaeb0'): void => { this.add.text(x, y, value, { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: `${size}px`, color }).setDepth(2); };
    label('收容设施 / 07 — 一室空间调度验证', 51, 92, 12, '#9caeae');
    label('N01', 75, 169, 33, '#c6c8ad'); label('奶龙收容室', 75, 207, 14, '#a1b4b3');
    label('观察窗 / 原创概念占位', 454, 174, 11, '#7c9a9e');
    label('封闭机电区 · 非作业空间', 1080, 150, 12, '#9badad');
    label('01  通行走廊', 259, 435, 12, '#96adaf'); label('SAFE / 恢复室', 1027, 624, 12, '#afc7b3');
    label('下层检修设备 · 不可通行', 72, 757, 11, '#738b90');
    label('点击收容室派遣；员工到达工作台后才开始作业', 70, 782, 11, '#799498');
  }

  private wallBay(x: number, y: number, width: number, height: number): void {
    const g = this.background;
    g.fillStyle(0x172830).fillRect(x, y, width, height);
    g.lineStyle(7, 0x617479).strokeRect(x, y, width, height);
    g.lineStyle(2, 0x192a32).strokeRect(x + 8, y + 8, width - 16, height - 16);
    for (let xx = x + 14; xx < x + width; xx += 64) g.fillStyle(0x8d9c96).fillCircle(xx, y + 3, 2);
  }
  private platform(x: number, y: number, width: number, openingX?: number, openingWidth = 0): void {
    const g = this.background;
    const parts = openingX === undefined ? [{ x, width }] : [{ x, width: openingX - x }, { x: openingX + openingWidth, width: x + width - openingX - openingWidth }];
    for (const part of parts) {
      if (part.width <= 0) continue;
      g.fillStyle(0x70817d).fillRect(part.x, y - 12, part.width, 13);
      g.fillStyle(0x32474f).fillRect(part.x, y + 1, part.width, 16);
      g.fillStyle(0x1a2c34).fillRect(part.x, y + 17, part.width, 7);
      g.lineStyle(2, 0x9aab9e).lineBetween(part.x, y - 12, part.x + part.width, y - 12);
      for (let xx = part.x + 5; xx < part.x + part.width - 8; xx += 21) g.lineStyle(1, 0x435951).lineBetween(xx, y - 11, xx + 7, y);
      for (let xx = part.x + 12; xx < part.x + part.width; xx += 54) g.fillStyle(0x889891).fillCircle(xx, y + 9, 2);
    }
  }
  private ladderShaft(x: number, top: number, bottom: number, width: number): void {
    const g = this.background;
    g.fillStyle(0x12262e).fillRect(x - width / 2, top, width, bottom - top);
    g.fillStyle(0x4b6168).fillRect(x - width / 2 - 4, top, 7, bottom - top).fillRect(x + width / 2 - 3, top, 7, bottom - top);
    this.ladder(x, top, bottom);
  }
  private ladder(x: number, top: number, bottom: number): void {
    const g = this.background;
    g.lineStyle(4, 0x7c9393).lineBetween(x - 28, top, x - 28, bottom).lineBetween(x, top, x, bottom).lineBetween(x + 28, top, x + 28, bottom);
    for (let yy = top + 6; yy < bottom + 1; yy += 12) {
      g.lineStyle(4, 0x293f47).lineBetween(x - 29, yy + 2, x + 29, yy + 2);
      g.lineStyle(2, 0xa4b0a6).lineBetween(x - 28, yy, x + 28, yy);
    }
  }
  private light(x: number, y: number, width: number, color: number): void {
    const g = this.background;
    g.fillStyle(0x0c1c23).fillRect(x - 5, y - 3, width + 10, 10);
    g.fillStyle(color, 0.1).fillRect(x - 8, y - 5, width + 16, 23);
    g.fillStyle(color).fillRect(x, y, width, 4);
  }
  private pipe(x1: number, y1: number, x2: number, y2: number, width: number, color: number): void {
    const g = this.background;
    g.lineStyle(width + 5, 0x152932).lineBetween(x1, y1, x2, y2);
    g.lineStyle(width, color).lineBetween(x1, y1, x2, y2);
    g.lineStyle(2, 0x9aa8a1, 0.3).lineBetween(x1, y1 - width / 3, x2, y2 - width / 3);
  }

  private drawFrame(): void {
    if (!this.world) return;
    this.world.clear(); this.overlay.clear(); this.usedLabels = 0;
    const state = this.controller.state; const time = state.simulationTimeSec;
    const room = state.rooms.find((item) => item.anomalyId === 'N01')!;
    this.drawRoomState();
    if (room.mode === 'CONTAINED') {
      drawNailongConcept(this.world, { foot: { x: 461, y: 405 }, facing: -1, time, stride: 0, moving: false, selected: false, hurt: 0, working: room.work?.phase === 'EXECUTING' });
      this.label('N01 / 奶龙', 460, 285, 13, '#c3c7a7');
    }
    this.drawTelegraphs();
    // Back-to-front order keeps two genuine actors distinguishable without moving their logical positions.
    const entities = [...state.employees, ...state.enemies].sort((a, b) => (this.actors.get(a.id)?.foot.y ?? 0) - (this.actors.get(b.id)?.foot.y ?? 0));
    for (const entity of entities) {
      const actor = this.actors.get(entity.id)!;
      if ('hp' in entity) this.drawEmployee(entity, actor);
      else this.drawEnemy(entity, actor);
    }
    this.drawEffects();
    if (this.workMenuOpen) this.drawWorkMenu();
    if (this.dragStart && this.dragNow) {
      const x = Math.min(this.dragStart.x, this.dragNow.x); const y = Math.min(this.dragStart.y, this.dragNow.y);
      const width = Math.abs(this.dragStart.x - this.dragNow.x); const height = Math.abs(this.dragStart.y - this.dragNow.y);
      this.overlay.fillStyle(0x91c1c7, 0.09).fillRect(x, y, width, height);
      this.overlay.lineStyle(1, 0x9bcad0).strokeRect(x, y, width, height);
    }
    for (let index = this.usedLabels; index < this.labels.length; index++) this.labels[index].setVisible(false);
  }

  private drawRoomState(): void {
    const state = this.controller.state; const room = state.rooms[0]; const g = this.world;
    const breached = room.mode === 'BREACHED'; const recovering = room.mode === 'RECOVERING';
    const alarm = breached ? 0xc66b54 : room.pressure >= config.game.pressure.danger ? 0xd2a24d : 0x87afa4;
    const bright = breached ? 0.45 + (Math.sin(state.simulationTimeSec * 8) + 1) * 0.2 : 0.7;
    const usingHatch = state.employees.some((employee) => employee.location.zone === 'ROOM' && employee.location.y > config.game.layout.roomCenterY + 0.01 && employee.location.y < config.game.layout.corridorY);
    if (!usingHatch) {
      // A real platform supports the work stance; the hatch opens only for ladder travel.
      g.fillStyle(0x7d8e85).fillRect(roomWorkFeet.x - 38, roomWorkFeet.y - 12, 76, 13);
      g.fillStyle(0x344b51).fillRect(roomWorkFeet.x - 38, roomWorkFeet.y + 1, 76, 8);
      g.lineStyle(2, 0xb3b79c).lineBetween(roomWorkFeet.x - 38, roomWorkFeet.y - 12, roomWorkFeet.x + 38, roomWorkFeet.y - 12);
      for (let x = roomWorkFeet.x - 32; x < roomWorkFeet.x + 35; x += 17) g.lineStyle(1, 0x445c57).lineBetween(x, roomWorkFeet.y - 10, x + 6, roomWorkFeet.y);
    } else {
      g.fillStyle(0x72857e).fillRect(roomWorkFeet.x - 43, roomWorkFeet.y - 64, 7, 62);
      g.lineStyle(2, 0xa4aa89).lineBetween(roomWorkFeet.x - 43, roomWorkFeet.y - 64, roomWorkFeet.x - 43, roomWorkFeet.y - 2);
    }
    g.fillStyle(alarm, 0.08 * bright).fillRect(307, 167, 389, 216);
    g.fillStyle(0x263b43).fillRect(665, 198, 18, 30);
    g.fillStyle(alarm, bright).fillCircle(674, 212, 6);
    g.fillStyle(alarm, 0.15 * bright).fillCircle(674, 212, 17);
    // The physical warning screen is mounted beside the room workstation.
    g.fillStyle(0x0d222b).fillRoundedRect(78, 247, 182, 55, 3);
    this.label(breached ? '收容失效 / 产能中止' : recovering ? '隔离恢复 / 暂停产能' : room.work ? room.work.phase === 'EXECUTING' ? '作业进行中' : '员工正在前往' : '已收容 / 等待作业', 169, 262, 12, breached ? '#d89c83' : '#9fc4bb');
    this.label(recovering ? `恢复 ${Math.ceil(room.recoveryRemainingSec)} 秒` : breached ? '镇压主样本后重新收容' : `压力 ${Math.ceil(room.pressure)} / ${config.game.pressure.breachThreshold}`, 169, 285, 11, '#879f9e');
    g.fillStyle(0x263e44).fillRect(84, 310, 170, 4);
    if (!breached) g.fillStyle(alarm).fillRect(84, 310, 170 * room.pressure / config.game.pressure.breachThreshold, 4);
    // Door shutters visibly change state at breach; actual entities live downstairs.
    if (breached) {
      g.fillStyle(0x435053).fillRect(308, 169, 19, 215).fillRect(676, 169, 19, 215);
      for (let y = 185; y < 383; y += 24) { g.fillStyle(0xab8a50).fillTriangle(310, y, 325, y + 8, 310, y + 16); g.fillTriangle(694, y, 679, y + 8, 694, y + 16); }
      this.label('!  实体已逃出至走廊', 484, 270, 19, '#bd8a74', 'center', true);
      this.label('停产 · 无镇压收益', 484, 301, 12, '#8c8b7b');
    } else if (recovering) {
      for (let x = 327; x < 691; x += 24) g.fillStyle(0x4f6769, 0.35).fillRect(x, 168, 7, 215);
      this.label('重新收容中', 481, 279, 20, '#8bb0a5');
    }
    if (room.work?.phase === 'EXECUTING') {
      const profile = anomalyById.N01.workProfiles.find((item) => item.type === room.work!.type)!;
      g.fillStyle(0x192f36).fillRoundedRect(335, 220, 140, 7, 2);
      g.fillStyle(0xc7c18a).fillRoundedRect(335, 220, 140 * room.work.elapsedSec / profile.durationSec, 7, 2);
      this.label(`${config.localization[`work.${room.work.type}`]} ${Math.floor(room.work.elapsedSec)} / ${profile.durationSec}秒`, 405, 205, 12, '#a3b4a7');
      // Three original work animations are gestures plus physical equipment response.
      if (room.work.type === 'INTERACT') {
        const pulse = (Math.sin(state.simulationTimeSec * 5) + 1) / 2;
        g.fillStyle(0x9eb8b4, 0.1 + pulse * 0.12).fillCircle(263, 361, 7 + pulse * 9);
      } else if (room.work.type === 'SOOTHE') {
        for (let index = 0; index < 3; index++) {
          const radius = 10 + ((state.simulationTimeSec * 11 + index * 12) % 35);
          g.lineStyle(1, 0x9ab6a2, 0.45 - radius / 120).strokeEllipse(279, 354, radius, radius * 1.3);
        }
      }
    }
  }

  private drawEmployee(employee: EmployeeRuntime, actor: DisplayActor): void {
    const state = this.controller.state;
    if (employee.status === 'INCAPACITATED') {
      this.world.fillStyle(0x314b58).fillRoundedRect(actor.foot.x - 27, actor.foot.y - 8, 50, 11, 4);
      this.label(`${employee.displayName} 重伤`, actor.foot.x, actor.foot.y - 18, 10, '#b68571');
      return;
    }
    const room = state.rooms.find((item) => item.work?.employeeId === employee.id && item.work.phase === 'EXECUTING');
    drawHuman(this.world, employee, { foot: actor.foot, facing: actor.facing, stride: actor.stride, moving: actor.moving, climbing: actor.climbing, time: state.simulationTimeSec, selected: this.controller.selected.has(employee.id), hurt: Math.max(0, actor.hurtUntil - state.simulationTimeSec), impactRemaining: Math.max(0, actor.impactUntil - state.simulationTimeSec), workType: room?.work?.type });
    const x = actor.foot.x; const y = actor.foot.y;
    this.label(employee.displayName, x, y - 82, 11, this.controller.selected.has(employee.id) ? '#c1e1de' : '#879e9e');
    if (this.controller.selected.has(employee.id) || employee.hp < employee.hpMax || employee.sp < employee.spMax) {
      this.world.fillStyle(0x10262c).fillRect(x - 24, y - 74, 48, 7);
      this.world.fillStyle(0x81a88a).fillRect(x - 24, y - 74, 48 * employee.hp / employee.hpMax, 3);
      this.world.fillStyle(0x86b0c1).fillRect(x - 24, y - 70, 48 * employee.sp / employee.spMax, 3);
    }
    if (employee.status === 'PANICKED') this.label('!', x + 20, y - 63, 23, '#e2ab81', 'center', true);
    if (employee.location.zone === 'SAFE' && (employee.hp < employee.hpMax || employee.sp < employee.spMax)) {
      const t = state.simulationTimeSec;
      const lift = t % 1.4 / 1.4 * 26;
      this.label('+', x - 20, y - 35 - lift, 17, '#98c4a2', 'center', true);
    }
  }

  private drawEnemy(enemy: EnemyRuntime, actor: DisplayActor): void {
    const state = this.controller.state; const x = actor.foot.x; const y = actor.foot.y;
    drawNailongConcept(this.world, { foot: actor.foot, facing: actor.facing, time: state.simulationTimeSec, stride: actor.stride, moving: actor.moving, selected: this.controller.selectedEnemyId === enemy.id, hurt: Math.max(0, actor.hurtUntil - state.simulationTimeSec), working: false, enemy });
    const top = y - (enemy.isClone ? 91 : 113);
    this.world.fillStyle(0x11262b).fillRoundedRect(x - 33, top, 66, 5, 1);
    this.world.fillStyle(enemy.isClone ? 0xa19a70 : 0xd0986c).fillRoundedRect(x - 33, top, 66 * enemy.suppressionHp / enemy.suppressionHpMax, 5, 1);
    this.label(enemy.isClone ? '复读分身' : '◆ N01 主样本', x, top - 13, 12, enemy.isClone ? '#a3aaa0' : '#e3c17e', 'center', !enemy.isClone);
    if (enemy.stunnedUntilSec > state.simulationTimeSec) this.label('受控', x, top - 31, 11, '#9fd2d4');
  }

  private drawTelegraphs(): void {
    const state = this.controller.state; const g = this.world;
    for (const enemy of state.enemies) {
      if (enemy.attackPhase !== 'WINDUP' || enemy.windupEndsAtSec === null) continue;
      const configEnemy = anomalyById[enemy.sourceAnomalyId].breach;
      const point = worldToScreen(enemy.location);
      // Physical world range uses the same affine scaling as entities and click projection.
      const radiusX = configEnemy.attackRangePx * SLICE_GEOMETRY.transform.scaleX;
      const radiusY = configEnemy.attackRangePx * SLICE_GEOMETRY.transform.scaleY;
      g.fillStyle(0xc1815d, 0.05).fillEllipse(point.x, point.y, radiusX * 2, radiusY * 2);
      g.lineStyle(1, 0xd5a174, 0.5).strokeEllipse(point.x, point.y, radiusX * 2, radiusY * 2);
      const progress = 1 - Math.max(0, (enemy.windupEndsAtSec - state.simulationTimeSec) / configEnemy.windupSec);
      g.fillStyle(0xddb271).fillRect(point.x - 25, point.y + 15, Math.max(0, 50 * progress), 3);
    }
  }

  private drawEffects(): void {
    const state = this.controller.state; const time = state.simulationTimeSec; const g = this.overlay;
    for (const employee of state.employees) {
      const actor = this.actors.get(employee.id)!;
      if (actor.impactUntil <= time || employee.order.kind !== 'SUPPRESS') continue;
      const targetId = employee.order.enemyId;
      const target = this.actors.get(targetId);
      const fade = Math.min(1, (actor.impactUntil - time) / 0.22);
      if (target) {
        if (weaponById[employee.weaponId].rangePx > weaponById.W00.rangePx) {
          g.lineStyle(3, 0xc4dad8, fade).lineBetween(actor.foot.x + actor.facing * 18, actor.foot.y - 38, target.foot.x, target.foot.y - 39);
        } else {
          const x = actor.foot.x + actor.facing * 33; const y = actor.foot.y - 36;
          g.lineStyle(3, 0xe4dbb9, fade).beginPath().arc(x, y, 24, actor.facing > 0 ? -1.1 : 1.8, actor.facing > 0 ? 1 : 4.2).strokePath();
        }
      }
    }
    for (const item of this.floating) this.label(item.text, item.point.x, item.point.y - (1.1 - Math.min(1.1, item.until - time)) * 20, 13, item.color, 'center', true);
    if (this.destination && time - this.destination.at < 1.4) {
      const x = this.destination.point.x; const y = this.destination.point.y;
      g.lineStyle(2, 0x8ebdbb, 0.8).strokeEllipse(x, y + 2, 26, 8);
      g.lineStyle(2, 0x8ebdbb, 0.8).lineBetween(x, y - 17, x, y - 4);
    }
    if (!this.workMenuOpen && inRect(this.hovered, SLICE_GEOMETRY.room) && !this.employeeAt(this.hovered)) {
      g.lineStyle(1, 0xa9c4bf, 0.22).strokeRect(58, 130, 666, 273);
      this.label('点击房间安排工作', 493, 421, 11, '#89a7a5');
    }
  }

  private drawWorkMenu(): void {
    const g = this.overlay; const menu = SLICE_GEOMETRY.workMenu; const room = this.controller.state.rooms[0];
    const height = 42 + config.game.work.types.length * menu.rowHeight;
    g.fillStyle(0x081920, 0.5).fillRoundedRect(menu.x + 4, menu.y + 6, menu.width, height, 5);
    g.fillStyle(0x243b43).fillRoundedRect(menu.x, menu.y, menu.width, height, 5);
    g.lineStyle(1, 0x718b8a).strokeRoundedRect(menu.x, menu.y, menu.width, height, 5);
    this.label('N01 / 选择工作', menu.x + 15, menu.y + 21, 13, '#bdd1c8', 'left', true);
    for (let index = 0; index < config.game.work.types.length; index++) {
      const type = config.game.work.types[index]; const profile = anomalyById.N01.workProfiles.find((item) => item.type === type)!;
      const y = menu.y + 42 + index * menu.rowHeight;
      const possible = room.mode === 'CONTAINED' && !room.work && this.controller.selected.size === 1;
      g.fillStyle(possible ? 0x36515a : 0x2a3e44).fillRect(menu.x + 5, y, menu.width - 10, menu.rowHeight - 3);
      this.label(config.localization[`work.${type}`], menu.x + 18, y + 18, 14, possible ? '#c8d7c8' : '#6c8384', 'left');
      this.label(`${profile.durationSec}秒  /  +${profile.energy}ϟ`, menu.x + menu.width - 17, y + 18, 11, '#a8b59a', 'right');
    }
  }
}
