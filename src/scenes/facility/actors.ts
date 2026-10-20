import Phaser from 'phaser';
import type { AnomalyId, EmployeeRuntime, EnemyRuntime, Point, WorkType } from '../../../contracts/data-contract';
import { weaponById } from '../../data/config';
import { ROOM_COLORS } from './geometry';

export const INK = 0x18191f;
export interface HumanPose {
  foot: Point; facing: -1 | 1; stride: number; moving: boolean; climbing: boolean;
  time: number; selected: boolean; hurt: number; impactRemaining: number; workType?: WorkType;
}
export interface CreaturePose {
  foot: Point; facing: -1 | 1; time: number; stride: number; moving: boolean;
  selected: boolean; hurt: number; working: boolean; enemy?: EnemyRuntime; impactRemaining?: number;
}
const skin = 0xf1c6a0;
const hair = [0x292630, 0xb46b4a, 0xd2c5a0, 0x473549, 0x55716a, 0x8d5a4d];
function ellipse(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, outline = 3): void {
  g.fillStyle(color).fillEllipse(x, y, w, h);
  if (outline) g.lineStyle(outline, INK).strokeEllipse(x, y, w, h);
}
function rect(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, color: number, outline = 3): void {
  g.fillStyle(color).fillRect(x, y, w, h);
  if (outline) g.lineStyle(outline, INK).strokeRect(x, y, w, h);
}
function segment(g: Phaser.GameObjects.Graphics, a: Point, b: Point, width: number, color: number): void {
  g.lineStyle(width + 3, INK).lineBetween(a.x, a.y, b.x, b.y);
  g.lineStyle(width, color).lineBetween(a.x, a.y, b.x, b.y);
  g.fillStyle(color).fillCircle(b.x, b.y, width / 2);
}

