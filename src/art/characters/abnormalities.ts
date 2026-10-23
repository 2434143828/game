import type Phaser from 'phaser';
import type { AnomalyId, EnemyRuntime, Point } from '../../../contracts/data-contract';
import { PALETTE, inkEllipse, inkLine, inkPolygon } from '../ink';

export interface CreaturePose {
  foot: Point; facing: -1 | 1; time: number; stride: number; moving: boolean;
  selected: boolean; hurt: number; working: boolean; enemy?: EnemyRuntime; impactRemaining?: number;
}
type Shape = readonly (readonly [number, number])[];
const INK = PALETTE.ink;
interface Brush {
  ellipse(x: number, y: number, width: number, height: number, color: number, line?: number, alpha?: number): void;
  polygon(points: Shape, color: number, line?: number, alpha?: number): void;
  line(x1: number, y1: number, x2: number, y2: number, width?: number, color?: number, alpha?: number): void;
}
interface Motion {
  breached: boolean; windup: boolean; impact: boolean; walk: number;
  breath: number; beat: number; glitch: number; working: boolean; time: number;
}

/** Original ink silhouettes. All movement, distortion and held poses use simulation inputs. */
export function drawCreature(g: Phaser.GameObjects.Graphics, id: AnomalyId, pose: CreaturePose): void {
  const { x, y } = pose.foot, f = pose.facing;
  const breached = Boolean(pose.enemy), clone = pose.enemy?.isClone ?? false;
  const scale = clone ? 0.76 : id === 'N03' ? 1.06 : 1;
  const stunned = Boolean(pose.enemy && pose.enemy.stunnedUntilSec > pose.time);
  const windup = pose.enemy?.attackPhase === 'WINDUP';
  const impact = (pose.impactRemaining ?? 0) > 0;
  const walk = pose.moving && !stunned ? Math.sin(pose.stride) : 0;
  const breath = stunned ? 0 : Math.sin(pose.time * (pose.working ? 3.7 : 1.8)) * 1.2;
  const beat = pose.working ? Math.sin(pose.time * 4.3) : 0;
  const glitch = breached && !stunned ? Math.sin(Math.floor(pose.time * 7) * 2.7) : 0;
  const lean = pose.hurt > 0 ? -4 : windup ? -3 : impact ? 6 : 0;
  const seed = Number(id.slice(1));
  const p = (dx: number, dy: number): Point => ({ x: x + f * (dx + lean) * scale, y: y + dy * scale });
  const brush: Brush = {
    ellipse(dx, dy, width, height, color, line = 2.8, alpha = 1) {
      const point = p(dx, dy);
      inkEllipse(g, point.x, point.y, width * scale, height * scale, color, line * scale, seed + dx * 0.1, alpha);
    },
    polygon(points, color, line = 2.8, alpha = 1) {
      inkPolygon(g, points.map(([dx, dy]) => p(dx, dy)), color, line * scale, seed, alpha);
    },
    line(x1, y1, x2, y2, width = 1.6, color = INK, alpha = 1) {
      const a = p(x1, y1), b = p(x2, y2);
      inkLine(g, a.x, a.y, b.x, b.y, width * scale, color, seed, alpha);
    },
  };
  const shadowShift = id === 'N03' && breached ? Math.sin(pose.stride + 1.2) * 9 : 0;
  inkEllipse(g, x + f * shadowShift, y + 3, (id === 'N03' ? 108 : 67) * scale, 12 * scale, INK, 0, seed, 0.32);
  if (pose.selected) g.lineStyle(3, 0xffcf43).strokeEllipse(x, y + 2, (id === 'N03' ? 110 : 78) * scale, 17 * scale);
  const motion = { breached, windup, impact, walk, breath, beat, glitch, working: pose.working, time: pose.time };
  if (id === 'N01') nailong(brush, motion, clone);
  else if (id === 'N02') cat(brush, motion);
  else if (id === 'N03') dog(brush, motion);
  else if (id === 'N04') chicken(brush, motion);
  else penguin(brush, motion);
  if (stunned) {
    inkEllipse(g, x, y - 112 * scale, 36, 9, PALETTE.pale, 1.8, seed, 0.6);
    for (const dx of [-16, 16]) {
      inkPolygon(g, [[0, -5], [2, -1], [5, 0], [1, 2], [0, 5], [-2, 1], [-5, 0], [-1, -2]]
        .map(([sx, sy]) => ({ x: x + dx + sx, y: y - 113 * scale + sy })), PALETTE.gold, 1);
    }
  }
  if (pose.hurt > 0) {
    for (let i = 0; i < 5; i++) brush.line((i % 2 ? -1 : 1) * 39, -18 - i * 15, (i % 2 ? -1 : 1) * 47, -22 - i * 15, 2.5, INK, Math.min(1, pose.hurt * 5));
  }
}

