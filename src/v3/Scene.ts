import Phaser from 'phaser';
import type { AnomalyId, EmployeeId, Point, Rect } from '../../contracts/data-contract';
import type { V3Simulation } from './engine';
import type { V3Employee, V3Enemy } from './model';
import { cardById, v3Config } from './config';
import { anomalyById, weaponById } from '../data/config';
import facilityMap from '../../config/facility.json';
import { drawArchitecture } from '../scenes/facility/architecture';
import { ROOM_RECTS, creatureFeet, inRect } from '../scenes/facility/geometry';
import { drawHuman, drawCreature } from '../scenes/facility/actors';
import { EnvironmentArt } from '../art/generated/EnvironmentArt';
import { HumanRig, PERSONNEL_TEXTURES } from '../art/generated/HumanRig';
import { CreatureRig, CREATURE_TEXTURES } from '../art/generated/CreatureRig';
import { EffectsArt, preloadEffectsArt } from '../art/generated/EffectsArt';
import { FieldArt } from '../art/generated/FieldArt';
import { CardEffects, type CardPresentation } from './CardEffects';

interface Callbacks {
  selectRoom(id: AnomalyId): void;
  selectEmployee(id: EmployeeId): void;
  target(id: string): void;
  notify(message: string): void;
  cardTargetKind?(): 'ALLY'|'ENEMY'|null;
  cardPresentation?(): CardPresentation|null;
}
interface Actor { x: number; y: number; stride: number; moving: boolean; facing: -1 | 1; climbing: boolean }
const ink = 0x18252c;
const VIEW: Rect = { x: 16, y: 70, width: 1328, height: 650 };
const colors = { RED: 0xf27d6b, WHITE: 0xe4d9a6, BLACK: 0xc196e5, PALE: 0x7ed8ed };

/** This is the sole update loop. All actor positions, attacks and visual clocks come from V3Simulation. */
export class V3Scene extends Phaser.Scene {
  private facilityRoot!: Phaser.GameObjects.Container;
  private arenaRoot!: Phaser.GameObjects.Container;
  private world!: Phaser.GameObjects.Graphics;
  private effects!: Phaser.GameObjects.Graphics;
  private humanArt!: HumanRig;
  private creatureArt!: CreatureRig;
  private effectArt!: EffectsArt;
  private environment!: EnvironmentArt;
  private fieldArt!: FieldArt;
  private cardEffects!: CardEffects;
  private labels: Phaser.GameObjects.Text[] = [];
  private cursor = 0;
  private actors = new Map<string, Actor>();
  private lastTime = -1;
  private lastPhase = '';
  private center: Point = { ...facilityMap.camera.center };
  private zoom = facilityMap.camera.zoom;
  private savedCamera: { center: Point; zoom: number } | null = null;
  private selected = new Set<EmployeeId>();
  private selectedRoom: AnomalyId | null = 'N01';
  private enemyLabels = new Map<string, Point>();
  private pan: { screen: Point; center: Point } | null = null;
  private drag: { start: Point; current: Point } | null = null;
  private destination: { point: Point; until: number } | null = null;
  private loadErrors: string[] = [];