/** Cel-shaded articulated personnel. All poses depend exclusively on simulation state/time. */
export function drawHuman(g: Phaser.GameObjects.Graphics, employee: EmployeeRuntime, pose: HumanPose): void {
  const x = pose.foot.x; const y = pose.foot.y; const f = pose.facing;
  const step = pose.moving ? Math.sin(pose.stride) : 0;
  const bounce = pose.moving && !pose.climbing ? Math.abs(Math.cos(pose.stride)) * 1.6 : 0;
  const recoil = pose.hurt > 0 ? -f * Math.sin(pose.hurt * 18) * 3 : 0;
  const hip = { x: x + recoil, y: y - 21 - bounce };
  const shoulder = { x: x + recoil + (pose.moving ? f * 2 : 0), y: y - 41 - bounce };
  const index = Number(employee.id.slice(1)) - 1;
  const armorIndex = Number(employee.armorId.slice(1));
  const trim = armorIndex ? ROOM_COLORS[`N0${armorIndex}` as AnomalyId] : 0xe9ddd0;
  g.fillStyle(INK, 0.25).fillEllipse(x, y + 2, 34, 8);
  if (pose.selected) { g.fillStyle(0xffd04c, 0.18).fillEllipse(x, y + 1, 44, 11); g.lineStyle(3, 0xffcf43).strokeEllipse(x, y + 1, 44, 11); }
  if (employee.status === 'INCAPACITATED') {
    ellipse(g, x + 10, y - 8, 26, 18, skin); rect(g, x - 24, y - 12, 30, 12, 0x292b37);
    g.lineStyle(2, INK).lineBetween(x + 4, y - 10, x + 10, y - 6).lineBetween(x + 10, y - 10, x + 4, y - 6);
    return;
  }
  const farKnee = { x: hip.x - f * (pose.climbing ? 8 + step * 3 : step * 7), y: y - (pose.climbing ? 15 - step * 4 : 11) };
  const nearKnee = { x: hip.x + f * (pose.climbing ? 6 + step * 3 : step * 7), y: y - (pose.climbing ? 15 + step * 4 : 11) };
  const farFoot = { x: x - f * (pose.climbing ? 9 : step * 11), y: y - (pose.climbing ? 5 - step * 5 : Math.max(0, -step) * 5) };
  const nearFoot = { x: x + f * (pose.climbing ? 9 : step * 11), y: y - (pose.climbing ? 5 + step * 5 : Math.max(0, step) * 5) };
  segment(g, hip, farKnee, 6, 0x262732); segment(g, farKnee, farFoot, 5, 0x262732);
  segment(g, hip, nearKnee, 7, 0x3c3b48); segment(g, nearKnee, nearFoot, 6, 0x3c3b48);
  rect(g, farFoot.x - 4, farFoot.y - 3, 11, 5, INK, 1); rect(g, nearFoot.x - 4, nearFoot.y - 3, 12, 5, INK, 1);
  const farElbow = pose.climbing ? { x: x - 15, y: y - 44 + step * 6 } : { x: shoulder.x - f * (6 + step * 5), y: y - 30 };
  const farHand = pose.climbing ? { x: x - 17, y: y - 55 + step * 6 } : { x: shoulder.x - f * (7 + step * 8), y: y - 23 };
  segment(g, shoulder, farElbow, 6, 0x252630); segment(g, farElbow, farHand, 5, skin);
  // Jacket, bright shirt and tie remain legible at 1280 × 720.
  g.fillStyle(0x30303c).fillPoints([{ x: shoulder.x - 11, y: shoulder.y }, { x: shoulder.x + 11, y: shoulder.y }, { x: hip.x + 10, y: hip.y + 3 }, { x: hip.x - 10, y: hip.y + 3 }], true);
  g.lineStyle(3, INK).strokePoints([{ x: shoulder.x - 11, y: shoulder.y }, { x: shoulder.x + 11, y: shoulder.y }, { x: hip.x + 10, y: hip.y + 3 }, { x: hip.x - 10, y: hip.y + 3 }], true);
  g.fillStyle(0xfff7e5).fillTriangle(shoulder.x - 7, shoulder.y, shoulder.x + 7, shoulder.y, shoulder.x, shoulder.y + 13);
  g.fillStyle(trim).fillTriangle(shoulder.x, shoulder.y + 3, shoulder.x - 3, shoulder.y + 15, shoulder.x + 3, shoulder.y + 15);
  g.lineStyle(3, trim).lineBetween(shoulder.x - 10, shoulder.y + 2, hip.x - 8, hip.y);
  rect(g, shoulder.x + 5, shoulder.y + 6, 4, 5, trim, 1);
  // Large expressive face with individual hair silhouettes.
  const hx = shoulder.x + f; const hy = shoulder.y - 12;
  ellipse(g, hx, hy, 25, 26, skin);
  g.fillStyle(0xd99478).fillEllipse(hx - f * 7, hy + 4, 6, 5);
  g.fillStyle(hair[index % hair.length]).fillPoints([
    { x: hx - 13, y: hy - 1 }, { x: hx - 13, y: hy - 12 }, { x: hx - 6, y: hy - 18 },
    { x: hx - 1, y: hy - 15 }, { x: hx + 7, y: hy - 18 + index % 3 * 2 },
    { x: hx + 14, y: hy - 9 }, { x: hx + 9, y: hy + 1 },
    { x: hx + 5, y: hy - 7 }, { x: hx - 1, y: hy - 3 }, { x: hx - 5, y: hy - 8 },
  ], true);
  g.lineStyle(2, INK).lineBetween(hx - 11, hy - 12, hx - 5, hy - 16).lineBetween(hx - 5, hy - 16, hx, hy - 13);
  g.fillStyle(0xfff5dc).fillEllipse(hx + f * 5, hy + 1, 6, 6);
  g.fillStyle(INK).fillRect(hx + f * 6 - 1, hy - 1, 3, 5);
  g.lineStyle(1.5, INK).lineBetween(hx + f * 2, hy + 8, hx + f * 7, hy + 7);
  if (index % 3 === 2) g.lineStyle(1.5, INK).strokeRect(hx + f * 2 - 3, hy - 3, 10, 8);
  let elbow = { x: shoulder.x + f * (9 - step * 4), y: y - 31 };
  let hand = { x: shoulder.x + f * (14 - step * 7), y: y - 23 };
  let angle = -0.45;
  const weapon = weaponById[employee.weaponId];
  if (pose.climbing) { elbow = { x: x + 14, y: y - 44 - step * 6 }; hand = { x: x + 17, y: y - 55 - step * 6 }; }
  else if (pose.workType) {
    const beat = Math.sin(pose.time * (pose.workType === 'SOOTHE' ? 2.3 : 5));
    elbow = { x: shoulder.x + f * 14, y: y - 31 }; hand = { x: shoulder.x + f * (25 + beat * 4), y: y - 37 + beat * 4 };
  } else if (employee.attackPhase === 'WINDUP' && employee.windupEndsAtSec !== null) {
    const p = Math.max(0, Math.min(1, 1 - (employee.windupEndsAtSec - pose.time) / weapon.windupSec));
    elbow = { x: shoulder.x - f * 9, y: y - 42 }; hand = { x: shoulder.x - f * (14 - p * 8), y: y - 54 };
    angle = -1.8 + p * 0.7;
  } else if (pose.impactRemaining > 0) {
    elbow = { x: shoulder.x + f * 14, y: y - 36 }; hand = { x: shoulder.x + f * 29, y: y - 33 }; angle = 0.5;
  }
  segment(g, shoulder, elbow, 7, 0x3b3a48); segment(g, elbow, hand, 5, skin);
  if (pose.workType === 'OBSERVE') {
    rect(g, hand.x - 7, hand.y - 6, 16, 20, 0xe9e1cd, 2);
    g.lineStyle(2, 0x637986).lineBetween(hand.x - 3, hand.y, hand.x + 5, hand.y).lineBetween(hand.x - 3, hand.y + 5, hand.x + 3, hand.y + 5);
  } else if (!pose.workType && !pose.climbing) drawWeapon(g, employee.weaponId, hand, f, angle);
  if (pose.hurt > 0) g.lineStyle(3, 0xfff5d0, Math.min(1, pose.hurt * 3)).strokeEllipse(x, y - 32, 36, 67);
}