function nailong(b: Brush, m: Motion, clone: boolean): void {
  const yellow = clone ? 0xbda366 : 0xd9b854, shade = 0xad8d45, cream = 0xe9d38c;
  const stretch = m.breached ? 9 + m.glitch * 2 : 0, headX = m.working ? 10 + m.beat * 2 : 7;
  b.polygon([[-19, -14], [-48, -8], [-38, -21], [-35, -36], [-17, -39]], shade);
  b.ellipse(-14 + m.walk * 5, -5, 24, 11, shade);
  b.ellipse(15 - m.walk * 5, -5, 25, 11, yellow);
  b.polygon([[-22, -9], [-31, -30], [-25, -49], [-9, -56 - stretch], [15, -53 - stretch], [29, -33], [26, -13], [5, -5]], yellow);
  b.ellipse(5, -30 + m.breath, 35, 39, cream, 1.4);
  b.polygon([[-9, -41], [-14, -66 - stretch], [-9, -91 - stretch], [17, -94 - stretch], [29, -76 - stretch], [25, -48]], yellow);
  b.ellipse(headX, -78 - stretch + m.breath, 46, 35, yellow);
  b.polygon([[-8, -88 - stretch], [-11, -105 - stretch], [-2, -99 - stretch], [1, -87 - stretch]], shade, 2);
  b.polygon([[22, -89 - stretch], [29, -102 - stretch], [31, -88 - stretch]], yellow, 2);
  if (m.breached) {
    b.ellipse(3 + m.glitch, -84 - stretch, 12, 15, INK, 2);
    b.ellipse(21 + m.glitch, -85 - stretch, 7, 11, INK, 1.5);
    b.polygon([[-2, -70 - stretch], [33, -79 - stretch], [41, -66 - stretch], [22, -43], [8, -53], [5, -63 - stretch]], INK, 2.5);
    for (let i = 0; i < 5; i++) b.polygon([[6 + i * 6, -72 - stretch], [10 + i * 5, -71 - stretch], [9 + i * 5, -61 - stretch + i]], cream, 0.6);
    b.line(-24, -50, -34, -47, 2, shade); b.line(-25, -45, -37, -43, 1.4, shade);
  } else {
    b.ellipse(headX - 4, -83 + m.breath, 9, 12, cream, 1.4);
    b.ellipse(headX + 14, -81 + m.breath, 7, 9, cream, 1.2);
    b.line(headX - 2, -85 + m.breath, headX - 1, -80 + m.breath, 2.2);
    b.line(headX + 15, -82 + m.breath, headX + 15, -78 + m.breath, 1.8);
    b.ellipse(headX + 20, -69 + m.breath, 23, 15, cream, 1.8);
    b.line(headX + 11, -66 + m.breath, headX + 28, -66 + m.breath + (m.working ? 3 : 0), 1.5);
  }
  const handY = m.windup ? -61 : m.working ? -54 + m.beat * 4 : -34;
  b.polygon([[19, -46], [31, -43 + m.beat * 3], [35, handY], [27, handY + 5], [22, -38]], yellow, 2);
  b.line(-17, -29, -12, -22, 1.1, shade);
}

