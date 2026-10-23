import Phaser from 'phaser';
import type { AnomalyId, EmployeeId, EmployeeRuntime, EnemyRuntime, Point, Rect, WorkType } from '../../contracts/data-contract';
import type { FacilityController } from '../game/FacilityController';
import { anomalyById, config, skillById, weaponById } from '../data/config';
import { drawCreature, drawHuman, INK, type CreaturePose, type HumanPose } from './facility/actors';
import { drawArchitecture } from './facility/architecture';
import { FACILITY_GEOMETRY, ROOM_COLORS, ROOM_RECTS, employeeOffset, inRect, roomWorkFeet } from './facility/geometry';
import facilityMap from '../../config/facility.json';
import { inkBox, inkLine, inkPolygon, PALETTE } from '../art/ink';
import { drawBreachFrame, drawInkImpact, drawPanicMarks } from '../art/effects';
import { HumanRig, PERSONNEL_TEXTURES } from '../art/generated/HumanRig';
import { CreatureRig, CREATURE_TEXTURES } from '../art/generated/CreatureRig';
import { EnvironmentArt } from '../art/generated/EnvironmentArt';
import { EffectsArt, preloadEffectsArt } from '../art/generated/EffectsArt';
import artCoverage from '../art/generated/nm-v2-coverage.json';

interface DisplayActor {
  world: Point; foot: Point; stride: number; facing: -1 | 1; moving: boolean; climbing: boolean;
  previousHp: number; previousSp?: number; hurtUntil: number; impactUntil: number; previousWindup: number | null;
}
interface Feedback { point: Point; text: string; color: string; until: number }
const damageColors = { RED: 0xe85c52, WHITE: 0xe8dcae, BLACK: 0xbe84ca, PALE: 0x74c5d7 };
const MINI_MAP: Rect = { x: 1098, y: 608, width: 230, height: 174 };
const MINI_INNER: Rect = { x: 1108, y: 637, width: 210, height: 130 };
const mapNode = (id: string): Point => facilityMap.nodes.find(node => node.id === id)!;

/** Five-room production scene. UI, poses, hit tests and commands all refer to the same live entities. */
export class ContainmentFacilityScene extends Phaser.Scene {
  static readonly geometry = FACILITY_GEOMETRY;
  private world!: Phaser.GameObjects.Graphics;
  private effects!: Phaser.GameObjects.Graphics;
  private overlay!: Phaser.GameObjects.Graphics;
  private worldRoot!: Phaser.GameObjects.Container;
  private screenRoot!: Phaser.GameObjects.Container;
  private labels: Phaser.GameObjects.Text[] = [];
  private screenLabels: Phaser.GameObjects.Text[] = [];
  private usedLabels = 0;
  private usedScreenLabels = 0;
  private actors = new Map<string, DisplayActor>();
  private floating: Feedback[] = [];
  private workMenuRoom: AnomalyId | null = null;
  private dragStart: Point | null = null;
  private dragNow: Point | null = null;
  private roomClickCandidate: AnomalyId | null = null;
  private hovered: Point = { x: 0, y: 0 };
  private lastProduced = 0;
  private lastTime = 0;
  private previousSimulation: FacilityController['simulation'] | null = null;
  private destination: { point: Point; at: number } | null = null;
  private priorWork = new Map<AnomalyId, { workId: string; employeeId: EmployeeId; energy: number }>();
  private skillFlash: { point: Point; radius: number; color: number; until: number } | null = null;
  private cameraCenter: Point = { ...facilityMap.camera.center };
  private cameraZoom: number = facilityMap.camera.zoom;
  private panStart: { pointer: Point; center: Point } | null = null;
  private following: EmployeeId | null = null;
  private humanArt!: HumanRig;
  private creatureArt!: CreatureRig;
  private environmentArt!: EnvironmentArt;
  private generatedEffects!: EffectsArt;
  private artLoadErrors: string[] = [];

