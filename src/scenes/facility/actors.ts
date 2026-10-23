import type Phaser from 'phaser';
import type { EmployeeRuntime, Point, WorkType } from '../../../contracts/data-contract';
import { weaponById } from '../../data/config';
import { PALETTE, inkBox, inkEllipse, inkLine, inkPolygon } from '../../art/ink';
export { drawCreature, type CreaturePose } from '../../art/characters/abnormalities';

export const INK = PALETTE.ink;
export interface HumanPose {
  foot: Point; facing: -1 | 1; stride: number; moving: boolean; climbing: boolean;
  time: number; selected: boolean; hurt: number; impactRemaining: number; workType?: WorkType;
}
type Graphics = Phaser.GameObjects.Graphics;
type Shape = readonly (readonly [number, number])[];
const SKIN = 0xd9c6a5;
const UNIFORM = 0x68716c;
const HAIR = [0x383238, 0x895649, 0xb0a183, 0x514750, 0x465754, 0x786453];
const EQUIPMENT = [PALETTE.paper, PALETTE.gold, PALETTE.rust, PALETTE.moss, 0x92849a, PALETTE.pale];

function limb(g: Graphics, a: Point, joint: Point, end: Point, width: number, fill: number, seed = 0): void {
  inkLine(g, a.x, a.y, joint.x, joint.y, width + 2.5, INK, seed);
  inkLine(g, joint.x, joint.y, end.x, end.y, width + 2.5, INK, seed + 1);
  inkLine(g, a.x, a.y, joint.x, joint.y, width, fill, seed);
  inkLine(g, joint.x, joint.y, end.x, end.y, width, fill, seed + 1);
}
function patch(g: Graphics, center: Point, points: Shape, color: number, facing = 1, width = 2, seed = 0): void {
  inkPolygon(g, points.map(([x, y]) => ({ x: center.x + x * facing, y: center.y + y })), color, width, seed);
}
/** Six authored hair silhouettes, rather than recolours of one haircut. */
function drawHair(g: Graphics, head: Point, index: number, facing: number): void {
  const shapes: readonly Shape[] = [
    [[-12, 1], [-14, -9], [-8, -15], [-9, -20], [-2, -17], [3, -22], [6, -15], [13, -15], [15, -6], [7, -7], [2, -10], [-2, -4], [-7, -7]],
    [[-12, 5], [-16, -3], [-13, -15], [-3, -18], [10, -14], [17, -7], [10, -5], [5, -1], [7, -9], [-1, -6], [-9, -2]],
    [[-13, 7], [-17, -2], [-14, -12], [-6, -17], [6, -16], [14, -10], [15, 5], [10, 9], [9, -3], [1, -6], [-8, -4], [-8, 8]],
    [[-12, 3], [-18, -3], [-14, -8], [-19, -12], [-8, -13], [-4, -20], [0, -14], [10, -17], [9, -11], [16, -8], [10, -2], [7, -8], [-4, -5]],
    [[-12, 1], [-14, -8], [-11, -14], [3, -16], [12, -12], [14, -7], [4, -8], [-4, -10], [-8, -2]],
    [[-12, 4], [-15, -7], [-10, -15], [-4, -17], [5, -17], [13, -11], [15, -3], [8, -5], [3, -9], [-7, -6], [-8, 4]],
  ];
  if (index === 3) patch(g, head, [[-10, -8], [-22, -6], [-17, 4], [-24, 12], [-13, 7]], HAIR[index], facing, 2.2, index);
  if (index === 5) inkEllipse(g, head.x - facing * 6, head.y - 20, 15, 12, HAIR[index], 2, 5);
  patch(g, head, shapes[index], HAIR[index], facing, 2.2, index);
  inkLine(g, head.x - facing * 9, head.y - 11, head.x - facing * 3, head.y - 14, 1, PALETTE.paperShade, index, 0.55);
}