function drawWeapon(g: Phaser.GameObjects.Graphics, id: EmployeeRuntime['weaponId'], hand: Point, f: number, angle: number): void {
  const tip = { x: hand.x + f * Math.cos(angle) * 25, y: hand.y + Math.sin(angle) * 25 };
  if (id === 'W00') { segment(g, hand, tip, 5, 0xaab1b8); segment(g, hand, { x: hand.x + f * 7, y: hand.y - 3 }, 6, 0x35333b); }
  else if (id === 'W02') {
    rect(g, hand.x - 5, hand.y - 5, 13, 12, 0xc85c59, 2);
    for (let i = 0; i < 3; i++) g.lineStyle(3, 0xe9e8df).lineBetween(hand.x + f * 5, hand.y - 5 + i * 5, hand.x + f * 23, hand.y - 12 + i * 5);
  } else if (id === 'W03' || id === 'W04') {
    segment(g, hand, tip, 7, id === 'W03' ? 0x829777 : 0xb28cc7);
    g.fillStyle(id === 'W03' ? 0x7d9874 : 0xb49cd2).fillTriangle(tip.x - f * 7, tip.y - 5, tip.x + f * 10, tip.y - 15, tip.x + f * 10, tip.y + 9);
    g.lineStyle(3, INK).lineBetween(tip.x + f * 10, tip.y - 15, tip.x + f * 10, tip.y + 9);
  } else if (id === 'W01') {
    segment(g, hand, tip, 5, 0x765e35); rect(g, tip.x - 7, tip.y - 10, 17, 20, 0xefbe48, 2);
    for (let i = 0; i < 3; i++) g.lineStyle(2, INK).lineBetween(tip.x - 3, tip.y - 5 + i * 5, tip.x + 6, tip.y - 5 + i * 5);
  } else { segment(g, hand, tip, 6, 0x70a6ba); ellipse(g, tip.x, tip.y, 17, 23, 0xd5e9e8, 2); g.lineStyle(2, 0x447d93).strokeCircle(tip.x, tip.y, 4); }
}