function cat(b: Brush, m: Motion): void {
  const fur = 0x929b92, shade = 0x65736e, pale = 0xd6d0b4;
  const headY = (m.breached ? -83 : m.working ? -70 : -63) + m.breath, twitch = m.breached ? m.glitch * 3 : m.beat * 1.5;
  b.polygon([[-18, -19], [-36, -29], [-41, -52], [-33, -49], [-29, -33], [-14, -28]], shade);
  b.polygon([[-18, -10], [-21, -38], [-11, m.breached ? -66 : -50], [12, m.breached ? -61 : -45], [22, -25], [15, -8]], fur);
  b.ellipse(2, -31, 24, 32, pale, 1.2);
  for (const side of [-1, 1]) {
    if (m.breached) {
      b.polygon([[side * 12, -58], [side * 25, -44], [side * 19, -22], [side * (39 + m.walk * 3), -7], [side * 30, -3], [side * 11, -23]], fur, 2.4);
      b.line(side * 33, -8, side * 42, -11, 1.4, pale);
      b.line(side * 32, -5, side * 42, -5, 1.4, pale);
    } else {
      b.ellipse(side * 14 + side * m.walk * 4, -5, 18, 11, side > 0 ? fur : shade);
      if (m.working) {
        const pawY = -51 + side * m.beat * 5;
        b.polygon([[side * 15, -43], [side * 28, -34], [side * 34, pawY], [side * 25, pawY - 4], [side * 19, -42]], fur, 2);
        b.ellipse(side * 29, pawY - 3, 12, 10, pale, 1.7);
      } else b.polygon([[side * 15, -43], [side * 24, -31], [side * 20, -18], [side * 11, -28]], fur, 2);
    }
  }
  b.polygon([[-28 + twitch, headY - 1], [-31 + twitch, headY - 28], [-12 + twitch, headY - 17], [11 + twitch, headY - 19], [28 + twitch, headY - 32], [30 + twitch, headY + 7], [14 + twitch, headY + 20], [-12 + twitch, headY + 17]], fur);
  b.polygon([[-25 + twitch, headY - 18], [-25 + twitch, headY - 25], [-16 + twitch, headY - 18]], PALETTE.rust, 1);
  b.polygon([[18 + twitch, headY - 18], [26 + twitch, headY - 26], [25 + twitch, headY - 13]], PALETTE.rust, 1);
  b.ellipse(-13 + twitch, headY + 1, 16, m.breached ? 14 : 8, pale, 1.7);
  b.ellipse(12 + twitch, headY + 3, 12, m.breached ? 17 : 8, pale, 1.5);
  b.line(-12 + twitch, headY - 2, -11 + twitch, headY + 5, 2.3); b.line(13 + twitch, headY - 1, 12 + twitch, headY + 7, 2);
  b.line(-22 + twitch, headY - 6, -5 + twitch, headY - 2, 2.3); b.line(6 + twitch, headY - 4, 22 + twitch, headY - 7, 2);
  b.polygon([[-4 + twitch, headY + 10], [4 + twitch, headY + 9], [1 + twitch, headY + 14]], PALETTE.rust, 1);
  if (m.breached) b.polygon([[-5 + twitch, headY + 15], [9 + twitch, headY + 13], [6 + twitch, headY + 25], [-3 + twitch, headY + 19]], INK, 1.3);
  else b.line(1 + twitch, headY + 14, 7 + twitch, headY + 16, 1.2);
  for (const side of [-1, 1]) {
    b.line(side * 20 + twitch, headY + 12, side * 37 + twitch, headY + 8, 1.1);
    b.line(side * 21 + twitch, headY + 15, side * 35 + twitch, headY + 19, 1.1);
  }
}

