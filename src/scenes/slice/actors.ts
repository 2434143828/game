import Phaser from 'phaser';
import type { EmployeeRuntime, EnemyRuntime, Point, WorkType } from '../../../contracts/data-contract';
import { config, weaponById } from '../../data/config';

export interface HumanPose {
  foot: Point;
  facing: -1 | 1;
  stride: number;
  moving: boolean;
  climbing: boolean;
  time: number;
  selected: boolean;
  hurt: number;
  impactRemaining: number;
  workType?: WorkType;
}
type Joint = { x: number; y: number };
const colors = { outline: 0x17242b, skin: 0xd5aa83, skinLit: 0xedc59a, sleeve: 0xa3b5b1, uniform: 0x6d8990, trouser: 0x314b59, boot: 0x14252c };

function segment(g: Phaser.GameObjects.Graphics, a: Joint, b: Joint, width: number, color: number): void {
  g.lineStyle(width + 2, colors.outline).lineBetween(a.x, a.y, b.x, b.y);
  g.lineStyle(width, color).lineBetween(a.x, a.y, b.x, b.y);
  g.fillStyle(color).fillCircle(b.x, b.y, width * 0.5);
}

/** Articulated original personnel: no animation callback can deal damage or complete work. */
export function drawHuman(g: Phaser.GameObjects.Graphics, employee: EmployeeRuntime, pose: HumanPose): void {
  const x = pose.foot.x; const y = pose.foot.y; const f = pose.facing;
  const motion = pose.moving ? Math.sin(pose.stride) : 0;
  const lift = pose.moving && !pose.climbing ? Math.abs(Math.cos(pose.stride)) * 1.4 : 0;
  const recoil = pose.hurt > 0 ? Math.sin(pose.hurt * 18) * 3 : 0;
  const hip = { x: x + recoil, y: y - 23 - lift };
  const shoulder = { x: x + recoil + (pose.climbing ? 1 : pose.moving ? f * 2 : 0), y: y - 46 - lift };
  const uniform = employee.armorId === 'A00' ? colors.uniform : [colors.uniform, 0xb9a95b, 0xa46a53, 0x647e66, 0x8c7d9c, 0x89aaa1][Number(employee.armorId.slice(-1))];
  const farColor = 0x36515d;
  g.fillStyle(0x10191e, 0.35).fillEllipse(x, y + 2, 30, 8);
  if (pose.selected) {
    g.fillStyle(0x9bcbcb, 0.1).fillEllipse(x, y + 1, 43, 11);
    g.lineStyle(2, 0x8dcbd0, 0.95).strokeEllipse(x, y + 1, 43, 11);
  }

  // Each leg has its own thigh, knee, shin and boot; movement is derived from displacement.
  const farKnee = { x: hip.x - f * (pose.climbing ? 8 + motion * 3 : motion * 7), y: y - (pose.climbing ? 17 - motion * 4 : 13) };
  const farFoot = { x: x - f * (pose.climbing ? 7 : motion * 11), y: y - (pose.climbing ? 6 - motion * 6 : Math.max(0, -motion) * 4) };
  const nearKnee = { x: hip.x + f * (pose.climbing ? 6 + motion * 3 : motion * 7), y: y - (pose.climbing ? 16 + motion * 4 : 12) };
  const nearFoot = { x: x + f * (pose.climbing ? 7 : motion * 11), y: y - (pose.climbing ? 6 + motion * 6 : Math.max(0, motion) * 4) };
  segment(g, hip, farKnee, 7, farColor); segment(g, farKnee, farFoot, 6, farColor);
  g.fillStyle(colors.boot).fillRoundedRect(farFoot.x - 4, farFoot.y - 3, 10, 5, 1);
  segment(g, hip, nearKnee, 8, colors.trouser); segment(g, nearKnee, nearFoot, 7, colors.trouser);
  g.fillStyle(colors.boot).fillRoundedRect(nearFoot.x - 4, nearFoot.y - 3, 11, 6, 1);

  // Far arm behind body.
  const farElbow = pose.climbing ? { x: x - 13, y: y - 49 + motion * 7 } : { x: shoulder.x - f * (4 + motion * 7), y: y - 35 };
  const farHand = pose.climbing ? { x: x - 14, y: y - 58 + motion * 7 } : { x: shoulder.x - f * (4 + motion * 10), y: y - 28 };
  segment(g, shoulder, farElbow, 7, farColor); segment(g, farElbow, farHand, 5, colors.skin);
  g.fillStyle(colors.outline).fillRoundedRect(shoulder.x - 12, shoulder.y - 2, 24, 28, 5);
  g.fillStyle(uniform).fillRoundedRect(shoulder.x - 10, shoulder.y - 2, 20, 26, 4);
  g.fillStyle(0x47616c).fillRect(shoulder.x - 2, shoulder.y, 4, 23);
  g.fillStyle(0xd2dad0).fillRect(shoulder.x - 9, shoulder.y + 4, 6, 8);
  g.fillStyle(0xc1ac61).fillRect(shoulder.x + 5, shoulder.y + 4, 3, 7);
  g.fillStyle(colors.outline).fillRect(hip.x - 10, hip.y - 2, 20, 4);
  g.fillStyle(0xaab9b8).fillRect(hip.x - 2, hip.y - 2, 4, 4);
  // Head, hair/helmet, neck and directional face.
  const headX = shoulder.x + f * 1.5; const headY = shoulder.y - 12;
  g.fillStyle(colors.skin).fillRect(headX - 3, headY + 6, 6, 8);
  g.fillStyle(colors.outline).fillEllipse(headX, headY - 1, 19, 22);
  g.fillStyle(colors.skinLit).fillEllipse(headX + f, headY, 15, 18);
  g.fillStyle(0x263a44).fillRoundedRect(headX - 9, headY - 12, 18, 9, 4);
  g.fillStyle(0x94a8a6).fillRect(headX - 10, headY - 5, 20, 3);
  g.fillStyle(0x1b313b).fillRect(headX + f * 4 - 1, headY - 1, 2, 2);
  g.fillStyle(0xbf9476).fillRect(headX + f * 7, headY + 2, 2, 3);

  // Near hand is used for work and attacks. Windup and impact follow simulation phases.
  let elbow = { x: shoulder.x + f * (7 - motion * 5), y: y - 35 };
  let hand = { x: shoulder.x + f * (11 - motion * 8), y: y - 27 };
  let weaponAngle = -0.45;
  const weapon = weaponById[employee.weaponId];
  const attacking = employee.status === 'SUPPRESSING' && employee.windupEndsAtSec !== null && employee.attackPhase === 'WINDUP';
  if (pose.climbing) {
    elbow = { x: x + 12, y: y - 48 - motion * 7 }; hand = { x: x + 14, y: y - 58 - motion * 7 };
  } else if (pose.workType) {
    const beat = Math.sin(pose.time * (pose.workType === 'SOOTHE' ? 2.3 : 5));
    elbow = { x: shoulder.x + f * 14, y: y - 37 };
    hand = { x: shoulder.x + f * (25 + beat * 4), y: y - 41 + beat * 4 };
  } else if (attacking) {
    const progress = Math.max(0, Math.min(1, 1 - ((employee.windupEndsAtSec ?? 0) - pose.time) / weapon.windupSec));
    elbow = { x: shoulder.x - f * 8, y: y - 45 - progress * 5 };
    hand = { x: shoulder.x - f * 8 + f * progress * 10, y: y - 56 };
    weaponAngle = -1.8 + progress * 0.7;
  } else if (employee.status === 'SUPPRESSING' && pose.impactRemaining > 0) {
    const sinceHit = 0.22 - pose.impactRemaining;
    elbow = { x: shoulder.x + f * 15, y: y - 40 };
    hand = { x: shoulder.x + f * 27, y: y - 36 + sinceHit * 25 };
    weaponAngle = 0.35 + sinceHit;
  }
  segment(g, shoulder, elbow, 8, uniform); segment(g, elbow, hand, 6, colors.skinLit);
  if (pose.workType === 'OBSERVE') {
    g.fillStyle(0x263c45).fillRect(hand.x - 8, hand.y - 6, 16, 19);
    g.fillStyle(0xa8c6bc).fillRect(hand.x - 5, hand.y - 3, 10, 11);
    g.lineStyle(1, 0x597c7d).lineBetween(hand.x - 3, hand.y, hand.x + 3, hand.y).lineBetween(hand.x - 3, hand.y + 4, hand.x + 3, hand.y + 4);
  } else if (!pose.workType && !pose.climbing) {
    const tip = { x: hand.x + f * Math.cos(weaponAngle) * 26, y: hand.y + Math.sin(weaponAngle) * 26 };
    segment(g, hand, tip, employee.weaponId === 'W00' || employee.weaponId === 'W02' ? 5 : 8, employee.weaponId === 'W00' ? 0xa6a99c : 0xb3c6c1);
    g.fillStyle(0x26383d).fillCircle(hand.x, hand.y, 4);
    if (employee.weaponId !== 'W00') g.fillStyle(0x6cabb5).fillCircle(tip.x, tip.y, 5);
  }
  if (pose.hurt > 0) g.lineStyle(2, 0xf6d5bd, Math.min(1, pose.hurt * 3)).strokeEllipse(headX, y - 34, 33, 65);
}