  constructor(readonly controller: FacilityController) { super('containment-facility'); }
  preload(): void {
    this.artLoadErrors=[];
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.artLoadErrors.push(file.key));
    for(const asset of [...PERSONNEL_TEXTURES,...CREATURE_TEXTURES]) if(!this.textures.exists(asset.key))this.load.image(asset.key,asset.url);
    EnvironmentArt.preload(this);
    preloadEffectsArt(this);
  }
  create(): void {
    const view = FACILITY_GEOMETRY.view;
    this.cameras.main.setViewport(view.x, view.y, view.width, view.height).setBackgroundColor('#181a20');
    this.worldRoot = this.add.container();
    this.screenRoot = this.add.container().setDepth(100);
    const uiCamera = this.cameras.add(0, 0, config.game.layout.width, config.game.layout.height, false, 'facility-interface');
    // Filter the roots themselves: ignore(container) only visits children that already exist.
    this.worldRoot.cameraFilter |= uiCamera.id;
    this.screenRoot.cameraFilter |= this.cameras.main.id;
    const background = this.add.graphics();
    this.worldRoot.add(background);
    this.environmentArt = new EnvironmentArt(this, this.worldRoot);
    drawArchitecture(background, (text, x, y, size = 12, color = '#eee5cf') => {
      this.worldRoot.add(this.add.text(x, y, text, { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: size, color }));
    }, this.environmentArt);
    this.world = this.add.graphics();
    this.effects = this.add.graphics();
    this.worldRoot.add(this.world);
    this.creatureArt = new CreatureRig(this, this.worldRoot);
    // Keep the controllable bodies and held weapons readable when enemies overlap them.
    this.humanArt = new HumanRig(this, this.worldRoot);
    this.worldRoot.add(this.effects);
    this.generatedEffects = new EffectsArt(this, this.worldRoot);
    this.overlay = this.add.graphics();
    this.screenRoot.add(this.overlay);
    this.applyCamera();
    this.syncActors();
    this.drawFrame();
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.onDown(pointer));
    this.input.on('pointerup', (pointer: Phaser.Input.Pointer) => this.onUp(pointer));
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.hovered = { x: pointer.x, y: pointer.y };
      if (this.panStart) {
        this.cameraCenter = {
          x: this.panStart.center.x - (pointer.x - this.panStart.pointer.x) / this.cameraZoom,
          y: this.panStart.center.y - (pointer.y - this.panStart.pointer.y) / this.cameraZoom,
        };
        this.applyCamera();
      }
      if (this.dragStart) this.dragNow = { ...this.hovered };
    });
    this.input.on('wheel', (pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      if (!this.controller.inputBlocked && inRect(pointer, view)) this.zoomAt(pointer, this.cameraZoom * (dy > 0 ? 0.88 : 1.14));
    });
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (event.repeat || this.controller.inputBlocked || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName ?? '')) return;
      if (event.code === 'Space') { event.preventDefault(); this.controller.togglePause(); }
      else if (event.code === 'KeyS') this.controller.stop();
      else if (event.code === 'KeyR') this.controller.retreat();
      else if (event.code === 'Home') { event.preventDefault(); this.overview(); }
      else if (event.code === 'KeyF') this.focusSelection();
      else if (event.code === 'Escape') {
        if (this.controller.activeSkillId) this.controller.cancelSkill();
        else this.workMenuRoom = null;
      }
    });
  }
  update(_time: number, delta: number): void {
    this.controller.simulation.advance(delta / 1000);
    if (this.controller.inputBlocked) {
      this.dragStart = null; this.dragNow = null; this.workMenuRoom = null; this.roomClickCandidate = null; this.panStart = null;
    }
    this.syncActors();
    if (this.following) {
      const employee = this.controller.state.employees.find(item => item.id === this.following);
      if (employee) { this.cameraCenter = { x: employee.location.x, y: employee.location.y - 90 }; this.applyCamera(); }
    }
    this.drawFrame();
  }

  getEmployeeFootPoint(id: EmployeeId): Point | null { const actor = this.actors.get(id); return actor ? this.project(actor.foot) : null; }
  getEmployeeScreenPoint(id: EmployeeId): Point | null { const p = this.actors.get(id)?.foot; return p ? this.project({ x: p.x, y: p.y - 34 }) : null; }
  getEnemyScreenPoint(id: string): Point | null { const p = this.actors.get(id)?.foot; return p ? this.project({ x: p.x, y: p.y - 43 }) : null; }
  getCorridorScreenPoint(point: Point | number): Point { return this.project(typeof point === 'number' ? { x: point, y: 1360 } : point); }
  getRoomClickPoint(id: AnomalyId): Point { const rect = ROOM_RECTS[id]; return this.project({ x: rect.x + rect.width / 2, y: rect.y + 72 }); }
  workClickPoint(): Point { return this.getRoomClickPoint(this.controller.selectedRoomId ?? 'N01'); }
  safeClickPoint(): Point { return this.project({ x: facilityMap.safePoint.x, y: facilityMap.safePoint.y - 70 }); }
  getMapState(): unknown { return facilityMap; }
  getCameraState(): { center: Point; zoom: number; view: Rect; worldView: Rect; following: EmployeeId | null } {
    const view = FACILITY_GEOMETRY.view;
    return { center: { ...this.cameraCenter }, zoom: this.cameraZoom, view, following: this.following,
      worldView: { x: this.cameraCenter.x - view.width / (2 * this.cameraZoom), y: this.cameraCenter.y - view.height / (2 * this.cameraZoom), width: view.width / this.cameraZoom, height: view.height / this.cameraZoom } };
  }
  getMapNavigationPoint(target: Point | AnomalyId | EmployeeId): Point {
    let point: Point;
    if (typeof target !== 'string') point = target;
    else if (target.startsWith('N')) { const rect = ROOM_RECTS[target as AnomalyId]; point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; }
    else { const e = this.controller.state.employees.find(item => item.id === target); point = e ? e.location : facilityMap.safePoint; }
    return this.toMini(point);
  }
  getCameraControls(): { overview: Point; focus: Point; zoomOut: Point; zoomIn: Point; rooms: Record<AnomalyId, Point> } {
    return { overview: { x: 1106, y: 100 }, focus: { x: 1186, y: 100 }, zoomOut: { x: 1251, y: 100 }, zoomIn: { x: 1297, y: 100 },
      rooms: Object.fromEntries(config.anomalyData.anomalies.map((item, i) => [item.id, { x: 86 + i * 110, y: 100 }])) as Record<AnomalyId, Point> };
  }
  private project(point: Point): Point {
    const view = FACILITY_GEOMETRY.view;
    return { x: view.x + view.width / 2 + (point.x - this.cameraCenter.x) * this.cameraZoom, y: view.y + view.height / 2 + (point.y - this.cameraCenter.y) * this.cameraZoom };
  }
  private unproject(point: Point): Point {
    const view = FACILITY_GEOMETRY.view;
    return { x: this.cameraCenter.x + (point.x - view.x - view.width / 2) / this.cameraZoom, y: this.cameraCenter.y + (point.y - view.y - view.height / 2) / this.cameraZoom };
  }
  private applyCamera(): void {
    const view = FACILITY_GEOMETRY.view, bounds = facilityMap.bounds;
    const halfW = view.width / this.cameraZoom / 2, halfH = view.height / this.cameraZoom / 2;
    this.cameraCenter.x = halfW * 2 >= bounds.width ? bounds.width / 2 : Phaser.Math.Clamp(this.cameraCenter.x, halfW, bounds.width - halfW);
    this.cameraCenter.y = halfH * 2 >= bounds.height ? bounds.height / 2 : Phaser.Math.Clamp(this.cameraCenter.y, halfH, bounds.height - halfH);
    this.cameras.main.setZoom(this.cameraZoom).centerOn(this.cameraCenter.x, this.cameraCenter.y);
  }
  private zoomAt(point: Point, zoom: number): void {
    const fixed = this.unproject(point);
    this.following = null;
    this.cameraZoom = Phaser.Math.Clamp(zoom, facilityMap.camera.minZoom, facilityMap.camera.maxZoom);
    const moved = this.unproject(point);
    this.cameraCenter.x += fixed.x - moved.x; this.cameraCenter.y += fixed.y - moved.y;
    this.applyCamera();
  }
  private overview(): void {
    this.following = null; this.workMenuRoom = null;
    this.cameraZoom = Math.min(FACILITY_GEOMETRY.view.width / facilityMap.bounds.width, FACILITY_GEOMETRY.view.height / facilityMap.bounds.height) * 0.98;
    this.cameraCenter = { x: facilityMap.bounds.width / 2, y: facilityMap.bounds.height / 2 };
    this.applyCamera();
  }
  private focusSelection(): void {
    const id = [...this.controller.selected][0], employee = this.controller.state.employees.find(item => item.id === id);
    if (employee) {
      this.following = employee.id; this.cameraCenter = { x: employee.location.x, y: employee.location.y - 90 }; this.cameraZoom = 1; this.applyCamera();
    } else if (this.controller.selectedRoomId) this.focusRoom(this.controller.selectedRoomId);
  }
  private focusRoom(id: AnomalyId): void {
    const rect = ROOM_RECTS[id]; this.following = null; this.workMenuRoom = null;
    this.cameraCenter = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 + 50 }; this.cameraZoom = 0.95; this.applyCamera();
    this.controller.selectRoom(id);
  }
  private toMini(point: Point): Point { return { x: MINI_INNER.x + point.x / facilityMap.bounds.width * MINI_INNER.width, y: MINI_INNER.y + point.y / facilityMap.bounds.height * MINI_INNER.height }; }
  private corridorTarget(screen: Point): Point | null {
    const p = this.unproject(screen);
    let closest: { point: Point; score: number } | null = null;
    for (const edge of facilityMap.edges) {
      if (edge.kind !== 'CORRIDOR') continue;
      const a = mapNode(edge.from), b = mapNode(edge.to);
      if (p.y < a.y - 120 || p.y > a.y + 32 || p.x < Math.min(a.x, b.x) - 20 || p.x > Math.max(a.x, b.x) + 20) continue;
      const point = { x: Phaser.Math.Clamp(p.x, Math.min(a.x, b.x), Math.max(a.x, b.x)), y: a.y };
      const score = Math.abs(p.y - a.y) + Math.abs(point.x - p.x);
      if (!closest || score < closest.score) closest = { point, score };
    }
    return closest?.point ?? null;
  }
  getWorkChoicePoint(type: WorkType = 'OBSERVE'): Point {
    const menu = this.menuRect();
    return { x: menu.x + menu.width / 2, y: menu.y + 44 + config.game.work.types.indexOf(type) * FACILITY_GEOMETRY.menuRowHeight + FACILITY_GEOMETRY.menuRowHeight / 2 };
  }
  getAnimationState(): unknown {
    const state = this.controller.state;
    return {
      time: state.simulationTimeSec,
      actors: [...this.actors.entries()].map(([id, actor]) => {
        const employee = state.employees.find(item => item.id === id);
        const enemy = state.enemies.find(item => item.id === id);
        const entity = employee ?? enemy;
        const profile = enemy ? anomalyById[enemy.sourceAnomalyId].breach : employee ? weaponById[employee.weaponId] : null;
        return {
          id, foot: { ...actor.foot }, world: { ...actor.world }, facing: actor.facing, stride: actor.stride,
          pose: actor.climbing ? 'CLIMB' : actor.moving ? 'WALK' : employee?.status === 'WORKING' ? 'WORK' : entity?.attackPhase === 'WINDUP' ? 'WINDUP' : actor.impactUntil > state.simulationTimeSec ? 'SWING' : 'IDLE',
          attackPhase: entity?.attackPhase, weaponId: employee?.weaponId, armorId: employee?.armorId,
          attackProgress: entity?.windupEndsAtSec != null && profile ? Math.max(0, Math.min(1, 1 - (entity.windupEndsAtSec - state.simulationTimeSec) / profile.windupSec)) : 0,
          telegraph: enemy ? { center: this.project(enemy.location), worldCenter: { x: enemy.location.x, y: enemy.location.y }, radius: anomalyById[enemy.sourceAnomalyId].breach.attackRangePx, radiusX: anomalyById[enemy.sourceAnomalyId].breach.attackRangePx * this.cameraZoom, radiusY: anomalyById[enemy.sourceAnomalyId].breach.attackRangePx * this.cameraZoom, targetScope: anomalyById[enemy.sourceAnomalyId].breach.targetScope } : null,
          hurtRemaining: Math.max(0, actor.hurtUntil - state.simulationTimeSec),
        };
      }),
      rooms: state.rooms.map(room => ({ id: room.anomalyId, mode: room.mode, workElapsed: room.work?.elapsedSec ?? null })),
    };
  }
  getGeneratedArtState(): unknown {
    return {version:'modern-media-v2',coverage:artCoverage,creatureReadiness:this.creatureArt.getReadiness(),loadErrors:[...this.artLoadErrors],
      environmentComplete:this.environmentArt.complete,environmentUsage:this.environmentArt.getUsage(),
      personnel:this.humanArt.getState(),creatures:this.creatureArt.getState(),effects:this.generatedEffects.getState()};
  }
  private menuRect(): Rect {
    const room = ROOM_RECTS[this.workMenuRoom ?? this.controller.selectedRoomId ?? 'N01'];
    const p = this.project({ x: room.x + room.width / 2, y: room.y + 90 });
    const y = Phaser.Math.Clamp(p.y, 142, 578);
    const height = 44 + FACILITY_GEOMETRY.menuRowHeight * config.game.work.types.length;
    const maxX = y + height > MINI_MAP.y ? MINI_MAP.x - FACILITY_GEOMETRY.menuWidth - 12 : 1060;
    return { x: Phaser.Math.Clamp(p.x - 119, 36, maxX), y, width: FACILITY_GEOMETRY.menuWidth, height };
  }
  private onDown(pointer: Phaser.Input.Pointer): void {
    if (this.controller.inputBlocked) return;
    const point = { x: pointer.x, y: pointer.y };
    if (!inRect(point, FACILITY_GEOMETRY.view)) return;
    if (pointer.middleButtonDown() || (pointer.leftButtonDown() && pointer.event.altKey)) {
      this.following = null; this.workMenuRoom = null;
      this.panStart = { pointer: point, center: { ...this.cameraCenter } }; return;
    }
    if (inRect(point, MINI_MAP)) {
      if (inRect(point, MINI_INNER)) {
        this.following = null; this.workMenuRoom = null;
        this.cameraCenter = { x: (point.x - MINI_INNER.x) / MINI_INNER.width * facilityMap.bounds.width, y: (point.y - MINI_INNER.y) / MINI_INNER.height * facilityMap.bounds.height };
        this.applyCamera();
      }
      return;
    }
    const controls = this.getCameraControls();
    if (Math.abs(point.y - 100) <= 16) {
      if (Math.abs(point.x - controls.overview.x) < 38) { this.overview(); return; }
      if (Math.abs(point.x - controls.focus.x) < 38) { this.focusSelection(); return; }
      if (Math.abs(point.x - controls.zoomOut.x) < 20) { this.zoomAt({ x: 680, y: 436 }, this.cameraZoom / 1.2); return; }
      if (Math.abs(point.x - controls.zoomIn.x) < 20) { this.zoomAt({ x: 680, y: 436 }, this.cameraZoom * 1.2); return; }
      for (const [id, center] of Object.entries(controls.rooms)) if (Math.abs(point.x - center.x) < 53) { this.focusRoom(id as AnomalyId); return; }
    }
    const worldPoint = this.unproject(point);
    const enemy = this.enemyAt(point);
    if (pointer.rightButtonDown()) {
      if (this.controller.activeSkillId) { this.controller.cancelSkill(); return; }
      if (this.workMenuRoom) { this.workMenuRoom = null; return; }
      if (!this.controller.selected.size) { this.controller.notify('先点击员工或拖框选人，再右键下令。'); return; }
      if (enemy) {
        this.controller.selectedEnemyId = enemy.id;
        this.controller.issue({ type: 'SUPPRESS', employeeIds: [...this.controller.selected], enemyId: enemy.id });
      } else if (inRect(worldPoint, facilityMap.safeRect)) this.controller.retreat();
      else if (this.corridorTarget(point)) {
        const target = this.corridorTarget(point)!;
        if (this.controller.issue({ type: 'MOVE', employeeIds: [...this.controller.selected], point: target }).ok) this.destination = { point: target, at: this.controller.state.simulationTimeSec };
      } else this.controller.notify('右键走廊移动，右键异常镇压，右键安全室撤退。');
      return;
    }
    if (this.controller.activeSkillId) { this.castSkill(point, enemy); return; }
    if (this.workMenuRoom) {
      const menu = this.menuRect();
      const type = config.game.work.types.find((_type, index) => inRect(point, { x: menu.x, y: menu.y + 44 + FACILITY_GEOMETRY.menuRowHeight * index, width: menu.width, height: FACILITY_GEOMETRY.menuRowHeight }));
      if (type) {
        if (this.controller.assignWork(type, this.workMenuRoom).ok) this.workMenuRoom = null;
        return;
      }
      this.workMenuRoom = null;
    }
    // Compare across categories: a nearby worker must not steal a click on an enemy's center.
    const employee = this.employeeAt(point);
    const ep = employee ? this.getEmployeeScreenPoint(employee.id)! : null;
    const np = enemy ? this.getEnemyScreenPoint(enemy.id)! : null;
    if (employee && ep && (!np || Math.hypot(point.x - ep.x, point.y - ep.y) <= Math.hypot(point.x - np.x, point.y - np.y))) {
      this.controller.select([employee.id], pointer.event.shiftKey);
      if (pointer.event.detail >= 2) this.focusSelection();
      return;
    }
    if (enemy) {
      this.controller.selectedEnemyId = enemy.id; this.controller.selectRoom(enemy.sourceAnomalyId);
      this.controller.notify(`${anomalyById[enemy.sourceAnomalyId].name}${enemy.isClone ? '分身' : '主样本'}：选员工后右键该实体镇压。`); return;
    }
    this.roomClickCandidate = config.anomalyData.anomalies.find(item => inRect(worldPoint, ROOM_RECTS[item.id]))?.id ?? null;
    this.dragStart = point; this.dragNow = point;
  }
  private onUp(pointer: Phaser.Input.Pointer): void {
    if (this.panStart) { this.panStart = null; return; }
    if (this.controller.inputBlocked || !this.dragStart || !this.dragNow) return;
    const a = this.dragStart; const b = this.dragNow;
    this.dragStart = null; this.dragNow = null;
    if (Math.hypot(a.x - b.x, a.y - b.y) < 6) {
      if (this.roomClickCandidate) { this.controller.selectRoom(this.roomClickCandidate); this.workMenuRoom = this.roomClickCandidate; }
      this.roomClickCandidate = null; return;
    }
    this.roomClickCandidate = null;
    const rect = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
    this.controller.select(this.controller.state.employees.filter(e => {
      const p = this.getEmployeeScreenPoint(e.id);
      return p && e.status !== 'INCAPACITATED' && e.status !== 'PANICKED' && inRect(p, rect);
    }).map(e => e.id), pointer.event.shiftKey);
  }
  private employeeAt(point: Point): EmployeeRuntime | undefined {
    return this.controller.state.employees.map(employee => ({ employee, center: this.getEmployeeScreenPoint(employee.id) })).filter(entry => entry.center && Math.abs(point.x - entry.center.x) <= Math.max(8, 19 * this.cameraZoom) && Math.abs(point.y - entry.center.y) <= Math.max(12, 35 * this.cameraZoom)).sort((a, b) => Math.hypot(point.x - a.center!.x, point.y - a.center!.y) - Math.hypot(point.x - b.center!.x, point.y - b.center!.y))[0]?.employee;
  }
  private enemyAt(point: Point): EnemyRuntime | undefined {
    return this.controller.state.enemies.map(enemy => ({ enemy, center: this.getEnemyScreenPoint(enemy.id) })).filter(entry => entry.center && Math.abs(point.x - entry.center.x) <= Math.max(12, (entry.enemy.sourceAnomalyId === 'N03' ? 53 : 34) * this.cameraZoom) && Math.abs(point.y - entry.center.y) <= Math.max(15, (entry.enemy.isClone ? 34 : 50) * this.cameraZoom)).sort((a, b) => Math.hypot(point.x - a.center!.x, point.y - a.center!.y) - Math.hypot(point.x - b.center!.x, point.y - b.center!.y))[0]?.enemy;
  }
  private castSkill(point: Point, enemy?: EnemyRuntime): void {
    const id = this.controller.activeSkillId;
    if (!id) return;
    const skill = skillById[id];
    let center = this.unproject(point);
    let ok = false;
    if (skill.target === 'SINGLE_ENEMY') {
      if (!enemy) { this.controller.notify('请选择真实失效实体。'); return; }
      center = { ...enemy.location };
      ok = this.controller.castAt({ kind: 'ENEMY', enemyId: enemy.id }).ok;
    } else if (skill.target === 'CORRIDOR_POINT') {
      const target = this.corridorTarget(point);
      if (!target) { this.controller.notify('这个技能需要点击走廊。'); return; }
      center = target;
      ok = this.controller.castAt({ kind: 'POINT', point: target }).ok;
    } else if (skill.target === 'FACILITY_POINT') ok = this.controller.castAt({ kind: 'POINT', point: this.unproject(point) }).ok;
    else ok = this.controller.castAt({ kind: 'GLOBAL' }).ok;
    if (ok) this.skillFlash = { point: center, radius: 'radiusPx' in skill ? skill.radiusPx : 38, color: id === 'S05' ? 0x79dbc3 : 0xffd05f, until: this.controller.state.simulationTimeSec + 0.55 };
  }
  private syncActors(): void {
    const state = this.controller.state; const time = state.simulationTimeSec;
    if (this.previousSimulation !== this.controller.simulation || time < this.lastTime) {
      this.actors.clear(); this.floating = []; this.workMenuRoom = null; this.priorWork.clear(); this.skillFlash = null;
      this.lastProduced = state.producedToday; this.destination = null;
    }
    this.previousSimulation = this.controller.simulation;
    const advanced = time > this.lastTime; this.lastTime = time;
    const all = [...state.employees, ...state.enemies];
    for (const entity of all) {
      const employee = 'hp' in entity ? entity : null; const enemy = 'suppressionHp' in entity ? entity : null;
      const hp = employee?.hp ?? enemy!.suppressionHp;
      let actor = this.actors.get(entity.id); const point = { x: entity.location.x, y: entity.location.y };
      if (employee) { const offset = employeeOffset(state.employees.indexOf(employee)); point.x += offset.x; point.y += offset.y; }
      else if (enemy?.isClone) {
        const index = state.enemies.filter(e => e.isClone && e.breachInstanceId === enemy.breachInstanceId).indexOf(enemy);
        point.x += index === 0 ? -38 : 38; point.y -= 12;
      }
      if (!actor) {
        actor = { world: { x: entity.location.x, y: entity.location.y }, foot: point, stride: 0, facing: -1, moving: false, climbing: false, previousHp: hp, previousSp: employee?.sp, hurtUntil: 0, impactUntil: 0, previousWindup: entity.windupEndsAtSec };
        this.actors.set(entity.id, actor);
      }
      if (advanced) {
        const dx = entity.location.x - actor.world.x; const dy = entity.location.y - actor.world.y; const moved = Math.hypot(dx, dy);
        actor.moving = moved > 0.00001;
        if (actor.moving) actor.stride += moved / (Math.abs(dy) > Math.abs(dx) ? 5.5 : 8.5);
        if (Math.abs(dx) > 0.00001) actor.facing = dx > 0 ? 1 : -1;
        actor.climbing = Boolean(employee && entity.location.zone === 'TRANSIT'); actor.world = { x: entity.location.x, y: entity.location.y };
        if (employee?.status === 'WORKING') { actor.facing = 1; actor.moving = false; actor.climbing = false; }
        if (employee?.order.kind === 'SUPPRESS') {
          const targetId = employee.order.enemyId; const target = state.enemies.find(e => e.id === targetId);
          if (target && !actor.climbing) actor.facing = target.location.x >= employee.location.x ? 1 : -1;
        }
        if (enemy?.targetEmployeeId) { const target = state.employees.find(e => e.id === enemy.targetEmployeeId); if (target) actor.facing = target.location.x >= enemy.location.x ? 1 : -1; }
      }
      actor.foot = point;
      // Real windup completion, not arbitrary playback, triggers the brief follow-through pose.
      if (actor.previousWindup !== null && entity.windupEndsAtSec === null && time + 0.000001 >= actor.previousWindup) actor.impactUntil = time + 0.22;
      actor.previousWindup = entity.windupEndsAtSec;
      const hpLoss = actor.previousHp - hp; const spLoss = employee ? (actor.previousSp ?? employee.sp) - employee.sp : 0;
      if (hpLoss > 0.01 || spLoss > 0.01) {
        actor.hurtUntil = time + 0.3;
        const values = [hpLoss > 0.01 ? `−${Math.round(hpLoss * 10) / 10}${employee ? ' HP' : ''}` : '', spLoss > 0.01 ? `−${Math.round(spLoss * 10) / 10} SP` : ''].filter(Boolean);
        this.floating.push({ point: { x: point.x, y: point.y - (employee ? 81 : 114) }, text: values.join(' / '), color: '#ffb6a0', until: time + 1.1 });
      }
      actor.previousHp = hp; actor.previousSp = employee?.sp;
    }
    const ids = new Set(all.map(entity => entity.id)); for (const id of this.actors.keys()) if (!ids.has(id)) this.actors.delete(id);
    if (state.producedToday > this.lastProduced) {
      const completed = [...this.priorWork.entries()].filter(([id, work]) => !state.rooms.find(room => room.anomalyId === id)?.work && state.rooms.find(room => room.anomalyId === id)?.memory.lastCompletedEmployeeId === work.employeeId);
      if (completed.length) for (const [id, work] of completed) { const p = roomWorkFeet(id); this.floating.push({ point: { x: p.x, y: p.y - 94 }, text: `+${work.energy} 能量`, color: '#fff1a3', until: time + 1.8 }); }
      else this.floating.push({ point: { x: 680, y: 470 }, text: `+${state.producedToday - this.lastProduced} 能量`, color: '#fff1a3', until: time + 1.8 });
    }
    this.lastProduced = state.producedToday; this.priorWork.clear();
    for (const room of state.rooms) if (room.work) this.priorWork.set(room.anomalyId, { workId: room.work.workId, employeeId: room.work.employeeId, energy: anomalyById[room.anomalyId].workProfiles.find(p => p.type === room.work?.type)!.energy });
    this.floating = this.floating.filter(item => item.until > time);
  }
  private label(value: string, x: number, y: number, size = 13, color = '#eee5cf', align: 'left' | 'center' | 'right' = 'center', bold = false): void {
    let text = this.labels[this.usedLabels++];
    if (!text) { text = this.add.text(x, y, value, { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: size, color }); this.worldRoot.add(text); this.labels.push(text); }
    text.setText(value).setPosition(x, y).setFontSize(size).setFontStyle(bold ? 'bold' : 'normal').setOrigin(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5).setVisible(true);
    if (text.style.color !== color) text.setColor(color);
    text.setStroke('#1b1d24', size < 15 ? 2 : 3);
  }
  private screenLabel(value: string, x: number, y: number, size = 12, color = '#ded8c6', align: 'left' | 'center' | 'right' = 'center', bold = false): void {
    let text = this.screenLabels[this.usedScreenLabels++];
    if (!text) { text = this.add.text(x, y, value, { fontFamily: '"Microsoft YaHei", sans-serif', fontSize: size, color }); this.screenRoot.add(text); this.screenLabels.push(text); }
    text.setText(value).setPosition(x, y).setFontSize(size).setFontStyle(bold ? 'bold' : 'normal').setOrigin(align === 'left' ? 0 : align === 'right' ? 1 : 0.5, 0.5).setVisible(true);
    if (text.style.color !== color) text.setColor(color);
  }
  private drawFrame(): void {
    this.world.clear(); this.effects.clear(); this.overlay.clear(); this.usedLabels = 0; this.usedScreenLabels = 0;
    this.humanArt.beginFrame(); this.creatureArt.beginFrame(); this.generatedEffects.beginFrame();
    const state = this.controller.state;
    const safeDoor=mapNode('safe-door');
    this.environmentArt.setDoorOpen('SAFE',state.employees.some(e=>Math.hypot(e.location.x-safeDoor.x,e.location.y-safeDoor.y)<70));
    for (const room of state.rooms) this.drawRoom(room.anomalyId);
    this.drawTelegraphs();
    this.drawSelectedRoute();
    const entities = [...state.employees, ...state.enemies].sort((a, b) => (this.actors.get(a.id)?.foot.y ?? 0) - (this.actors.get(b.id)?.foot.y ?? 0));
    for (const entity of entities) { const actor = this.actors.get(entity.id)!; if ('hp' in entity) this.drawEmployee(entity, actor); else this.drawEnemy(entity, actor); }
    this.drawEffects();
    if (this.controller.activeSkillId && !this.controller.inputBlocked) this.drawSkillPreview();
    this.drawMapInterface();
    if (this.workMenuRoom && !this.controller.inputBlocked && !this.controller.activeSkillId) this.drawWorkMenu();
    if (this.dragStart && this.dragNow) {
      const x = Math.min(this.dragStart.x, this.dragNow.x); const y = Math.min(this.dragStart.y, this.dragNow.y); const width = Math.abs(this.dragStart.x - this.dragNow.x); const height = Math.abs(this.dragStart.y - this.dragNow.y);
      this.overlay.fillStyle(0xffdb72, 0.13).fillRect(x, y, width, height); this.overlay.lineStyle(2, 0xffd35a).strokeRect(x, y, width, height);
    }
    for (let index = this.usedLabels; index < this.labels.length; index++) this.labels[index].setVisible(false);
    for (let index = this.usedScreenLabels; index < this.screenLabels.length; index++) this.screenLabels[index].setVisible(false);
    this.humanArt.endFrame(); this.creatureArt.endFrame(); this.generatedEffects.endFrame();
  }
  private drawRoom(id: AnomalyId): void {
    const state = this.controller.state, room = state.rooms.find(item => item.anomalyId === id)!;
    const rect = ROOM_RECTS[id], foot = roomWorkFeet(id), g = this.world, time = state.simulationTimeSec;
    const definition = facilityMap.rooms[id], creaturePoint = definition.creaturePoint, door = mapNode(definition.doorNodeId);
    const breached = room.mode === 'BREACHED', recovering = room.mode === 'RECOVERING', locked = room.mode === 'LOCKED';
    const danger = !locked && !breached && room.pressure >= config.game.pressure.danger;
    const alarm = breached ? PALETTE.alarm : danger ? 0xd5844d : PALETTE.moss;
    const light = breached ? 0.5 + (Math.sin(time * 8) + 1) * 0.25 : 1;
    const doorX = door.x < rect.x + rect.width / 2 ? rect.x + 5 : rect.x + rect.width - 25;
    const usingDoor = state.employees.some(e => Math.hypot(e.location.x - door.x, e.location.y - door.y) < 70);
    inkBox(g, doorX - 5, door.y - 117, 32, 20, INK, 2, 3);
    inkBox(g, doorX, door.y - 112, 22, 9, locked ? 0x676a69 : alarm, 1, 7, light);
    this.environmentArt.setDoorOpen(id, usingDoor || breached);
    if (!this.environmentArt.complete && !usingDoor && !breached) {
      g.fillStyle(0x424c50).fillRect(doorX + 4, door.y - 91, 14, 88);
      g.lineStyle(2, 0x98aaa0).lineBetween(doorX + 11, door.y - 82, doorX + 11, door.y - 11);
    } else if(usingDoor || breached)g.lineStyle(5, breached ? 0xba5348 : 0xd8be73).lineBetween(doorX, door.y - 94, doorX + 24, door.y - 94);
    if (breached) {
      g.fillStyle(alarm, light * 0.1).fillRect(rect.x + 16, rect.y + 60, rect.width - 32, rect.height - 68);
      drawBreachFrame(g, rect, time);
      this.generatedEffects.breach(rect,time,id);
    }
    if (danger) {
      inkPolygon(g, [{ x: rect.x + 24, y: rect.y + 82 }, { x: rect.x + 36, y: rect.y + 61 }, { x: rect.x + 48, y: rect.y + 82 }], 0xd5844d, 2, 9);
      this.label('!', rect.x + 36, rect.y + 74, 14, '#211e24', 'center', true);
    }
    if (locked) {
      g.fillStyle(0x30383d, 0.97).fillRect(rect.x + 17, rect.y + 60, rect.width - 34, rect.height - 66);
      for (let y = rect.y + 70; y < rect.y + rect.height - 8; y += 17) g.lineStyle(4, 0x1e252b).lineBetween(rect.x + 20, y, rect.x + rect.width - 20, y);
      this.label(`第 ${anomalyById[id].unlockDay} 日开放`, rect.x + rect.width / 2, rect.y + rect.height / 2, 22, '#b9bbaa', 'center', true);
    } else if (!breached) {
      const creaturePose: CreaturePose = { foot: creaturePoint, facing: -1, time, stride: 0, moving: false, selected: false, hurt: 0, working: room.work?.phase === 'EXECUTING' };
      if(!this.creatureArt.render(id,creaturePose,`room-${id}`))drawCreature(g,id,creaturePose);
      if (recovering) {
        g.fillStyle(0x79979b, 0.25).fillRect(rect.x + 17, rect.y + 60, rect.width - 34, rect.height - 68);
        for (let x = rect.x + 30; x < rect.x + rect.width - 25; x += 35) g.lineStyle(3, 0x80a6ad, 0.5).lineBetween(x, rect.y + 61, x, rect.y + rect.height - 10);
      }
    } else {
      inkLine(g, creaturePoint.x - 35, creaturePoint.y - 90, creaturePoint.x + 35, creaturePoint.y - 35, 5, PALETTE.rust, 2);
      inkLine(g, creaturePoint.x - 35, creaturePoint.y - 35, creaturePoint.x + 35, creaturePoint.y - 90, 4, PALETTE.rust, 3);
      this.label('收容失效', creaturePoint.x, creaturePoint.y - 115, 20, '#ffcbc0', 'center', true);
    }
    const status = locked ? '封闭' : breached ? '停产 · 等待镇压' : recovering ? `恢复 ${Math.ceil(room.recoveryRemainingSec)}s` : room.work ? room.work.phase === 'TRAVELLING' ? '员工前往中' : `${config.localization[`work.${room.work.type}`]} ${Math.floor(room.work.elapsedSec)}s` : '收容稳定';
    this.label(status, rect.x + rect.width / 2, rect.y + 76, 16, breached ? '#ffbc9e' : '#e1e5d8', 'center', true);
    if (!locked) {
      const barX = rect.x + 36, barWidth = rect.width - 104, barY = rect.y + rect.height + 13;
      g.fillStyle(INK).fillRect(barX, barY, barWidth, 7);
      g.fillStyle(alarm).fillRect(barX, barY, barWidth * room.pressure / config.game.pressure.breachThreshold, 7);
      this.label(`${Math.ceil(room.pressure)}`, rect.x + rect.width - 41, barY + 3, 13, '#d7d4bc');
      const rule = anomalyById[id].specialWorkRule;
      if (rule.kind === 'NEGLECT' && room.mode === 'CONTAINED') this.label(`无人接待 ${Math.floor(room.memory.idleElapsedSec)} / ${rule.idleGraceSec}s`, creaturePoint.x, rect.y + 111, 14, room.memory.idleElapsedSec > rule.idleGraceSec ? '#ffad8b' : '#a3bfc3', 'center', true);
    }
    if (room.work?.phase === 'EXECUTING') {
      this.generatedEffects.work({x:foot.x+26,y:foot.y-45},time);
      const profile = anomalyById[id].workProfiles.find(item => item.type === room.work!.type)!;
      g.fillStyle(INK).fillRect(foot.x - 48, foot.y - 114, 130, 7);
      g.fillStyle(0xe8ce75).fillRect(foot.x - 47, foot.y - 113, 128 * room.work.elapsedSec / profile.durationSec, 5);
      if (room.work.type === 'SOOTHE') {
        const radius = 15 + time * 14 % 28; g.lineStyle(2, 0xb9e1b8, 0.8 - radius / 70).strokeEllipse(foot.x + 36, foot.y - 54, radius, radius * 0.7);
      } else if (room.work.type === 'INTERACT') {
        const pulse = (Math.sin(time * 5) + 1) / 2; g.fillStyle(ROOM_COLORS[id], 0.25 + pulse * 0.4).fillCircle(foot.x + 26, foot.y - 38, 3 + pulse * 4);
      }
    }
    if (this.controller.selectedRoomId === id) g.lineStyle(3, ROOM_COLORS[id], 0.8).strokeRect(rect.x - 4, rect.y - 4, rect.width + 8, rect.height + 8);
  }
  private drawEmployee(employee: EmployeeRuntime, actor: DisplayActor): void {
    const state = this.controller.state; const time = state.simulationTimeSec;
    const room = state.rooms.find(item => item.work?.employeeId === employee.id && item.work.phase === 'EXECUTING');
    const pose: HumanPose = { foot: actor.foot, facing: actor.facing, stride: actor.stride, moving: actor.moving, climbing: actor.climbing, time, selected: this.controller.selected.has(employee.id), hurt: Math.max(0, actor.hurtUntil - time), impactRemaining: Math.max(0, actor.impactUntil - time), workType: room?.work?.type };
    if(!this.humanArt.render(employee,pose))drawHuman(this.world,employee,pose);
    else {
      this.world.fillStyle(INK,0.25).fillEllipse(actor.foot.x,actor.foot.y+2,33,7);
      if(pose.selected){this.world.fillStyle(0xffcf43,0.16).fillEllipse(actor.foot.x,actor.foot.y+1,44,11);this.world.lineStyle(3,0xffcf43).strokeEllipse(actor.foot.x,actor.foot.y+1,44,11);}
    }
    const x = actor.foot.x; const y = actor.foot.y;
    const selected = this.controller.selected.has(employee.id);
    if (selected || employee.hp < employee.hpMax || employee.sp < employee.spMax) {
      this.world.fillStyle(INK).fillRect(x - 18, y - 81, 36, 8);
      this.world.fillStyle(0x9fc78e).fillRect(x - 17, y - 80, 34 * employee.hp / employee.hpMax, 3);
      this.world.fillStyle(0x7dbdd2).fillRect(x - 17, y - 76, 34 * employee.sp / employee.spMax, 3);
    }
    // Names only on selection avoid six overlapping floating labels at the safe endpoint.
    if (selected) this.label(employee.displayName, x, y - 92, 11, '#ffde81', 'center', true);
    if (employee.status === 'PANICKED') {
      drawPanicMarks(this.effects, actor.foot, time);
      this.generatedEffects.panic(actor.foot,time);
      this.label('!', x + 22, y - 64, 22, '#c8a4da', 'center', true);
    }
    if (employee.location.zone === 'SAFE' && (employee.hp < employee.hpMax || employee.sp < employee.spMax)) this.label('+', x - 19, y - 34 - (time % 1.4 / 1.4) * 25, 18, '#b8e3ac', 'center', true);
  }
  private drawEnemy(enemy: EnemyRuntime, actor: DisplayActor): void {
    const time = this.controller.state.simulationTimeSec; const x = actor.foot.x; const y = actor.foot.y;
    const pose: CreaturePose = { foot: actor.foot, facing: actor.facing, time, stride: actor.stride, moving: actor.moving, selected: this.controller.selectedEnemyId === enemy.id, hurt: Math.max(0, actor.hurtUntil - time), working: false, enemy, impactRemaining: Math.max(0, actor.impactUntil - time) };
    if(!this.creatureArt.render(enemy.sourceAnomalyId,pose,enemy.id))drawCreature(this.world,enemy.sourceAnomalyId,pose);
    const top = y - (enemy.isClone ? 91 : 115);
    this.world.fillStyle(INK).fillRect(x - 32, top, 64, 6);
    this.world.fillStyle(enemy.isClone ? 0xd7ac70 : 0xef7761).fillRect(x - 31, top + 1, 62 * enemy.suppressionHp / enemy.suppressionHpMax, 4);
    this.label(enemy.isClone ? '分身' : `${enemy.sourceAnomalyId} ${anomalyById[enemy.sourceAnomalyId].name}`, x, top - 11, 11, enemy.isClone ? '#ddc6a0' : '#ffd3a2', 'center', !enemy.isClone);
    if (enemy.stunnedUntilSec > time) this.label('受控', x, top - 27, 11, '#a6eff0');
  }
  private drawTelegraphs(): void {
    const state = this.controller.state; const g = this.world;
    for (const enemy of state.enemies) {
      if (enemy.attackPhase !== 'WINDUP' || enemy.windupEndsAtSec === null) continue;
      const profile = anomalyById[enemy.sourceAnomalyId].breach; const p = enemy.location;
      const color = damageColors[profile.damage.type];
      const progress = Math.max(0, Math.min(1, 1 - (enemy.windupEndsAtSec - state.simulationTimeSec) / profile.windupSec));
      if (profile.targetScope === 'FACILITY_EXCEPT_SAFE') {
        for (const rect of [...Object.values(ROOM_RECTS), ...facilityMap.halls.map(hall => hall.rect)]) {
          g.fillStyle(color, 0.07 + progress * 0.08).fillRect(rect.x, rect.y, rect.width, rect.height);
          g.lineStyle(3, color, 0.6).strokeRect(rect.x, rect.y, rect.width, rect.height);
        }
        this.label('广播蓄力 · 安全室外全设施', p.x, p.y - 140, 16, '#e7c0f3', 'center', true);
      } else {
        const rx = profile.attackRangePx; const ry = profile.attackRangePx;
        g.fillStyle(color, 0.07 + progress * 0.09).fillEllipse(p.x, p.y, rx * 2, ry * 2);
        g.lineStyle(3, color, 0.85).strokeEllipse(p.x, p.y, rx * 2, ry * 2);
        g.lineStyle(5, color, 0.75).lineBetween(p.x - rx, p.y + 3, p.x + rx, p.y + 3);
        if (enemy.sourceAnomalyId === 'N03' || enemy.sourceAnomalyId === 'N05') this.label(enemy.sourceAnomalyId === 'N03' ? '吠叫蓄力' : '共振蓄力', p.x, p.y - 130, 13, '#ffd1b2', 'center', true);
      }
      g.fillStyle(INK).fillRect(p.x - 32, p.y + 14, 64, 6); g.fillStyle(color).fillRect(p.x - 31, p.y + 15, 62 * progress, 4);
    }
  }
  private drawEffects(): void {
    const state = this.controller.state; const time = state.simulationTimeSec; const g = this.effects;
    for (const [id, actor] of this.actors) {
      if (actor.hurtUntil <= time) continue;
      drawInkImpact(g, { x: actor.foot.x, y: actor.foot.y - 39 }, actor.hurtUntil - time,
        id.startsWith('E') ? PALETTE.paper : PALETTE.alarm, id.length);
      this.generatedEffects.hit({x:actor.foot.x,y:actor.foot.y-39},actor.hurtUntil-time);
    }
    for (const employee of state.employees) {
      const actor = this.actors.get(employee.id)!;
      if (actor.impactUntil <= time || employee.order.kind !== 'SUPPRESS') continue;
      const target = this.actors.get(employee.order.enemyId); if (!target) continue;
      const color = damageColors[weaponById[employee.weaponId].damage.type]; const alpha = Math.min(1, (actor.impactUntil - time) / 0.22);
      this.generatedEffects.damage({x:target.foot.x,y:target.foot.y-42},weaponById[employee.weaponId].damage.type,actor.impactUntil-time);
      if (weaponById[employee.weaponId].rangePx > weaponById.W00.rangePx) {
        inkLine(g, actor.foot.x + actor.facing * 20, actor.foot.y - 37, target.foot.x, target.foot.y - 42, 6, INK, 2, alpha);
        inkLine(g, actor.foot.x + actor.facing * 20, actor.foot.y - 37, target.foot.x, target.foot.y - 42, 3, color, 2, alpha);
        g.lineStyle(3, color, alpha).strokeCircle(target.foot.x, target.foot.y - 42, 14);
      } else g.lineStyle(4, color, alpha).beginPath().arc(actor.foot.x + actor.facing * 32, actor.foot.y - 37, 28, actor.facing > 0 ? -1.2 : 1.8, actor.facing > 0 ? 1 : 4.3).strokePath();
    }
    for (const enemy of state.enemies) {
      const actor = this.actors.get(enemy.id)!; if (actor.impactUntil <= time) continue;
      const profile = anomalyById[enemy.sourceAnomalyId].breach; const alpha = Math.min(1, (actor.impactUntil - time) / 0.22);
      const radius = Math.max(35, profile.attackRangePx);
      g.lineStyle(4, damageColors[profile.damage.type], alpha).strokeEllipse(actor.foot.x, actor.foot.y - 36, radius * 1.4, radius * 0.7);
    }
    for (const item of this.floating) this.label(item.text, item.point.x, item.point.y - Math.max(0, 1.1 - (item.until - time)) * 20, 14, item.color, 'center', true);
    if (this.destination && time - this.destination.at < 1.4) {
      const p = this.destination.point; g.lineStyle(3, 0xffda6a).strokeEllipse(p.x, p.y + 2, 30, 9);
      g.lineStyle(3, 0xffda6a).lineBetween(p.x - 7, p.y - 18, p.x, p.y - 9).lineBetween(p.x, p.y - 9, p.x + 7, p.y - 18);
    }
    if (this.skillFlash && this.skillFlash.until > time) {
      const flash = this.skillFlash; const alpha = Math.min(0.8, (flash.until - time) / 0.55);
      g.fillStyle(flash.color, alpha * 0.12).fillEllipse(flash.point.x, flash.point.y, flash.radius * 2.1, flash.radius * 2);
      g.lineStyle(4, flash.color, alpha).strokeEllipse(flash.point.x, flash.point.y, flash.radius * 2.1, flash.radius * 2);
    }
  }
  private drawSelectedRoute(): void {
    const id = [...this.controller.selected][0];
    const employee = this.controller.state.employees.find(item => item.id === id);
    if (!employee?.path.length || employee.status !== 'MOVING') return;
    const points = [employee.location, ...employee.path];
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], dx = b.x - a.x, dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      for (let offset = 8; offset < length; offset += 25) {
        const end = Math.min(length, offset + 11);
        inkLine(this.world, a.x + dx * offset / length, a.y + dy * offset / length - 4,
          a.x + dx * end / length, a.y + dy * end / length - 4, 2, PALETTE.cyan, i, 0.75);
      }
    }
  }
  private drawSkillPreview(): void {
    const id = this.controller.activeSkillId; if (!id || !inRect(this.hovered, FACILITY_GEOMETRY.view)) return;
    const skill = skillById[id]; const g = this.effects;
    if (skill.target === 'SINGLE_ENEMY') {
      const enemy = this.enemyAt(this.hovered); if (!enemy) return;
      const actor = this.actors.get(enemy.id)!; const p = { x: actor.foot.x, y: actor.foot.y - 43 }; g.lineStyle(3, 0xffda6a).strokeCircle(p.x, p.y, 51);
      this.label(skill.name, p.x, p.y - 62, 13, '#ffe196', 'center', true);
    } else if ('radiusPx' in skill) {
      const target = this.corridorTarget(this.hovered);
      const valid = skill.target !== 'CORRIDOR_POINT' || target !== null;
      const p = skill.target === 'CORRIDOR_POINT' && target ? target : this.unproject(this.hovered);
      const color = valid ? id === 'S05' ? 0x8ee0c4 : 0xffce60 : 0xde695a;
      g.fillStyle(color, 0.12).fillCircle(p.x, p.y, skill.radiusPx);
      g.lineStyle(3, color).strokeCircle(p.x, p.y, skill.radiusPx);
      this.label(valid ? `${skill.name} · 点击施放` : '请点击走廊', p.x, p.y - 20, 13, '#fff0c5', 'center', true);
    }
  }
  private drawWorkMenu(): void {
    const id = this.workMenuRoom; if (!id) return;
    const menu = this.menuRect(); const g = this.overlay; const room = this.controller.state.rooms.find(item => item.anomalyId === id)!;
    g.fillStyle(INK, 0.35).fillRect(menu.x + 6, menu.y + 7, menu.width, menu.height);
    g.fillStyle(0x1e2630).fillRect(menu.x, menu.y, menu.width, menu.height); g.lineStyle(1, 0x57b8ff).strokeRect(menu.x, menu.y, menu.width, menu.height);
    g.fillStyle(INK).fillRect(menu.x, menu.y, menu.width, 40); g.fillStyle(ROOM_COLORS[id]).fillRect(menu.x, menu.y + 40, menu.width, 4);
    this.screenLabel(`${anomalyById[id].name} · 派遣工作`, menu.x + 15, menu.y + 22, 14, '#d9e1ea', 'left', true);
    for (let i = 0; i < config.game.work.types.length; i++) {
      const type = config.game.work.types[i]; const profile = anomalyById[id].workProfiles.find(item => item.type === type)!;
      const y = menu.y + 44 + i * FACILITY_GEOMETRY.menuRowHeight; const possible = room.mode === 'CONTAINED' && !room.work && this.controller.selected.size === 1;
      const hover = inRect(this.hovered, { x: menu.x, y, width: menu.width, height: FACILITY_GEOMETRY.menuRowHeight });
      g.fillStyle(possible ? hover ? 0x394f66 : 0x283440 : 0x202831).fillRect(menu.x + 4, y + 3, menu.width - 8, FACILITY_GEOMETRY.menuRowHeight - 5);
      this.screenLabel(config.localization[`work.${type}`], menu.x + 16, y + 21, 15, possible ? '#d9e1ea' : '#7b8795', 'left', true);
      this.screenLabel(`${profile.durationSec}s  +${profile.energy}能量`, menu.x + menu.width - 14, y + 21, 12, possible ? '#a9bbcd' : '#7b8795', 'right');
    }
  }
  private drawMapInterface(): void {
    const g = this.overlay, state = this.controller.state;
    const controls = this.getCameraControls();
    for (const [id, p] of Object.entries(controls.rooms)) {
      const room = state.rooms.find(item => item.anomalyId === id)!;
      const color = room.mode === 'BREACHED' ? 0xe46b59 : ROOM_COLORS[id as AnomalyId];
      g.fillStyle(0x1e2630, 0.98).fillRect(p.x - 53, p.y - 15, 106, 30); g.lineStyle(1, 0x39424e).strokeRect(p.x - 53, p.y - 15, 106, 30);
      inkLine(g, p.x - 49, p.y + 13, p.x + 49, p.y + 13, 2, color, 1, room.mode === 'LOCKED' ? 0.3 : 0.8);
      this.screenLabel(`${id} ${anomalyById[id as AnomalyId].name}`, p.x, p.y, 11, room.mode === 'LOCKED' ? '#757c7b' : '#d9e1ea');
      if (room.mode === 'BREACHED') this.screenLabel('!', p.x + 43, p.y - 2, 16, '#ff9d79', 'center', true);
    }
    for (const [key, text, width] of [['overview', '总览 Home', 76], ['focus', '跟随 F', 76], ['zoomOut', '−', 38], ['zoomIn', '+', 38]] as const) {
      const p = controls[key];
      g.fillStyle(0x1e2630, 0.98).fillRect(p.x - width / 2, p.y - 15, width, 30); g.lineStyle(1, 0x39424e).strokeRect(p.x - width / 2, p.y - 15, width, 30);
      inkLine(g, p.x - width / 2 + 4, p.y + 13, p.x + width / 2 - 4, p.y + 13, 1, PALETTE.paperShade, 2);
      this.screenLabel(text, p.x, p.y, 12, '#d9e1ea');
    }
    this.screenLabel(`FACILITY 07   /   ${Math.round(this.cameraZoom * 100)}%${this.following ? `   跟随 ${this.following}` : ''}`, 37, 133, 11, '#a6ada8', 'left');
    g.fillStyle(0x10171e, 0.9).fillRect(28, 765, 300, 28);
    this.screenLabel('滚轮缩放 · 中键 / Alt拖动 · 双击员工跟随', 38, 779, 11, '#bec4bd', 'left');
    g.fillStyle(0x1e2630, 0.99).fillRect(MINI_MAP.x, MINI_MAP.y, MINI_MAP.width, MINI_MAP.height); g.lineStyle(1, 0x39424e).strokeRect(MINI_MAP.x, MINI_MAP.y, MINI_MAP.width, MINI_MAP.height);
    inkLine(g, MINI_MAP.x + 7, MINI_MAP.y + 29, MINI_MAP.x + MINI_MAP.width - 7, MINI_MAP.y + 29, 1, PALETTE.paperShade, 7);
    this.screenLabel('设施导航 · 点击定位', MINI_MAP.x + 12, MINI_MAP.y + 15, 11, '#d9e1ea', 'left');
    for (const edge of facilityMap.edges) {
      const a = this.toMini(mapNode(edge.from)), b = this.toMini(mapNode(edge.to));
      g.lineStyle(edge.kind === 'TRANSIT' ? 2 : 3, 0x636d72, 0.85).lineBetween(a.x, a.y, b.x, b.y);
    }
    for (const hall of [...facilityMap.halls, { rect: facilityMap.safeRect }]) {
      const rect = hall.rect, p = this.toMini(rect);
      g.fillStyle(0x374653).fillRect(p.x, p.y, rect.width / facilityMap.bounds.width * MINI_INNER.width, rect.height / facilityMap.bounds.height * MINI_INNER.height);
    }
    for (const room of state.rooms) {
      const rect = ROOM_RECTS[room.anomalyId], p = this.toMini(rect);
      g.fillStyle(room.mode === 'LOCKED' ? 0x3c4144 : room.mode === 'BREACHED' ? 0xf1644e : ROOM_COLORS[room.anomalyId], 0.8).fillRect(p.x, p.y, rect.width / facilityMap.bounds.width * MINI_INNER.width, rect.height / facilityMap.bounds.height * MINI_INNER.height);
    }
    for (const employee of state.employees) {
      const p = this.toMini(employee.location);
      g.fillStyle(this.controller.selected.has(employee.id) ? 0xffe3a3 : 0xd6e8dd).fillCircle(p.x, p.y, 2);
    }
    for (const enemy of state.enemies) { const p = this.toMini(enemy.location); g.fillStyle(0xff594b).fillCircle(p.x, p.y, 2.5); }
    const view = this.getCameraState().worldView;
    const p = this.toMini({ x: Math.max(0, view.x), y: Math.max(0, view.y) });
    const q = this.toMini({ x: Math.min(facilityMap.bounds.width, view.x + view.width), y: Math.min(facilityMap.bounds.height, view.y + view.height) });
    g.lineStyle(1, 0xffdf96).strokeRect(p.x, p.y, q.x - p.x, q.y - p.y);
  }
}