/** Five original concept silhouettes; not official IP assets. */
export function drawCreature(g: Phaser.GameObjects.Graphics, id: AnomalyId, pose: CreaturePose): void {
  const clone = pose.enemy?.isClone ?? false;
  const s = clone ? 0.76 : id === 'N03' ? 1.06 : 1;
  const x = pose.foot.x; const y = pose.foot.y; const f = pose.facing;
  const stunned = Boolean(pose.enemy && pose.enemy.stunnedUntilSec > pose.time);
  const walk = pose.moving && !stunned ? Math.sin(pose.stride) : 0;
  const breath = stunned ? 0 : Math.sin(pose.time * (pose.working ? 4 : 2)) * 1.3;
  const windup = pose.enemy?.attackPhase === 'WINDUP';
  const impact = (pose.impactRemaining ?? 0) > 0;
  const lean = pose.hurt > 0 ? -f * 4 : windup ? -f * 3 : impact ? f * 6 : 0;
  const p = (dx: number, dy: number): Point => ({ x: x + (dx + lean) * s, y: y + dy * s });
  const e = (dx: number, dy: number, w: number, h: number, color: number, outline = 3): void => { const pt = p(dx, dy); ellipse(g, pt.x, pt.y, w * s, h * s, color, outline * s); };
  const poly = (points: number[][], color: number): void => { const pts = points.map(([dx, dy]) => p(dx, dy)); g.fillStyle(color).fillPoints(pts, true); g.lineStyle(3 * s, INK).strokePoints(pts, true); };
  g.fillStyle(INK, 0.2).fillEllipse(x, y + 3, (id === 'N03' ? 103 : 64) * s, 13 * s);
  if (pose.selected) g.lineStyle(3, 0xffdb64).strokeEllipse(x, y + 2, (id === 'N03' ? 110 : 78) * s, 17 * s);
  if (id === 'N01') {
    const gold = clone ? 0xd2ab57 : 0xf5c63f;
    poly([[-f * 20, -13], [-f * 48, -7], [-f * 38, -35], [-f * 14, -39]], 0xdba72b);
    e(-14 + walk * 5, -6, 23, 12, 0xdca32c); e(14 - walk * 5, -6, 24, 12, gold);
    e(0, -32 + breath, 61, 58, gold); e(f * 5, -28 + breath, 36, 39, 0xffe493, 1.5);
    e(f * 8, -64 + breath, 42, 51, gold); e(f * 11, -81 + breath, 47, 37, gold);
    e(-f * 2, -97 + breath, 10, 17, 0xd7a531); e(f * 25, -94 + breath, 9, 16, gold);
    e(f * 30, -73 + breath, 25, 18, 0xffdc70, 2);
    e(f * 21, -84 + breath, 8, 10, 0xfff6d7, 1); e(f * 23, -83 + breath, 4, 7, INK, 0);
    const mouth = p(f * 28, -68 + breath); g.lineStyle(2, INK).lineBetween(mouth.x - 4, mouth.y, mouth.x + f * 9, mouth.y);
    segment(g, p(f * 20, -43 + breath), p(f * (windup ? 41 : 31), (windup ? -57 : -35) + breath), 10 * s, 0xffd85d);
  } else if (id === 'N02') {
    poly([[-22, -14], [-43, -30], [-40, -49], [-30, -43], [-28, -24]], 0x79828b);
    e(-13 + walk * 5, -5, 19, 12, 0x697580); e(13 - walk * 5, -5, 19, 12, 0x9fa8ae);
    e(0, -29 + breath, 46, 50, 0x8c969e); e(f * 3, -24 + breath, 24, 28, 0xd7d8ce, 1.5);
    poly([[-25, -66], [-28, -91], [-8, -79], [15, -81], [29, -96], [29, -62]], 0x8c969e);
    e(0, -65 + breath, 61, 47, 0x9da7ab);
    poly([[-24, -78], [-23, -87], [-14, -80]], 0xd48b91); poly([[18, -83], [26, -90], [25, -79]], 0xd48b91);
    for (const side of [-1, 1]) {
      e(side * 13, -65 + breath, 14, 9, 0xeee8bc, 1.5); e(side * 12, -64 + breath, 3, 7, INK, 0);
      const a = p(side * 21, -72 + breath); const b = p(side * 6, -66 + breath); g.lineStyle(3, INK).lineBetween(a.x, a.y, b.x, b.y);
      segment(g, p(side * 16, -38), p(side * (windup || impact ? 40 : 23), windup ? -53 : impact ? -30 : -22), 9 * s, 0x929da4);
      for (let i = 0; i < 2; i++) { const a1 = p(side * 22, -56 + i * 5); const b1 = p(side * 38, -59 + i * 8); g.lineStyle(1.5, INK).lineBetween(a1.x, a1.y, b1.x, b1.y); }
    }
    poly([[-4, -57], [4, -57], [0, -53]], 0xb87078);
  } else if (id === 'N03') {
    poly([[-f * 35, -30], [-f * 58, -60], [-f * 55, -32], [-f * 34, -17]], 0x444550);
    for (const leg of [-1, 1]) {
      segment(g, p(leg * 25, -32), p(leg * 28 + walk * leg * 7, -7), 13 * s, leg < 0 ? 0x383a43 : 0x555662);
      e(leg * 28 + walk * leg * 7 + f * 3, -5, 22, 11, 0x3d3c45);
    }
    e(-8, -41 + breath, 82, 49, 0x555761);
    poly([[f * 13, -65], [f * 23, -81], [f * 45, -76], [f * 52, -40], [f * 24, -32]], 0x353741);
    e(f * 29, -65 + breath, 45, 45, 0x5f6069);
    poly([[f * 16, -78], [f * 12, -101], [f * 33, -83]], 0x41414b);
    e(f * 49, -58 + breath, 32, 25, 0x9b9a91); e(f * 62, -62 + breath, 12, 11, INK, 1);
    e(f * 37, -72 + breath, 10, 7, 0xffc956, 1); e(f * 39, -72 + breath, 3, 6, INK, 0);
    const jaw = p(f * 47, -47 + breath); g.lineStyle(windup ? 5 : 2, INK).lineBetween(jaw.x - 8, jaw.y, jaw.x + f * 15, jaw.y - 2);
    segment(g, p(f * 11, -53), p(f * 28, -37), 6, 0xb55349);
    e(f * 24, -35, 9, 10, 0xe5c169, 1);
  } else if (id === 'N04') {
    for (const leg of [-1, 1]) {
      segment(g, p(leg * 12, -19), p(leg * 13 + walk * leg * 4, -4), 5 * s, 0xdd9b39);
      const a = p(leg * 13, -3); g.lineStyle(3, INK).lineBetween(a.x - 6, a.y, a.x + 8, a.y);
    }
    poly([[-f * 21, -23], [-f * 42, -50], [-f * 27, -42], [-f * 41, -65], [-f * 15, -51]], 0xe1e3d9);
    e(0, -39 + breath, 59, 60, 0xf5f0dd); e(f * 5, -69 + breath, 33, 42, 0xfff8e5);
    e(f * 1, -91 + breath, 12, 20, 0xcf4b46); e(f * 12, -89 + breath, 11, 16, 0xe35b51); e(-f * 8, -87 + breath, 11, 16, 0xc64742);
    poly([[f * 17, -72], [f * 36, -66], [f * 17, -60]], 0xe8ac43);
    e(f * 14, -77 + breath, 7, 9, INK, 1); e(f * 17, -54, 9, 16, 0xd64a45);
    segment(g, p(-f * 3, -42), p(-f * (windup ? 31 : 22), windup ? -59 : -30), 12, 0xdedfd5);
    e(f * 6, -30, 25, 25, 0xd8b458, 2); e(f * 6, -30, 17, 17, 0xfff0b1, 1);
    const bell = p(f * 6, -30); g.lineStyle(2, INK).lineBetween(bell.x, bell.y - 6, bell.x, bell.y).lineBetween(bell.x, bell.y, bell.x + 5, bell.y + 2);
  } else {
    e(-13 + walk * 4, -5, 25, 12, 0xd5a34d); e(14 - walk * 4, -5, 25, 12, 0xe1b256);
    e(0, -41 + breath, 56, 76, 0x303944); e(f * 2, -34 + breath, 35, 53, 0xecebdd, 2);
    e(f * 2, -73 + breath, 43, 37, 0x303944); e(f * 10, -72 + breath, 27, 27, 0xf3efe0, 1.5);
    e(f * 14, -77 + breath, 6, 8, INK, 1);
    poly([[f * 19, -69], [f * 34, -64], [f * 20, -60]], 0xe0ae56);
    segment(g, p(-f * 23, -54), p(-f * (windup ? 39 : 28), windup ? -63 : -23), 11, 0x384552);
    segment(g, p(f * 23, -53), p(f * (windup ? 39 : 29), windup ? -64 : -24), 11, 0x384552);
    segment(g, p(-18, -59), p(20, -59), 9, 0x6eaac1);
    poly([[-f * 4, -60], [-f * 18, -42], [-f * 8, -37], [f * 3, -57]], 0x87b9c9);
  }
  if (stunned) {
    g.lineStyle(3, 0x78e0ee).strokeEllipse(x, y - 112 * s, 39, 10);
    for (const dx of [-17, 17]) {
      g.fillStyle(0xffd154).fillPoints(Array.from({ length: 8 }, (_, i) => {
        const angle = i * Math.PI / 4; const radius = i % 2 ? 2 : 5;
        return { x: x + dx + Math.cos(angle) * radius, y: y - 113 * s + Math.sin(angle) * radius };
      }), true);
    }
  }
  if (pose.hurt > 0) g.lineStyle(3, 0xfff5d4, Math.min(1, pose.hurt * 3)).strokeEllipse(x, y - 49 * s, 72 * s, 100 * s);
}