export interface CreaturePose { foot: Point; facing: -1 | 1; time: number; stride: number; moving: boolean; selected: boolean; hurt: number; working: boolean; enemy?: EnemyRuntime }

/** Replaceable original N01 concept: squat long-necked creature, not an official character image. */
export function drawNailongConcept(g: Phaser.GameObjects.Graphics, pose: CreaturePose): void {
  const clone = pose.enemy?.isClone ?? false;
  const scale = clone ? 0.77 : 1;
  const x = pose.foot.x; const y = pose.foot.y;
  const f = pose.facing;
  const moving = pose.moving ? Math.sin(pose.stride) : 0;
  const stunned = pose.enemy ? pose.enemy.stunnedUntilSec > pose.time : false;
  const breath = stunned ? 0 : Math.sin(pose.time * (pose.working ? 4 : 1.9)) * 1.6;
  const hurtLean = pose.hurt > 0 ? -f * Math.sin(pose.hurt * 20) * 4 : 0;
  const color = clone ? 0xbca96a : 0xd4b45f; const light = clone ? 0xd0c290 : 0xebd589;
  const point = (dx: number, dy: number): Point => ({ x: x + dx * scale, y: y + dy * scale });
  const ellipse = (dx: number, dy: number, w: number, h: number, tint: number): void => { const p = point(dx, dy); g.fillStyle(tint).fillEllipse(p.x, p.y, w * scale, h * scale); };
  ellipse(0, 2, 66, 13, 0x182228);
  if (pose.selected) { g.lineStyle(2, 0xdab650).strokeEllipse(x, y + 2, 78 * scale, 18 * scale); }
  // Tail silhouette; two separate feet respond to displacement.
  const tail = [point(-f * 22, -22), point(-f * 52, -12), point(-f * 39, -31), point(-f * 20, -43)];
  g.fillStyle(0xa88a41).fillPoints(tail, true);
  ellipse(-15 + moving * 5, -6, 24, 12, 0xb39347); ellipse(14 - moving * 5, -6, 25, 12, 0xc3a24d);
  ellipse(hurtLean, -32 + breath, 61, 57, color);
  ellipse(hurtLean + f * 3, -29 + breath, 34, 38, light);
  ellipse(f * 9 + hurtLean, -58 + breath, 39, 41, color);
  ellipse(f * 13 + hurtLean, -74 + breath, 45, 38, color);
  // Two asymmetrical rounded horns/ears, blunt snout and profile eyes.
  ellipse(f * 0 + hurtLean, -91 + breath, 11, 18, 0xb69648);
  ellipse(f * 25 + hurtLean, -89 + breath, 9, 16, 0xc6a44e);
  ellipse(f * 30 + hurtLean, -68 + breath, 26, 18, light);
  const eye = point(f * 24 + hurtLean, -78 + breath);
  g.fillStyle(0x263336).fillEllipse(eye.x, eye.y, 5 * scale, 7 * scale);
  g.fillStyle(0xf0e6bd).fillCircle(eye.x - f, eye.y - 2, 1.3 * scale);
  const mouth = point(f * 29 + hurtLean, -63 + breath);
  g.lineStyle(2 * scale, 0x816b38).lineBetween(mouth.x - 3, mouth.y, mouth.x + f * 8, mouth.y - 1);
  const attacking = pose.enemy?.attackPhase === 'WINDUP';
  const armY = attacking ? -55 : -38 + (pose.working ? Math.sin(pose.time * 4) * 5 : 0);
  const a = point(f * 23 + hurtLean, -47 + breath); const b = point(f * (attacking ? 39 : 32), armY + breath);
  segment(g, a, b, 10 * scale, light);
  if (attacking) {
    g.lineStyle(2, 0xeac57d, 0.75).strokeCircle(mouth.x + f * 13, mouth.y, 8 + (pose.time % 0.25) * 22);
  }
  if (stunned) {
    g.lineStyle(2, 0x97d0d2).strokeEllipse(x + f * 10, y - 105 * scale, 37 * scale, 10 * scale);
    g.fillStyle(0xa7dce1).fillCircle(x - 10, y - 105 * scale, 3).fillCircle(x + 18, y - 105 * scale, 3);
  }
  if (pose.hurt > 0) g.lineStyle(2, 0xf9dcc0, Math.min(1, pose.hurt * 3)).strokeEllipse(x, y - 49 * scale, 68 * scale, 96 * scale);
}