/** Three-head-height paper-puppet personnel. Time and stride are simulation-owned. */
export function drawHuman(g: Graphics, employee: EmployeeRuntime, pose: HumanPose): void {
  const { x, y } = pose.foot, f = pose.facing, index = (Number(employee.id.slice(1)) - 1) % 6;
  const panic = employee.status === 'PANICKED', injured = employee.hp / employee.hpMax < 0.4;
  const moving = pose.moving ? Math.sin(pose.stride) : 0;
  const breath = Math.sin(pose.time * 2.2 + index) * 0.55;
  const flinch = pose.hurt > 0 ? Math.sin(pose.hurt * 23) * 2 : 0;
  const shake = panic ? Math.sin(pose.time * 19 + index) * 1.2 : 0;
  const lift = pose.moving && !pose.climbing ? Math.abs(Math.cos(pose.stride)) * 1.4 : breath;
  const lean = (pose.workType ? 5 : pose.moving ? 3 : 2) + (injured ? 4 : 0);
  const hip = { x: x - f + shake, y: y - 23 - lift + (injured ? 2 : 0) };
  const shoulder = { x: x + f * (lean - flinch) + shake, y: y - 40 - lift + (injured ? 3 : 0) };
  const head = { x: shoulder.x + f * 3, y: shoulder.y - 12 };
  const trim = EQUIPMENT[Number(employee.armorId.slice(1))] ?? PALETTE.paper;
  inkEllipse(g, x, y + 2, 33, 7, INK, 0, index, 0.3);
  if (pose.selected) {
    g.fillStyle(0xffcf43, 0.16).fillEllipse(x, y + 1, 44, 11);
    g.lineStyle(3, 0xffcf43).strokeEllipse(x, y + 1, 44, 11);
  }
  if (employee.status === 'INCAPACITATED') {
    // Recoverable incapacitation: a fallen puppet, not a new death mechanic.
    patch(g, { x, y }, [[-29, 1], [-19, -4], [-5, -2], [8, 2], [24, 0], [15, 6], [-12, 5]], INK, 1, 0);
    limb(g, { x: x - 9, y: y - 9 }, { x: x - 19, y: y - 4 }, { x: x - 29, y: y - 8 }, 3.5, PALETTE.steel);
    patch(g, { x, y }, [[-14, -13], [6, -16], [12, -5], [-12, -4]], UNIFORM, 1, 2.2);
    inkEllipse(g, x + 17, y - 10, 24, 22, SKIN, 2.4, index);
    drawHair(g, { x: x + 17, y: y - 10 }, index, 1);
    inkLine(g, x + 17, y - 8, x + 22, y - 7, 1.7);
    limb(g, { x: x + 2, y: y - 12 }, { x: x + 2, y: y - 3 }, { x: x + 12, y: y - 1 }, 2.7, SKIN);
    return;
  }
  const feet = [-1, 1].map(side => ({
    x: x + f * (pose.climbing ? side * 9 : side * moving * 10 + side * 3),
    y: y - (pose.climbing ? 6 + side * moving * 6 : Math.max(0, side * moving) * 4),
  }));
  for (const [i, side] of [-1, 1].entries()) {
    const knee = { x: hip.x + f * (side * moving * 5 + (pose.climbing ? 9 : 2)), y: y - (pose.climbing ? 16 + side * moving * 3 : 12) };
    limb(g, hip, knee, feet[i], 3.5, i ? PALETTE.steel : 0x49514f, i);
    patch(g, feet[i], [[-3, -3], [4, -3], [9, 0], [8, 3], [-4, 2]], 0x363237, f, 1.6, i);
  }
  const farElbow = { x: shoulder.x - f * (7 + moving * 5), y: shoulder.y + 9 };
  const farHand = pose.climbing ? { x: x - 13, y: y - 53 + moving * 7 }
    : panic ? { x: shoulder.x - f * 15, y: shoulder.y - 12 + Math.sin(pose.time * 9) * 5 }
      : { x: shoulder.x - f * (8 + moving * 8), y: shoulder.y + 20 };
  limb(g, shoulder, farElbow, farHand, 3, 0x525e58, 4);
  inkEllipse(g, farHand.x, farHand.y, 5, 6, SKIN, 1.3, 4);
  patch(g, shoulder, [[-8, -1], [5, -3], [9, 7], [6, 20], [0, 17], [-8, 20], [-10, 9]], UNIFORM, f, 2.4, index);
  patch(g, shoulder, [[-5, -1], [1, 4], [5, -2], [3, 8], [-2, 11]], PALETTE.paper, f, 1.1);
  patch(g, shoulder, [[0, 4], [3, 6], [2, 15], [-1, 12]], trim, f, 0.8);
  inkLine(g, shoulder.x - f * 6, shoulder.y + 10, hip.x - f * 5, hip.y + 1, 1.1, INK, index);
  inkBox(g, shoulder.x + f * 4 - 2, shoulder.y + 7, 4, 5, trim, 0.8, index);
  const armor = Number(employee.armorId.slice(1));
  if (armor) {
    patch(g, shoulder, [[-9, 0], [-2, -2], [1, 5], [-4, 12], [-10, 8]], trim, f, 1.8, armor);
    if (armor === 2 || armor === 5) patch(g, shoulder, [[-7, -2], [-12, 7], [-13, 18], [-7, 15], [-4, 1]], trim, f, 1.7, armor);
    if (armor === 3) inkBox(g, shoulder.x - 6, shoulder.y + 1, 13, 8, trim, 1.6, 3);
    if (armor === 4) inkEllipse(g, shoulder.x - f * 9, shoulder.y + 4, 8, 9, trim, 1.4, 4);
  }
  patch(g, head, [[-11, -10], [-3, -14], [9, -11], [13, -2], [11, 8], [5, 12], [-4, 10], [-12, 4]], SKIN, f, 2.4, index);
  inkEllipse(g, head.x - f * 11, head.y + 1, 6, 8, PALETTE.paperShade, 1.2, index);
  drawHair(g, head, index, f);
  const eye = { x: head.x + f * 5, y: head.y };
  inkEllipse(g, eye.x, eye.y, panic ? 9 : 7, panic ? 11 : 8, 0xece1c7, 1.2, index);
  inkEllipse(g, head.x - f * 2, head.y - 1, panic ? 5 : 4, panic ? 7 : 5, 0xece1c7, 1, index + 1);
  inkLine(g, eye.x + f, eye.y - 2, eye.x + f, eye.y + (panic ? 3 : 1), 1.7);
  inkLine(g, head.x - f * 2, head.y - 2, head.x - f * 2, head.y, 1.4);
  if (panic) {
    inkEllipse(g, head.x + f * 6, head.y + 8, 5, 7, INK, 1);
    inkLine(g, head.x - 13, head.y - 20, head.x - 16, head.y - 26, 1.8, PALETTE.panic, index);
    inkLine(g, head.x + 14, head.y - 14, head.x + 18, head.y - 20, 1.8, PALETTE.panic, index + 1);
    patch(g, head, [[-6, 3], [-3, 4], [-2, 7]], PALETTE.panic, f, 0);
  } else inkLine(g, head.x + f * 4, head.y + 8, head.x + f * 9, head.y + (injured ? 9 : 6), 1.3);
  if (index === 2) inkBox(g, eye.x - 5, eye.y - 5, 10, 9, 0xd7d0b8, 1, 2, 0.28);
  if (injured) {
    inkLine(g, head.x - f * 5, head.y + 5, head.x - f * 1, head.y + 3, 1.5, PALETTE.rust);
    inkLine(g, shoulder.x + f * 4, shoulder.y + 11, shoulder.x, shoulder.y + 15, 1.8, INK);
  }
  let elbow = { x: shoulder.x + f * (8 - moving * 3), y: shoulder.y + 10 };
  let hand = { x: shoulder.x + f * (13 - moving * 6), y: shoulder.y + 21 };
  let angle = -0.45;
  if (pose.climbing) {
    elbow = { x: x + 10, y: y - 40 - moving * 5 }; hand = { x: x + 14, y: y - 55 - moving * 7 };
  } else if (panic) {
    elbow = { x: shoulder.x + f * 14, y: shoulder.y + 3 };
    hand = { x: head.x + f * 18, y: head.y - 5 + Math.sin(pose.time * 11) * 5 };
  } else if (pose.workType) {
    const beat = Math.sin(pose.time * (pose.workType === 'SOOTHE' ? 2.4 : 5));
    elbow = { x: shoulder.x + f * 11, y: shoulder.y + 10 };
    hand = { x: shoulder.x + f * (23 + beat * 3), y: shoulder.y + 4 + beat * 3 };
  } else if (employee.attackPhase === 'WINDUP' && employee.windupEndsAtSec !== null) {
    const progress = Math.max(0, Math.min(1, 1 - (employee.windupEndsAtSec - pose.time) / weaponById[employee.weaponId].windupSec));
    elbow = { x: shoulder.x - f * 8, y: shoulder.y };
    hand = { x: shoulder.x - f * (16 - progress * 6), y: shoulder.y - 10 }; angle = -1.9 + progress * 0.7;
  } else if (pose.impactRemaining > 0) {
    elbow = { x: shoulder.x + f * 12, y: shoulder.y + 6 };
    hand = { x: shoulder.x + f * 28, y: shoulder.y + 5 }; angle = 0.35;
  } else if (injured) {
    elbow = { x: shoulder.x + f * 10, y: shoulder.y + 14 };
    hand = { x: shoulder.x + f * 3, y: shoulder.y + 14 };
  }
  limb(g, shoulder, elbow, hand, 3.3, UNIFORM, 7);
  inkEllipse(g, hand.x, hand.y, 5.5, 6, SKIN, 1.3, 7);
  if (pose.workType === 'OBSERVE') {
    inkBox(g, hand.x - 5, hand.y - 6, 13, 18, PALETTE.paper, 1.6, index);
    inkBox(g, hand.x - 1, hand.y - 8, 6, 4, PALETTE.steel, 1, index);
    inkLine(g, hand.x - 2, hand.y, hand.x + 5, hand.y + 1, 1, INK);
    inkLine(g, hand.x - 2, hand.y + 5, hand.x + 4, hand.y + 5, 1, INK);
  } else if (!pose.workType && !pose.climbing && !panic) drawWeapon(g, employee.weaponId, hand, f, angle);
  if (pose.hurt > 0) for (let i = 0; i < 4; i++) {
    const dx = (i % 2 ? 1 : -1) * (18 + i * 3), dy = -43 + i * 11;
    inkLine(g, x + dx, y + dy, x + dx * 1.3, y + dy - 4, 2.1, INK, i, Math.min(1, pose.hurt * 5));
  }
}