function dog(b: Brush, m: Motion): void {
  const fur = 0x6c7065, shade = 0x484d47, muzzle = 0xb6ae8b;
  b.polygon([[-34, -21], [-53, -38], [-57, -61], [-44, -49], [-30, -38]], shade);
  for (const side of [-1, 1]) {
    const foot = side * 28 + side * m.walk * 6;
    const raised = m.working && side > 0 ? 10 + Math.abs(m.beat) * 4 : 0;
    b.polygon([[side * 25, -36], [side * 33, -27], [foot + 3, -5 - raised], [foot - 8, -4 - raised], [side * 19, -22]], shade);
    b.ellipse(foot + 4, -5 - raised, 26, 11, shade, 2);
  }
  b.polygon([[-41, -31], [-35, -53], [-17, -67], [11, -61], [30, -48], [26, -19], [7, -12], [-23, -18]], fur);
  b.polygon([[-35, -39], [-15, -47], [-22, -25], [-31, -24]], shade, 0);
  b.polygon([[1, -46], [8, -80], [26, -90], [48, -76], [50, -44], [27, -27]], fur);
  b.polygon([[9, -78], [-5, -89], [-10, -70], [2, -59], [9, -65]], shade, 2.5);
  b.polygon([[31, -85], [42, -98], [47, -76]], shade, 2.4);
  b.ellipse(33, -74 + m.breath, 11, 8, PALETTE.paper, 1.6); b.ellipse(35, -73 + m.breath, 3, 5, INK, 0);
  if (m.breached) {
    const spread = m.windup ? 9 : m.impact ? 12 : 5;
    b.polygon([[25, -69], [42, -88 - spread], [71, -78], [77, -51], [59, -29 + spread], [33, -35], [19, -49]], muzzle, 3.4);
    b.polygon([[31, -64], [46, -79 - spread], [67, -72], [69, -51], [55, -36 + spread], [35, -41], [27, -51]], INK, 2);
    for (let i = 0; i < 4; i++) {
      b.polygon([[37 + i * 8, -72 - spread * 0.4], [44 + i * 7, -74 - spread * 0.4], [42 + i * 7, -58]], PALETTE.paper, 0.8);
      b.polygon([[37 + i * 7, -42], [44 + i * 7, -42], [41 + i * 7, -52]], PALETTE.paper, 0.8);
    }
  } else {
    b.ellipse(48, -57 + m.breath + m.beat, 43, 29, muzzle, 2.7);
    b.ellipse(66, -61 + m.breath, 14, 12, INK, 1);
    b.line(34, -48 + m.breath, 62, -47 + m.breath + m.beat * 2, 2);
    if (m.working) b.polygon([[48, -45], [57, -45], [54, -33], [48, -34]], PALETTE.rust, 1.2);
  }
  b.polygon([[8, -48], [28, -36], [31, -27], [8, -40]], PALETTE.rust, 1.7);
  b.ellipse(25, -26, 9, 12, PALETTE.gold, 1.5); b.line(-20, -51, -27, -43, 1.1, shade);
}

function chicken(b: Brush, m: Motion): void {
  const shell = 0xd7d0af, shade = 0xa6aa94, red = PALETTE.rust;
  const shift = m.breached ? m.glitch * 3 : m.beat * 2;
  if (m.breached) for (const side of [-1, 1]) {
    b.ellipse(side * (11 + Math.abs(m.glitch) * 4), -48, 53, 70, PALETTE.paper, 2, 0.17);
    b.line(side * 35, -68, side * 47, -61, 2, red, 0.6); b.line(side * 40, -48, side * 52, -44, 1.6, red, 0.5);
  }
  for (const side of [-1, 1]) {
    b.line(side * 12, -22, side * 14 + m.walk * side * 5, -4, 4, PALETTE.gold);
    b.line(side * 14 - 6 + m.walk * side * 5, -2, side * 14 + 9 + m.walk * side * 5, -2, 2);
  }
  b.polygon([[-20, -23], [-41, -45], [-29, -45], [-38, -61], [-18, -53]], shade, 2.4);
  b.polygon([[-21, -15], [-30, -39], [-23, -62], [-7, -73], [14, -65], [27, -42], [23, -17], [3, -10]], shell);
  b.ellipse(6 + shift, -75 + m.breath, 32, m.breached ? 43 : 35, shell, 2.6);
  b.polygon([[-9 + shift, -88], [-12 + shift, -103], [-3 + shift, -98], [1 + shift, -109], [8 + shift, -99], [17 + shift, -104], [17 + shift, -89]], red, 2.1);
  b.polygon([[18 + shift, -77], [m.breached ? 44 : 34, -70], [18 + shift, -62]], PALETTE.gold, 2);
  if (m.breached) b.polygon([[22 + shift, -72], [39, -70], [25 + shift, -61]], INK, 1.2);
  b.ellipse(11 + shift, -81 + m.breath, 8, m.breached ? 12 : 8, INK, 1);
  b.polygon([[14 + shift, -62], [21 + shift, -58], [18 + shift, -47], [12 + shift, -52]], red, 1.7);
  const wing = m.windup || m.breached ? -61 : m.working ? -48 + m.beat * 5 : -33;
  b.polygon([[-12, -54], [-28, wing - 8], [-34, wing + 4], [-24, wing + 11], [-13, -35]], shade, 2.4);
  b.ellipse(3, -33, m.breached ? 39 : 31, m.breached ? 41 : 32, PALETTE.paperShade, 2.8);
  b.ellipse(3, -33, 25, 25, PALETTE.paper, 1.2);
  for (const [dx, dy] of [[0, -9], [9, 0], [0, 9], [-9, 0]]) b.line(3 + dx * 0.7, -33 + dy * 0.7, 3 + dx, -33 + dy, 1);
  const angle = m.working || m.breached ? Math.floor(m.time * (m.breached ? 4 : 1)) * Math.PI / 6 : -Math.PI / 2;
  b.line(3, -33, 3 + Math.cos(angle) * 9, -33 + Math.sin(angle) * 9, 1.7); b.line(3, -33, 9, -29, 2);
  if (m.breached) b.line(-23, -50 + Math.floor(m.time * 5) % 4 * 8, 29, -48 + Math.floor(m.time * 5) % 4 * 8, 1.5, PALETTE.paper, 0.7);
}