  constructor(readonly simulation: V3Simulation, private callbacks: Callbacks) { super('v3-facility'); }
  preload(): void {
    this.load.on('loaderror', (file: Phaser.Loader.File) => this.loadErrors.push(file.key));
    for (const a of [...PERSONNEL_TEXTURES, ...CREATURE_TEXTURES]) {
      if (!this.textures.exists(a.key)) this.load.image(a.key, `${import.meta.env.BASE_URL}${a.url.replace(/^\//, '')}`);
    }
    EnvironmentArt.preload(this); preloadEffectsArt(this); FieldArt.preload(this);
  }
  create(): void {
    this.cameras.main.setViewport(VIEW.x, VIEW.y, VIEW.width, VIEW.height).setBackgroundColor('#18252c');
    this.facilityRoot = this.add.container();
    const architecture = this.add.graphics(); this.facilityRoot.add(architecture);
    this.environment = new EnvironmentArt(this, this.facilityRoot);
    drawArchitecture(architecture, (s, x, y, size = 14, color = '#e6eee9') => {
      this.facilityRoot.add(this.add.text(x, y, s, { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: size, color }));
    }, this.environment);
    this.arenaRoot = this.add.container(); this.createArena();
    this.fieldArt = new FieldArt(this);
    this.world = this.add.graphics();
    this.creatureArt = new CreatureRig(this);
    this.humanArt = new HumanRig(this);
    // Readouts and precise telegraphs stay above decorative pollution sprites.
    this.effects = this.add.graphics().setDepth(10); this.effectArt = new EffectsArt(this);
    this.cardEffects = new CardEffects(this);
    this.input.mouse?.disableContextMenu();
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => this.down(p));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.pan) {
        this.center = { x: this.pan.center.x - (p.x - this.pan.screen.x) / this.zoom, y: this.pan.center.y - (p.y - this.pan.screen.y) / this.zoom };
        this.applyCamera();
      }
      if (this.drag) this.drag.current = { x: p.x, y: p.y };
    });
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.up(p));
    this.input.on('wheel', (p: Phaser.Input.Pointer, _objects: unknown[], _dx: number, dy: number) => {
      if (!inRect(p, VIEW) || this.simulation.state.phase === 'ENCOUNTER') return;
      const before = this.unproject(p);
      this.zoom = Phaser.Math.Clamp(this.zoom * (dy > 0 ? 0.88 : 1.14), 0.23, 1.7);
      const after = this.unproject(p); this.center.x += before.x - after.x; this.center.y += before.y - after.y; this.applyCamera();
    });
    this.scale.on('resize', () => this.configureCamera(true));
    this.input.keyboard?.on('keydown', (event: KeyboardEvent) => {
      if (event.repeat || /INPUT|TEXTAREA|SELECT/.test((event.target as HTMLElement)?.tagName ?? '')) return;
      if (event.code === 'Home') { event.preventDefault(); this.overview(); }
      if (event.code === 'KeyF') { const id = [...this.selected][0]; if (id) this.focusEmployee(id); }
    });
    this.configureCamera(); this.paint();
  }
  update(_time: number, delta: number): void {
    this.simulation.update(delta);
    this.configureCamera(); this.paint();
  }
  private createArena(): void {
    const g = this.add.graphics(); this.arenaRoot.add(g);
    g.fillStyle(0x283842).fillRect(-100, -100, 1600, 1000);
    const a = new EnvironmentArt(this, this.arenaRoot);
    a.draw('room_wall_panel_muted_a_upper_slate', 65, 155, 1170, 345);
    a.draw('room_wall_panel_muted_a_lower_slate', 70, 413, 1160, 87);
    a.draw('room_shell_edges_a_beam_top', 55, 145, 1190, 22);
    a.draw('room_shell_edges_a_wall_left', 55, 163, 22, 337);
    a.draw('room_shell_edges_a_wall_right', 1223, 163, 22, 337);
    a.draw('floor_bearing_strip_a_middle', 55, 488, 1190, 45);
    for (const x of [170, 470, 770, 1070]) {
      a.draw('industrial_lamp_layers_a_housing', x, 180, 110, 17);
      a.draw('industrial_lamp_layers_a_light_strip', x + 8, 190, 94, 5);
    }
    for (const x of [165, 510, 855]) {
      a.draw('observation_window_layers_a_glass', x, 245, 260, 120, { alpha: 0.7 });
      a.draw('observation_window_layers_a_frame', x, 245, 260, 120);
    }
    a.draw('containment_side_door_frame_a_frame', 88, 363, 36, 137);
    a.draw('containment_door_leaf_a_leaf', 97, 373, 18, 127);
    a.draw('containment_side_door_frame_a_frame', 1178, 363, 36, 137);
    a.draw('security_broadcast_horn_a_horn', 1145, 205, 42, 35);
    a.draw('operator_console_desk_a_console', 95, 440, 110, 60, { alpha: 0.5 });
    this.arenaRoot.add(this.add.text(108, 208, 'FACILITY / 07   设施内失效挑战', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: 18, color: '#4e6470' }));
    this.arenaRoot.add(this.add.text(380, 552, '自动追击 / 普通攻击    ·    E.G.O. 战术干预', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: 16, color: '#8aa9b7' }));
  }
  private configureCamera(resize = false): void {
    const phase = this.simulation.state.phase;
    if (phase === this.lastPhase && !resize) return;
    if (phase === 'ENCOUNTER') {
      if (this.lastPhase !== 'ENCOUNTER') this.savedCamera = { center: { ...this.center }, zoom: this.zoom };
      const squad = this.simulation.state.encounter?.squadIds ?? [];
      this.selected = new Set([...this.selected].filter(id => squad.includes(id)));
      if (!this.selected.size && squad[0]) this.selected.add(squad[0]);
      this.center = { x: 650, y: 380 }; this.zoom = Math.min(VIEW.width / 1300, VIEW.height / 560);
    } else if (this.savedCamera) {
      this.center = this.savedCamera.center; this.zoom = this.savedCamera.zoom; this.savedCamera = null;
    } else if (!this.lastPhase) this.zoom *= VIEW.width / 1360;
    this.facilityRoot.setVisible(phase === 'FACILITY'); this.arenaRoot.setVisible(phase === 'ENCOUNTER');
    this.actors.clear(); this.lastPhase = phase; this.applyCamera();
  }
  private applyCamera(): void { this.cameras.main.setZoom(this.zoom).centerOn(this.center.x, this.center.y); }
  private project(p: Point): Point { return { x: VIEW.x + VIEW.width / 2 + (p.x - this.center.x) * this.zoom, y: VIEW.y + VIEW.height / 2 + (p.y - this.center.y) * this.zoom }; }
  private unproject(p: Point): Point { return { x: this.center.x + (p.x - VIEW.x - VIEW.width / 2) / this.zoom, y: this.center.y + (p.y - VIEW.y - VIEW.height / 2) / this.zoom }; }
  overview(): void {
    if (this.simulation.state.phase === 'ENCOUNTER') return;
    this.center = { x: 1800, y: 1250 }; this.zoom = Math.min(VIEW.width / 3600, VIEW.height / 2500) * 0.97; this.applyCamera();
  }
  focusRoom(id: AnomalyId): void {
    if (this.simulation.state.phase === 'ENCOUNTER') return;
    const r = ROOM_RECTS[id]; this.selectedRoom = id;
    this.center = { x: r.x + r.width / 2, y: r.y + r.height / 2 + 30 };
    this.zoom = Math.min(VIEW.width / 1050, VIEW.height / 620, 1.35); this.applyCamera();
  }
  focusEmployee(id: EmployeeId): void {
    const employee = this.simulation.state.employees.find(e => e.id === id); if (!employee) return;
    this.selectEmployee(id);
    if (this.simulation.state.phase === 'FACILITY') {
      this.center = { x: employee.location.x, y: employee.location.y - 100 }; this.zoom = Math.min(1.1, VIEW.height / 600); this.applyCamera();
    }
  }
  selectEmployee(id: EmployeeId, additive = false): void {
    const state = this.simulation.state;
    if (!state.employees.some(e => e.id === id) || (state.phase === 'ENCOUNTER' && !state.encounter?.squadIds.includes(id))) return;
    if (!additive) this.selected.clear();
    this.selected.add(id);
  }
  getEmployeeScreenPoint(id: EmployeeId): Point | null {
    const state = this.simulation.state;
    if (state.phase === 'ENCOUNTER' && !state.encounter?.squadIds.includes(id)) return null;
    const e = state.employees.find(e => e.id === id); return e ? this.project({ x: e.location.x, y: e.location.y - 35 }) : null;
  }
  getEnemyScreenPoint(id: string): Point | null { const e = this.simulation.state.encounter?.enemies.find(e => e.id === id); return e ? this.project({ x: e.location.x, y: e.location.y - 45 }) : null; }
  getEnemyTargetPoint(id: string): Point | null { const anchor = this.enemyLabels.get(id); return anchor ? this.project(anchor) : null; }
  getRoomClickPoint(id: AnomalyId): Point { const r = ROOM_RECTS[id]; return this.project({ x: r.x + r.width / 2, y: r.y + r.height / 2 }); }
  getCorridorScreenPoint(point: Point): Point { return this.project(point); }
  getViewState(): unknown {
    return { phase: this.simulation.state.phase, time: this.simulation.state.simulationTimeSec,
      camera: { center: this.center, zoom: this.zoom, view: VIEW },
      employees: this.humanArt?.getState(), creatures: this.creatureArt?.getState(), effects: this.effectArt?.getState(),
      field: this.fieldArt?.getState(),
      cards: this.cardEffects?.getState(),
      enemyLabels: [...this.enemyLabels].map(([id, point]) => ({ id, ...point, screen: this.project(point) })),
      loadErrors: this.loadErrors, selected: [...this.selected] };
  }
  private down(p: Phaser.Input.Pointer): void {
    if (!inRect(p, VIEW)) return;
    if (p.middleButtonDown() || (p.leftButtonDown() && p.event.altKey)) { this.pan = { screen: { x: p.x, y: p.y }, center: { ...this.center } }; return; }
    const q = this.unproject(p);
    if (p.rightButtonDown()) {
      if (!this.selected.size) { this.callbacks.notify('请先点击员工，再右键下达移动命令。'); return; }
      const target = this.simulation.state.phase === 'ENCOUNTER' ? { x: Phaser.Math.Clamp(q.x, v3Config.arena.minX, v3Config.arena.maxX), y: v3Config.arena.y } : this.corridorPoint(q);
      if (!target) { this.callbacks.notify('请选择连续走廊地面。'); return; }
      let moved = false;
      for (const id of this.selected) {
        const result = this.simulation.moveEmployee(id, target);
        if (result.ok) moved = true;
        else this.callbacks.notify(result.message);
      }
      if (moved) this.destination = { point: target, until: this.simulation.state.simulationTimeSec + 1.1 }; return;
    }
    // Resolve the intended card target before overlapping actor bounds; a healing
    // click on a teammate must not be intercepted by an enemy standing in front.
    const cardTarget=this.callbacks.cardTargetKind?.();
    if(cardTarget==='ALLY'){
      const ally=this.simulation.state.employees.filter(e=>e.hp>0&&this.simulation.state.encounter?.squadIds.includes(e.id)&&Math.abs(q.x-e.location.x)<24&&q.y>e.location.y-80&&q.y<e.location.y+12)
        .sort((a,b)=>Math.abs(q.x-a.location.x)-Math.abs(q.x-b.location.x))[0];
      if(ally){this.selected.clear();this.selected.add(ally.id);this.callbacks.selectEmployee(ally.id);}
      else this.callbacks.notify('请选择场内员工或右侧人员名单；当前卡牌作用于友方。');
      return;
    }
    const targetLabel = [...this.enemyLabels].find(([, a]) => inRect(q, { x: a.x - 76, y: a.y - 40, width: 152, height: 64 }));
    if (targetLabel) { this.callbacks.target(targetLabel[0]); return; }
    const enemy = this.simulation.state.encounter?.enemies.find(e => e.suppressionHp > 0 && Math.abs(q.x - e.location.x) < 48 && q.y > e.location.y - 110 && q.y < e.location.y + 15);
    if (enemy) { this.callbacks.target(enemy.id); return; }
    if(cardTarget==='ENEMY'){this.callbacks.notify('请选择场内敌人或上方敌人标签；Esc取消选牌。');return;}
    const employee = [...this.simulation.state.employees].reverse().find(e => (this.simulation.state.phase === 'FACILITY' || this.simulation.state.encounter?.squadIds.includes(e.id)) && Math.abs(q.x - e.location.x) < 24 && q.y > e.location.y - 80 && q.y < e.location.y + 12);
    if (employee) { if (!p.event.shiftKey) this.selected.clear(); this.selected.add(employee.id); this.callbacks.selectEmployee(employee.id); return; }
    if (this.simulation.state.phase === 'FACILITY') {
      const room = this.simulation.state.rooms.find(r => inRect(q, ROOM_RECTS[r.anomalyId]));
      if (room) { this.selectedRoom = room.anomalyId; this.callbacks.selectRoom(room.anomalyId); return; }
    }
    this.drag = { start: { x: p.x, y: p.y }, current: { x: p.x, y: p.y } };
  }
  private up(p: Phaser.Input.Pointer): void {
    this.pan = null;
    if (this.drag && Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y) > 8) {
      const a = this.unproject(this.drag.start), b = this.unproject(p);
      const r = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
      this.selected.clear();
      for (const e of this.simulation.state.employees) if ((this.simulation.state.phase === 'FACILITY' || this.simulation.state.encounter?.squadIds.includes(e.id)) && inRect({ x: e.location.x, y: e.location.y - 35 }, r)) this.selected.add(e.id);
      const id = [...this.selected][0]; if (id) this.callbacks.selectEmployee(id);
    }
    this.drag = null;
  }
  private corridorPoint(p: Point): Point | null {
    let found: Point | null = null, score = 100;
    for (const edge of facilityMap.edges) {
      if (edge.kind !== 'CORRIDOR' && edge.kind !== 'SAFE') continue;
      const a = facilityMap.nodes.find(n => n.id === edge.from)!, b = facilityMap.nodes.find(n => n.id === edge.to)!;
      const point = { x: Phaser.Math.Clamp(p.x, Math.min(a.x, b.x), Math.max(a.x, b.x)), y: a.y };
      const distance = Math.hypot(point.x - p.x, point.y - p.y);
      if (distance < score) { score = distance; found = point; }
    }
    return found;
  }
  private actor(entity: V3Employee | V3Enemy): Actor {
    const p = entity.location; let a = this.actors.get(entity.id);
    if (!a) { a = { x: p.x, y: p.y, stride: 0, moving: false, facing: 'hp' in entity ? 1 : -1, climbing: false }; this.actors.set(entity.id, a); }
    if (this.simulation.state.simulationTimeSec !== this.lastTime) {
      const dx = p.x - a.x, dy = p.y - a.y; a.moving = Math.hypot(dx, dy) > 0.0001;
      if (a.moving) a.stride += Math.hypot(dx, dy) / 8.5;
      if (Math.abs(dx) > 0.0001) a.facing = dx > 0 ? 1 : -1;
      a.climbing = p.zone === 'TRANSIT'; a.x = p.x; a.y = p.y;
      const targetId = 'hp' in entity ? entity.attackTargetId : entity.targetEmployeeId;
      const target = [...this.simulation.state.employees, ...(this.simulation.state.encounter?.enemies ?? [])].find(e => e.id === targetId);
      if (target && !a.moving) a.facing = target.location.x >= p.x ? 1 : -1;
    }
    return a;
  }
  private label(text: string, x: number, y: number, size = 14, color = '#d3e7eb'): void {
    let label = this.labels[this.cursor++];
    if (!label) { label = this.add.text(0, 0, '', { fontFamily: 'Microsoft YaHei,sans-serif', stroke: '#18252c', strokeThickness: 3 }).setOrigin(0.5).setDepth(20); this.labels.push(label); }
    label.setVisible(true).setPosition(x, y).setText(text).setFontSize(size).setColor(color);
  }
  private bar(x: number, y: number, width: number, fraction: number, color: number): void {
    this.effects.fillStyle(ink, 0.9).fillRect(x - width / 2 - 1, y - 1, width + 2, 6);
    this.effects.fillStyle(color).fillRect(x - width / 2, y, width * Phaser.Math.Clamp(fraction, 0, 1), 4);
  }
  private paint(): void {
    const state = this.simulation.state, time = state.simulationTimeSec, combat = state.phase === 'ENCOUNTER';
    const field = combat && state.encounter?.mode === 'CAPTURE';
    this.arenaRoot.setVisible(combat && !field);
    this.fieldArt.render(combat ? state.encounter : null, time);
    this.world.clear(); this.effects.clear(); this.cursor = 0;
    this.humanArt.beginFrame(); this.creatureArt.beginFrame(); this.effectArt.beginFrame();
    this.layoutEnemyLabels();
    if (!combat) for (const room of state.rooms) {
      const r = ROOM_RECTS[room.anomalyId], foot = creatureFeet(room.anomalyId);
      this.environment.setDoorOpen(room.anomalyId, room.owned);
      if (!room.owned) {
        this.world.fillStyle(0x15232c, 0.74).fillRect(r.x + 13, r.y + 42, r.width - 26, r.height - 54);
        this.label('区域封闭 / 等待外勤收容', r.x + r.width / 2, r.y + r.height / 2, 22, '#8b9da7');
      } else {
        const pose = { foot, facing: -1 as const, time, stride: 0, moving: false, selected: this.selectedRoom === room.anomalyId, hurt: 0, working: false };
        if (!this.creatureArt.render(room.anomalyId, pose, `stable-${room.anomalyId}`)) drawCreature(this.world, room.anomalyId, pose);
        this.label(`稳定收容  ·  ${['I', 'II', 'III'][room.rank - 1]} 阶  ·  +${v3Config.production[room.anomalyId][room.rank - 1]} / 分钟`, r.x + r.width / 2, r.y + 125, 17, '#a9ddd0');
      }
      if (this.selectedRoom === room.anomalyId) this.world.lineStyle(3, 0x88c9cb, 0.8).strokeRect(r.x - 4, r.y - 4, r.width + 8, r.height + 8);
    }
    if (combat && state.encounter) {
      if (!field) this.effectArt.breach({ x: 80, y: 180, width: 1140, height: 290 }, time, state.encounter.targetAnomalyId);
      for (const e of state.encounter.enemies) this.drawEnemy(e);
    }
    for (const e of state.employees) if (!combat || state.encounter?.squadIds.includes(e.id)) this.drawEmployee(e);
    const pointer = this.input.activePointer;
    this.cardEffects.render(state, this.callbacks.cardPresentation?.() ?? null, inRect(pointer, VIEW) ? this.unproject(pointer) : null);
    if (combat && state.encounter?.deck.pendingCast) {
      const pending = state.encounter.deck.pendingCast, card = state.encounter.deck.hand.find(c => c.instanceId === pending.instanceId);
      const owner = state.employees.find(e => e.id === card?.ownerId);
      if (owner && card) this.label(`${state.timeScale === 0 ? '已预备' : '施放中'} · ${cardById[card.cardId].name}`, owner.location.x, owner.location.y - 115, 14, '#ffe5a4');
    }
    for (const event of state.logs) {
      const remaining = 1.1 - (time - event.timeSec); if (remaining <= 0 || !event.targetId) continue;
      const entity = [...state.employees, ...(state.encounter?.enemies ?? [])].find(e => e.id === event.targetId);
      if (entity && event.amount) this.label(`${event.kind.includes('HEAL') ? '+' : '−'}${Math.round(event.amount)}`, entity.location.x, entity.location.y - 100 - (1.1 - remaining) * 24, 15, event.kind.includes('HEAL') ? '#a9eccb' : '#ffd6aa');
      if (combat && entity && event.kind === 'HIT' && time - event.timeSec < 0.22) {
        const source = [...state.employees, ...(state.encounter?.enemies ?? [])].find(e => e.id === event.sourceId);
        if (source) {
          const color = 'hp' in source ? colors[weaponById[source.weaponId].damage.type] : colors[anomalyById[source.sourceAnomalyId].breach.damage.type];
          this.effects.lineStyle(3, color, 0.75).lineBetween(source.location.x, source.location.y - 39, entity.location.x, entity.location.y - 39);
        }
      }
    }
    if (this.destination && this.destination.until > time) {
      this.effects.lineStyle(2, 0x9ae3ce).strokeEllipse(this.destination.point.x, this.destination.point.y, 32, 12);
    }
    if (this.drag) {
      const a = this.unproject(this.drag.start), b = this.unproject(this.drag.current);
      this.effects.lineStyle(1 / this.zoom, 0x88dfd9).strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    }
    this.humanArt.endFrame(); this.creatureArt.endFrame(); this.effectArt.endFrame();
    for (let i = this.cursor; i < this.labels.length; i++) this.labels[i].setVisible(false);
    this.lastTime = time;
  }
  private drawEmployee(e: V3Employee): void {
    const time = this.simulation.state.simulationTimeSec, a = this.actor(e), selected = this.selected.has(e.id);
    const pose = { foot: e.location, facing: a.facing, stride: a.stride, moving: a.moving, climbing: a.climbing, time, selected, hurt: Math.max(0, e.hitUntilSec - time), impactRemaining: Math.max(0, e.actionUntilSec - time) };
    if (!this.humanArt.render(e, pose)) drawHuman(this.world, e, pose);
    this.world.fillStyle(ink, 0.25).fillEllipse(a.x, a.y + 2, 30, 7);
    if (selected) this.world.lineStyle(2, 0xa7e4d5).strokeEllipse(a.x, a.y + 1, 42, 12);
    if (selected || this.simulation.state.phase === 'ENCOUNTER') {
      this.bar(a.x, a.y - 86, 44, e.hp / e.hpMax, 0x96d5b1); this.bar(a.x, a.y - 80, 44, e.sp / e.spMax, 0x83c5e5);
      this.label(e.displayName, a.x, a.y - 99, 11, '#d8eeef');
    }
    if (e.blockUntilSec > time) this.effects.lineStyle(2, 0x89dbde, 0.8).strokeEllipse(a.x, a.y - 37, 49, 79);
    if (e.counterUntilSec > time) this.label('反击准备', a.x, a.y + 18, 11, '#f6cf8e');
    if (e.status === 'PANICKED') this.effectArt.panic(e.location, time);
    this.effectArt.hit({ x: a.x, y: a.y - 38 }, e.hitUntilSec - time);
  }
  /** Separate target readouts only. Leaders always terminate at the real entity; collision and movement are untouched. */
  private layoutEnemyLabels(): void {
    this.enemyLabels.clear();
    const live = [...(this.simulation.state.encounter?.enemies ?? [])].filter(e => e.suppressionHp > 0).sort((a, b) => a.location.x - b.location.x || a.id.localeCompare(b.id));
    if (!live.length) return;
    const xs = live.map(e => e.location.x);
    for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i], xs[i - 1] + 164);
    let shift = live.reduce((sum, e, i) => sum + e.location.x - xs[i], 0) / live.length;
    shift = Math.max(205 - xs[0], Math.min(1095 - xs[xs.length - 1], shift));
    live.forEach((e, i) => this.enemyLabels.set(e.id, { x: xs[i] + shift, y: e.location.y - 164 }));
  }
  private drawEnemy(e: V3Enemy): void {
    if (e.suppressionHp <= 0) return;
    const time = this.simulation.state.simulationTimeSec, a = this.actor(e), p = e.location;
    const pose = { foot: p, facing: a.facing, time, stride: a.stride, moving: a.moving, selected: this.simulation.state.encounter?.focusEnemyId === e.id, hurt: Math.max(0, e.hitUntilSec - time), working: false, enemy: e, impactRemaining: Math.max(0, e.actionUntilSec - time) };
    if (!this.creatureArt.render(e.sourceAnomalyId, pose, e.id)) drawCreature(this.world, e.sourceAnomalyId, pose);
    const anchor = this.enemyLabels.get(e.id)!;
    this.effects.lineStyle(1, pose.selected ? 0xffdca5 : 0x94afbb, 0.6).lineBetween(anchor.x, anchor.y + 24, p.x, p.y - 96);
    this.effects.fillStyle(0x1a2a35, 0.94).fillRoundedRect(anchor.x - 76, anchor.y - 40, 152, 64, 4);
    this.effects.lineStyle(pose.selected ? 2 : 1, pose.selected ? 0xffdca5 : 0x6b8794, 0.9).strokeRoundedRect(anchor.x - 76, anchor.y - 40, 152, 64, 4);
    const cloneIndex = this.simulation.state.encounter!.enemies.filter(n => n.isClone).findIndex(n => n.id === e.id) + 1;
    this.label(e.isClone ? `复读分身 · ${cloneIndex}` : `${anomalyById[e.sourceAnomalyId].name} · 主样本`, anchor.x, anchor.y - 7, 13, '#ffe0b0');
    this.bar(anchor.x, anchor.y + 8, 130, e.suppressionHp / e.suppressionHpMax, 0xf18e78);
    if (pose.selected) this.world.lineStyle(2, 0xffcf86).strokeEllipse(p.x, p.y + 3, 62, 14);
    if (e.stunnedUntilSec > time) this.label('打断 / 控制中', anchor.x, anchor.y - 28, 12, '#b2eced');
    else if (e.attackPhase !== 'WINDUP') this.label(e.intent, anchor.x, anchor.y - 28, 12, '#b4ced8');
    if (e.attackPhase === 'WINDUP') {
      const color = colors[anomalyById[e.sourceAnomalyId].breach.damage.type], range = e.warningRangePx;
      const left = Math.max(v3Config.arena.minX, p.x - range), right = Math.min(v3Config.arena.maxX, p.x + range);
      this.world.fillStyle(color, 0.12).fillRect(left, p.y - 70, right - left, 75);
      this.effects.lineStyle(3, color, 0.8).lineBetween(left, p.y + 7, right, p.y + 7);
      this.effects.lineStyle(1, color, 0.7).strokeRect(left, p.y - 70, right - left, 77);
      this.label(`${e.intent} · ${Math.max(0, (e.windupEndsAtSec ?? time) - time).toFixed(1)}s`, anchor.x, anchor.y - 28, 12, '#ffce9f');
    }
    this.effectArt.hit({ x: p.x, y: p.y - 45 }, e.hitUntilSec - time);
  }
}