function drawWeapon(g: Graphics, id: EmployeeRuntime['weaponId'], hand: Point, f: number, angle: number): void {
  const tip = { x: hand.x + f * Math.cos(angle) * 23, y: hand.y + Math.sin(angle) * 23 };
  inkLine(g, hand.x, hand.y, tip.x, tip.y, 6, INK);
  inkLine(g, hand.x, hand.y, tip.x, tip.y, 3, id === 'W05' ? PALETTE.pale : PALETTE.steel);
  if (id === 'W00') {
    inkLine(g, hand.x, hand.y, hand.x + f * 6, hand.y - 2, 5, 0x57534c);
    inkLine(g, tip.x - f * 3, tip.y - 4, tip.x + f * 3, tip.y + 2, 1.2, PALETTE.rust);
  } else if (id === 'W01') {
    patch(g, tip, [[-7, -11], [8, -9], [9, 8], [-4, 11], [-9, 3]], PALETTE.gold, f, 2.2, 1);
    for (let i = 0; i < 3; i++) inkLine(g, tip.x - 4, tip.y - 4 + i * 4, tip.x + 5, tip.y - 5 + i * 4, 1.5);
  } else if (id === 'W02') {
    inkBox(g, hand.x - 4, hand.y - 5, 11, 11, PALETTE.rust, 1.6, 2);
    for (let i = 0; i < 3; i++) patch(g, hand, [[4, -5 + i * 4], [22, -13 + i * 6], [17, -5 + i * 5], [6, -1 + i * 4]], PALETTE.paper, f, 1.3, i);
  } else if (id === 'W03') {
    patch(g, tip, [[-8, -6], [11, -16], [13, 12], [-8, 5]], PALETTE.moss, f, 2.2, 3);
    inkEllipse(g, tip.x + f * 11, tip.y - 1, 7, 27, INK, 1.2, 3);
  } else if (id === 'W04') {
    patch(g, tip, [[-6, -11], [5, -11], [10, 7], [-10, 7]], PALETTE.paperShade, f, 2, 4);
    inkEllipse(g, tip.x, tip.y + 8, 6, 5, PALETTE.rust, 1);
    inkLine(g, tip.x, tip.y - 10, tip.x + f * 4, tip.y - 18, 1.4, INK);
  } else {
    inkEllipse(g, tip.x, tip.y - 1, 15, 24, PALETTE.pale, 2, 5);
    patch(g, tip, [[-3, -7], [4, -5], [1, 0], [5, 4], [-2, 8]], INK, f, 0);
  }
}