function penguin(b: Brush, m: Motion): void {
  const dark = 0x394950, pale = 0xd9d8c4, scarf = 0x7faaa9;
  const shift = m.breached ? m.glitch * 3 : m.beat;
  const bodyY = -41 + m.breath, bodyHeight = m.breached ? 81 + m.glitch * 6 : 72;
  if (m.breached) {
    b.ellipse(-10 - m.glitch * 3, bodyY - 3, 54, 77, PALETTE.pale, 2, 0.22);
    b.ellipse(10 + m.glitch * 3, bodyY + 2, 52, 73, PALETTE.steel, 2, 0.24);
    b.line(-38, -73, -23, -75, 2, PALETTE.pale, 0.65); b.line(21, -18, 39, -20, 2, PALETTE.pale, 0.6);
  }
  b.ellipse(-13 + m.walk * 5, -4, 27, 11, PALETTE.paperShade, 2); b.ellipse(15 - m.walk * 5, -4, 28, 11, PALETTE.gold, 2);
  b.ellipse(shift, bodyY, 56, bodyHeight, dark, 3);
  b.polygon([[-12 + shift, -69], [7 + shift, -72], [20 + shift, -52], [19 + shift, -20], [6 + shift, -9], [-13 + shift, -17], [-17 + shift, -42]], pale, 1.8);
  b.ellipse(2 + shift, -77 + m.breath, 43, 36, dark, 2.7);
  b.polygon([[-7 + shift, -86], [4 + shift, -91], [18 + shift, -82], [21 + shift, -68], [6 + shift, -60], [-8 + shift, -69]], pale, 1.5);
  b.ellipse(2 + shift, -79 + m.breath, m.breached ? 8 : 5, m.breached ? 11 : 8, INK, 0.8);
  b.ellipse(14 + shift, -77 + m.breath, m.breached ? 6 : 4, m.breached ? 9 : 6, INK, 0.8);
  b.polygon([[12 + shift, -70], [31 + shift, -66 + m.beat * 2], [15 + shift, -60]], PALETTE.paperShade, 1.8);
  const flap = m.windup ? 13 : m.working ? 12 + m.beat * 6 : m.breached ? m.glitch * 6 : 0;
  for (const side of [-1, 1]) b.polygon([[side * 20, -57], [side * (33 + flap * 0.3), -43 - flap], [side * 31, -20 - flap], [side * 22, -25], [side * 15, -44]], dark, 2.4);
  b.polygon([[-19, -63], [19, -61], [22, -52], [-17, -54]], scarf, 2);
  b.polygon([[-4, -56], [-12, -32], [-4, -35], [2, -31], [6, -54]], scarf, 1.8);
  if (m.breached) {
    const scanY = -73 + Math.floor(m.time * 6) % 4 * 15;
    b.line(-25, scanY, 24, scanY + 2, 1.5, PALETTE.pale, 0.8);
  }
}
