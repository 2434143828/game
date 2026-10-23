import Phaser from 'phaser';
import type { AnomalyId, Rect } from '../../../contracts/data-contract';
import { anomalyById } from '../../data/config';
import { MAP_DEFINITION, MAP_NODES, ROOM_COLORS, ROOM_RECTS, creatureFeet, roomWorkFeet } from './geometry';
import { PALETTE, inkBox, inkEllipse, inkLine, inkPolygon, hatch } from '../../art/ink';
import { EnvironmentArt, type EnvironmentTextureName } from '../../art/generated/EnvironmentArt';

type Sign = (text: string, x: number, y: number, size?: number, color?: string) => void;
type Graphics = Phaser.GameObjects.Graphics;
const INK = PALETTE.ink;
const C = { void: PALETTE.void, distant: PALETTE.distant, cream: 0xbdb39b, steel: 0x697775, amber: 0xcbb676, brass: 0xa89a70 };
function box(g: Graphics, x: number, y: number, w: number, h: number, color: number, stroke = 3, strokeColor = INK): void {
  inkBox(g, x, y, w, h, color, stroke, x * 0.03 + y * 0.01);
  if (stroke && strokeColor !== INK) g.lineStyle(stroke, strokeColor).strokeRect(x, y, w, h);
}
function pipe(g: Graphics, x1: number, y1: number, x2: number, y2: number, width: number, color = C.steel): void {
  inkLine(g, x1, y1, x2, y2, width + 5, INK, 5);
  inkLine(g, x1, y1, x2, y2, width, color, 5);
  inkLine(g, x1 - 2, y1 - 2, x2 - 2, y2 - 2, 1.5, C.cream, 5, 0.34);
}
function lamp(g: Graphics, x: number, y: number, width: number, drop = 150, color = C.amber): void {
  inkPolygon(g, [{ x: x + 7, y }, { x: x + width - 9, y: y - 1 }, { x: x + width, y: y + 15 }, { x, y: y + 15 }], 0x55574e, 3, 2);
  box(g, x + 8, y + 9, width - 16, 5, color, 0);
  g.fillStyle(color, 0.035).fillTriangle(x + width / 2, y + 15, x - 28, y + drop, x + width + 28, y + drop);
}
function floor(g: Graphics, x: number, y: number, width: number, accent = C.brass): void {
  // The bearing surface stays exactly on the authored path; only its ink border varies.
  g.fillStyle(0x96988a).fillRect(x, y - 12, width, 15);
  inkLine(g, x, y - 12, x + width, y - 12, 3.5);
  box(g, x - 3, y + 3, width + 6, 23, INK, 0); box(g, x, y + 27, width, 8, 0x3c4142, 0);
  inkLine(g, x + 2, y - 10, x + width - 2, y - 10, 2, accent);
  for (let xx = x + 12; xx < x + width; xx += 54) inkLine(g, xx, y - 8, xx + 8, y, 1.5, 0x626b66, 2);
}
function shell(g: Graphics, r: Rect, accent: number, wall = 0xa5a493, lower = 0x848b7f, cut = 0): void {
  box(g, r.x + 18, r.y + 21, r.width + 8, r.height + 18, 0x111319, 0);
  const poly = [
    { x: r.x - 12, y: r.y + cut }, { x: r.x + cut, y: r.y - 12 },
    { x: r.x + r.width - cut, y: r.y - 12 }, { x: r.x + r.width + 12, y: r.y + cut },
    { x: r.x + r.width + 12, y: r.y + r.height + 12 }, { x: r.x - 12, y: r.y + r.height + 12 },
  ];
  inkPolygon(g, poly, 0x4d5251, 6, r.x / 10);
  box(g, r.x, r.y + 30, r.width, r.height - 30, C.cream, 4);
  box(g, r.x + 7, r.y + 30, r.width - 14, 10, accent, 0);
  box(g, r.x + 12, r.y + 41, r.width - 24, r.height - 54, wall, 0);
  box(g, r.x + 13, r.y + r.height - 64, r.width - 26, 52, lower, 0);
  for (let x = r.x + 24; x < r.x + r.width - 18; x += 185) {
    inkLine(g, x, r.y + 45, x + 1, r.y + r.height - 17, 1.3, lower, x);
    inkLine(g, x - 3, r.y + 54, x + 3, r.y + 51, 1.5, 0x6b7268, 4);
  }
  hatch(g, r.x + 16, r.y + r.height - 62, Math.min(82, r.width / 4), 39, 0x505a53, 13, 0.3);
  hatch(g, r.x + r.width - 72, r.y + 44, 49, 31, 0x505a53, 12, 0.27);
  pipe(g, r.x + 18, r.y + 49, r.x + r.width - 18, r.y + 49, 6, 0x827f6d);
  floor(g, r.x - 6, r.y + r.height, r.width + 12, accent);
}
function glass(g: Graphics, x: number, y: number, w: number, h: number, tint = 0x95a09a): void {
  box(g, x, y, w, h, 0x424d4d, 4); box(g, x + 7, y + 7, w - 14, h - 14, tint, 0);
  inkLine(g, x + 13, y + h - 12, x + w - 13, y + h - 13, 2, 0x65766f, 5, 0.8);
  inkLine(g, x + w * 0.22, y + 11, x + 12, y + h * 0.64, 2, C.cream, 7, 0.4);
  inkLine(g, x + w * 0.27, y + 12, x + w * 0.13, y + h * 0.42, 1, C.cream, 9, 0.35);
  if (w > 230) box(g, x + w * 0.52, y + 4, 6, h - 8, 0x626f68, 2);
}
function consoleDesk(g: Graphics, x: number, floorY: number, width: number, color = 0x7e9886): void {
  box(g, x + 8, floorY - 36, width - 16, 33, 0x5d625b, 3);
  const pts = [{ x, y: floorY - 60 }, { x: x + width, y: floorY - 60 }, { x: x + width - 8, y: floorY - 35 }, { x: x - 7, y: floorY - 35 }];
  inkPolygon(g, pts, 0xa6a18b, 3, 7);
  box(g, x + 8, floorY - 54, width * 0.5, 12, 0x34413c, 2); box(g, x + 11, floorY - 52, width * 0.38, 5, color, 0);
  for (let i = 0; i < 3; i++) inkEllipse(g, x + width - 15 - i * 9, floorY - 47, 4, 4, i === 0 ? C.amber : 0x788d79, 0, i);
  hatch(g, x + 14, floorY - 30, Math.min(37, width - 29), 22, INK, 8, 0.4);
  inkLine(g, x + width - 20, floorY - 27, x + width - 20, floorY - 9, 1.5, 0x939485, 6);
}
function bench(g: Graphics, x: number, floorY: number, width: number, color = 0x788071): void {
  box(g, x, floorY - 48, width, 27, color, 3); box(g, x - 3, floorY - 21, width + 6, 12, 0xa7a58e, 3);
  box(g, x + 12, floorY - 9, 6, 9, INK, 0); box(g, x + width - 18, floorY - 9, 6, 9, INK, 0);
  for (let xx = x + 35; xx < x + width - 20; xx += 48) inkLine(g, xx, floorY - 45, xx + 1, floorY - 24, 1.6, INK, 3);
}
function wallMonitor(g: Graphics, x: number, y: number, width: number, height: number, tint: number): void {
  const inset = width > 150 ? 16 : 10;
  inkPolygon(g, [{ x: x + 3, y }, { x: x + width - 5, y: y + 1 }, { x: x + width, y: y + height - 2 }, { x: x - 2, y: y + height }], 0x555c53, 4, 3);
  box(g, x + inset, y + 8, width - inset - 17, height - 18, 0x34453f, 2);
  const left = x + inset + 7, right = x + width - 25;
  for (let row = 0; row < 3; row++) {
    const yy = y + 18 + row * Math.max(7, (height - 32) / 3);
    inkLine(g, left, yy, Math.min(right, left + (right - left) * [0.72, 0.92, 0.48][row]), yy + (row % 2 ? 1 : 0), 2, tint, row, 0.65);
  }
  inkEllipse(g, x + width - 10, y + height - 18, 6, 6, C.amber, 1, 3);
  inkLine(g, x + width - 10, y + 13, x + width - 10, y + 21, 2, INK, 4);
  hatch(g, x + 4, y + height - 13, 24, 8, INK, 6, 0.45);
}
function sealDoor(g: Graphics, x: number, floorY: number, accent: number, side = 1): void {
  box(g, x - 15, floorY - 133, 30, 133, 0x555c58, 4);
  box(g, x - 10, floorY - 127, 20, 116, 0x2e3435, 1);
  box(g, x - 19, floorY - 137, 38, 12, accent, 3);
  inkLine(g, x + side * 13, floorY - 126, x + side * 13, floorY - 12, 3.5, accent, 8);
  box(g, x - 7, floorY - 114, 14, 24, 0x879489, 2);
  inkLine(g, x - 3, floorY - 109, x + 3, floorY - 104, 1, C.cream, 2);
  for (let y = floorY - 76; y < floorY - 10; y += 27) g.fillStyle(0xb8ac88).fillTriangle(x - 7, y, x + 7, y + 7, x - 7, y + 13);
}
export function drawLadder(g: Graphics, x: number, top: number, bottom: number, width = 122): void {
  box(g, x - width / 2 - 12, top - 11, width + 24, bottom - top + 23, 0x15191e, 5);
  box(g, x - width / 2, top, width, bottom - top, 0x3e4848, 0);
  for (let y = top + 8; y < bottom; y += 14) {
    inkLine(g, x - width / 2 + 8, y + 2, x + width / 2 - 8, y + 2, 5, INK, y);
    inkLine(g, x - width / 2 + 8, y, x + width / 2 - 8, y, 3, 0x9e9d87, y);
  }
  for (const dx of [-width / 2, -24, 24, width / 2]) inkLine(g, x + dx, top, x + dx, bottom, 4, 0xb5ab81, dx);
  for (let y = top + 40; y < bottom - 20; y += 110) {
    box(g, x - width / 2 - 10, y, 9, 37, 0x6c7a80, 2); box(g, x + width / 2 + 1, y, 9, 37, 0x6c7a80, 2);
  }
}
function drawVoid(g: Graphics, sign: Sign): void {
  const b = MAP_DEFINITION.bounds; box(g, b.x, b.y, b.width, b.height, C.void, 0);
  // A sparse, deep framework surrounds the lit departments, rather than one flat building card.
  for (const [x, w] of [[96, 56], [1180, 78], [2250, 64], [3320, 90]]) {
    box(g, x, 65, w, 2310, C.distant, 0); box(g, x + 9, 65, 8, 2310, 0x303435, 0);
    for (let y = 100; y < 2350; y += 230) {
      inkLine(g, x, y, x + w, y + 145, 6, 0x303637, 3);
      inkLine(g, x + w, y, x, y + 145, 5, 0x2d3234, 6);
      box(g, x - 10, y + 170, w + 20, 18, 0x2e3335, 0);
    }
  }
  for (const y of [145, 960, 1730, 2375]) { box(g, 90, y, 3350, 22, 0x242b2e, 0); inkLine(g, 100, y + 2, 3430, y + 2, 3, 0x343a3a, y); }
  pipe(g, 200, 520, 200, 2330, 27, 0x3e4949); pipe(g, 3300, 240, 3300, 2220, 32, 0x3e4949);
  pipe(g, 350, 915, 3240, 915, 19, 0x3d4347); pipe(g, 660, 1790, 1990, 1790, 17, 0x364346);
  for (const [x, y] of [[3300, 780], [200, 1630], [930, 1790], [3120, 915]]) {
    inkEllipse(g, x, y, 50, 47, 0x3d4745, 3, 6);
    inkLine(g, x - 21, y, x + 21, y, 3, 0x646b5e, 2);
    inkLine(g, x, y - 21, x, y + 21, 3, 0x646b5e, 2);
  }
  sign('CONTAINMENT COMPLEX', 1630, 130, 44, '#343c48');
  sign('收  容  设  施  /  区 域 07', 1740, 188, 20, '#424953');
  sign('上层观察区', 260, 140, 22, '#747567'); sign('下层低温区', 1300, 2320, 22, '#4c626e');
}
function drawCorridors(g: Graphics): void {
  for (const edge of MAP_DEFINITION.edges) {
    const a = MAP_NODES[edge.from]; const b = MAP_NODES[edge.to]; if (a.y !== b.y) continue;
    const x = Math.min(a.x, b.x); const w = Math.abs(a.x - b.x); const y = a.y;
    if (edge.kind === 'CORRIDOR') {
      box(g, x - 64, y - 118, w + 128, 119, 0x535f5e, 5); box(g, x - 58, y - 108, w + 116, 93, 0x8b9489, 0);
      box(g, x - 58, y - 38, w + 116, 23, 0x707d73, 0);
      for (let xx = x - 35; xx < x + w + 40; xx += 190) {
        box(g, xx, y - 100, 86, 52, 0xa3a797, 2);
        inkLine(g, xx + 10, y - 87, xx + 73, y - 88, 1.5, 0x768477, 5);
        hatch(g, xx + 6, y - 65, 28, 12, 0x667364, 8, 0.33);
      }
      if (w > 180) lamp(g, x + w / 2 - 38, y - 117, 76, 100);
      floor(g, x - 65, y, w + 130);
    } else {
      box(g, x - 11, y - 108, w + 22, 109, 0x737d74, 4); box(g, x - 6, y - 101, w + 12, 87, 0xa0a594, 0);
      floor(g, x - 12, y, w + 24);
    }
  }
}
function drawHall(g: Graphics, hall: (typeof MAP_DEFINITION.halls)[number], sign: Sign): void {
  const r = hall.rect; const fy = r.y + r.height;
  const palettes: Record<string, [number, number, number, number]> = {
    control: [0xa3a38c, 0x737b66, 44, 0x7f8c6b], operations: [0x949d9d, 0x627377, 16, 0x7c9295],
    broadcast: [0xb09a86, 0x836d5d, 38, 0xa17d66], records: [0x9f9b9b, 0x746f76, 65, 0x8b8294], cold: [0x91a3a0, 0x617f7e, 28, 0x779c9b],
  };
  const palette = palettes[hall.id]; shell(g, r, palette[3], palette[0], palette[1], palette[2]);
  sign(hall.name, r.x + 27, r.y + 74, 27, '#303b37');
  sign(hall.subtitle, r.x + 29, r.y + 112, 14, '#505f56');
  if (hall.id === 'control') {
    // Olive control room, raised roof frames and central surveillance wall.
    inkLine(g, 1470, r.y + 43, 1520, r.y + 89, 10, 0x586655, 1);
    inkLine(g, 1520, r.y + 89, 1950, r.y + 89, 10, 0x586655, 2);
    inkLine(g, 1950, r.y + 89, 2000, r.y + 43, 10, 0x586655, 3);
    wallMonitor(g, 1580, r.y + 100, 244, 78, 0xb1bd94); consoleDesk(g, 1598, fy, 210, 0x8ca27d);
    glass(g, 2070, r.y + 91, 170, 89, 0x7f9182); consoleDesk(g, 2110, fy, 108, 0xaba573);
    bench(g, 1150, fy, 124, 0x77836b); lamp(g, 1654, r.y + 47, 142, 190, 0xcbbd89);
    inkEllipse(g, 1941, r.y + 137, 86, 89, 0x67775f, 4, 2);
    inkEllipse(g, 1941, r.y + 137, 65, 67, 0xadb094, 2, 5);
    inkLine(g, 1941, r.y + 137, 1963, r.y + 121, 3, INK, 3);
    hatch(g, 1909, r.y + 141, 58, 26, 0x626d57, 11, 0.55);
    sign('主管监控终端', 1598, r.y + 80, 14, '#4d6356');
  } else if (hall.id === 'operations') {
    // Long blue transfer hall, panoramic glazing and deep buttresses.
    glass(g, 1490, r.y + 64, 590, 91, 0x829897);
    for (const x of [1483, 1745, 2074]) {
      inkPolygon(g, [{ x, y: r.y + 42 }, { x: x + 28, y: r.y + 42 }, { x: x + 17, y: fy - 16 }, { x: x - 5, y: fy - 16 }], 0x677e7c, 2, 6);
    }
    wallMonitor(g, 2155, r.y + 66, 132, 76, 0xa2b7a6); consoleDesk(g, 2168, fy, 115);
    bench(g, 1575, fy, 175, 0x647f81); lamp(g, 1850, r.y + 44, 132, 170, 0xb4c6ba);
    box(g, 2398, fy - 129, 75, 112, 0x6f8079, 4);
    for (let y = fy - 117; y < fy - 27; y += 22) inkLine(g, 2410, y, 2460, y + 1, 2, 0xa4b2a6, y);
  } else if (hall.id === 'broadcast') {
    // Old speaker horns and a switchboard identify the security/broadcast gallery.
    for (const x of [1470, 1780, 2105]) {
      inkLine(g, x, r.y + 43, x + 42, r.y + 81, 8, 0x725d50, 2);
      inkLine(g, x + 42, r.y + 81, x + 220, r.y + 81, 8, 0x725d50, 2);
    }
    for (const x of [1510, 1685, 2078]) {
      box(g, x, fy - 110, 120, 94, 0x7e7466, 3);
      for (let i = 0; i < 3; i++) {
        box(g, x + 8 + i * 35, fy - 102, 31, 78, 0xa6967c, 2);
        box(g, x + 27 + i * 35, fy - 69, 3, 13, INK, 0);
        inkLine(g, x + 15 + i * 35, fy - 92, x + 31 + i * 35, fy - 91, 2, 0x736e5b, i);
      }
    }
    inkPolygon(g, [{ x: 1902, y: fy - 110 }, { x: 1925, y: fy - 103 }, { x: 1960, y: fy - 129 }, { x: 1964, y: fy - 66 }, { x: 1923, y: fy - 86 }, { x: 1900, y: fy - 91 }], 0x918371, 3, 6);
    inkEllipse(g, 1962, fy - 98, 19, 63, 0x504d48, 3, 4);
    inkLine(g, 1918, fy - 91, 1916, fy - 45, 4, INK, 2);
    box(g, 1885, fy - 44, 65, 21, 0xb5a283, 3);
    lamp(g, 1848, r.y + 45, 130, 160, 0xcbb181);
  } else if (hall.id === 'records') {
    // Dusty grey-lilac archive: imperfect round windows, drawers and paper labels.
    for (const x of [2150, 2440, 2730]) {
      inkEllipse(g, x + 80, r.y + 75, 82, 79, 0x686773, 4, 5);
      inkEllipse(g, x + 80, r.y + 75, 58, 56, 0xaaa99f, 2, 7);
      inkLine(g, x + 80, r.y + 46, x + 79, r.y + 104, 3, 0x747478, 2);
    }
    for (const x of [2070, 2240, 2420, 2600, 2780]) {
      if (Math.abs(x + 65 - MAP_NODES['b-gallery'].x) < 100) continue;
      box(g, x, fy - 97, 130, 80, 0x666570, 4);
      for (let row = 0; row < 2; row++) {
        box(g, x + 8, fy - 89 + row * 32, 114, 27, 0x979294, 2);
        box(g, x + 49, fy - 81 + row * 32, 32, 7, 0xc5b89a, 1);
        inkLine(g, x + 59, fy - 67 + row * 32, x + 74, fy - 68 + row * 32, 2, INK, row);
      }
      inkPolygon(g, [{ x: x + 13, y: fy - 111 }, { x: x + 49, y: fy - 115 }, { x: x + 52, y: fy - 98 }, { x: x + 13, y: fy - 99 }], 0xb7aa8d, 2, 4);
      inkLine(g, x + 19, fy - 106, x + 43, fy - 107, 1, 0x776f60, 2);
    }
    lamp(g, 2505, r.y + 45, 120, 170, 0xbdb2a5);
  } else {
    // Teal lower plant with two large circular cooling units and overhead ducts.
    for (const x of [810, 1130]) {
      box(g, x, fy - 121, 104, 106, 0x708b87, 4);
      inkEllipse(g, x + 52, fy - 71, 70, 67, 0x536f6b, 3, 8);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        inkPolygon(g, [{ x: x + 52, y: fy - 71 }, { x: x + 52 + Math.cos(a) * 32, y: fy - 71 + Math.sin(a) * 32 }, { x: x + 52 + Math.cos(a + 0.7) * 24, y: fy - 71 + Math.sin(a + 0.7) * 24 }], 0xa4b0a0, 1.5, i);
      }
    }
    pipe(g, r.x + 18, r.y + 54, r.x + r.width - 18, r.y + 54, 19, 0x748f8c);
    lamp(g, 913, r.y + 60, 115, 180, 0xb5c8b7);
  }
}
function drawRoom(g: Graphics, id: AnomalyId, sign: Sign): void {
  const r = ROOM_RECTS[id]; const accent = ROOM_COLORS[id]; const fy = r.y + r.height;
  const work = roomWorkFeet(id); const subject = creatureFeet(id); const room = MAP_DEFINITION.rooms[id];
  const walls: Record<AnomalyId, number> = { N01: 0xaaa48a, N02: 0xa79a8b, N03: 0x929e89, N04: 0xa29c9e, N05: 0x9eafa6 };
  shell(g, r, accent, walls[id], id === 'N05' ? 0x7d938a : 0x81897a, id === 'N04' ? 54 : id === 'N03' ? 30 : 12);
  sign(`${id}   ${anomalyById[id].name}`, r.x + 25, r.y + 61, 27, '#323e39');
  sign(`CONTAINMENT ${id.slice(1)} / 概念样本`, r.x + 27, r.y + 96, 13, '#586359');
  glass(g, subject.x - (id === 'N03' ? 143 : 103), r.y + 118, id === 'N03' ? 272 : 204, Math.max(100, r.height - 148), id === 'N05' ? 0xa8b9ad : id === 'N04' ? 0xb1aca6 : 0xa8af9a);
  consoleDesk(g, work.x + 29, fy, 81, accent); wallMonitor(g, work.x - 104, r.y + 137, 78, 53, 0xadb59a);
  inkEllipse(g, subject.x, fy - 2, id === 'N03' ? 160 : 118, 17, 0x7b8978, 1.5, 9);
  if (id === 'N01') {
    for (const x of [r.x + 26, r.x + r.width - 72]) {
      box(g, x, fy - 99, 44, 81, 0x878976, 3);
      inkEllipse(g, x + 22, fy - 67, 29, 32, 0xb2a678, 2, 5);
      inkLine(g, x + 22, fy - 67, x + 29, fy - 73, 2, INK, 3);
      hatch(g, x + 10, fy - 44, 25, 17, INK, 7, 0.3);
    }
    box(g, subject.x + 56, r.y + 79, 57, 40, 0xb5a679, 3);
    inkEllipse(g, subject.x + 84, r.y + 99, 26, 25, 0xd1c19a, 2, 5);
    inkLine(g, subject.x + 84, r.y + 99, subject.x + 91, r.y + 91, 2, INK, 7);
    lamp(g, subject.x - 77, r.y + 52, 133, r.height - 60, 0xd1bc88);
  } else if (id === 'N02') {
    const x = r.x + r.width - 61; pipe(g, x, fy - 190, x, fy - 14, 13, 0x8d7f6c);
    box(g, x - 35, fy - 166, 60, 12, 0xbaaa88, 3); box(g, x - 29, fy - 106, 65, 12, 0xbaaa88, 3);
    for (let i = 0; i < 3; i++) inkLine(g, r.x + 166 + i * 10, r.y + 125, r.x + 151 + i * 10, r.y + 166, 2, 0x726b62, i);
    bench(g, r.x + 29, fy, 95, 0x8b7f73); lamp(g, subject.x - 72, r.y + 53, 128, r.height - 60, 0xc8ae94);
  } else if (id === 'N03') {
    for (let x = r.x + 28; x < r.x + r.width - 24; x += 78) {
      // Reserve a clear wall bay around the operator's monitor.
      if (x < work.x - 18 && x + 25 > work.x - 112) continue;
      box(g, x, r.y + 122, 25, 83, 0x75816f, 2);
      hatch(g, x + 4, r.y + 146, 17, 51, 0x4c5e4d, 7, 0.65);
    }
    glass(g, subject.x - 143, r.y + 118, 272, r.height - 148, 0xa4b09b);
    inkEllipse(g, subject.x + 93, fy - 16, 24, 21, 0x88967c, 3, 8);
    pipe(g, r.x + 34, r.y + 47, r.x + r.width - 29, r.y + 47, 11, 0x7d8974);
    lamp(g, subject.x - 110, r.y + 57, 190, r.height - 65, 0xbcc69f);
  } else if (id === 'N04') {
    for (const x of [r.x + 43, r.x + r.width - 99]) {
      box(g, x, r.y + 111, 66, 132, 0x77717a, 4);
      for (const yy of [r.y + 143, r.y + 204]) {
        inkEllipse(g, x + 33, yy, 48, 45, 0x414347, 3, 6);
        inkEllipse(g, x + 33, yy, 31, 34, 0x8d8890, 2, 3);
        inkEllipse(g, x + 33, yy, 13, 16, 0x52545b, 1, 2);
      }
    }
    const cx = r.x + r.width / 2; const cy = r.y + 154;
    inkLine(g, cx, r.y + 116, cx + 1, cy - 29, 4, 0x7f7967, 3);
    inkEllipse(g, cx, cy, 58, 61, 0xc7b995, 4, 7);
    inkLine(g, cx, cy, cx - 1, cy - 21, 3, INK, 2);
    inkLine(g, cx, cy, cx + 15, cy + 6, 3, INK, 5);
    lamp(g, subject.x - 80, r.y + 57, 140, r.height - 65, 0xbfb1b8);
  } else {
    for (const xx of [r.x + 12, r.x + r.width - 16]) pipe(g, xx, r.y + 47, xx, fy - 24, 16, 0x7b9692);
    pipe(g, r.x + 12, r.y + 47, r.x + r.width - 16, r.y + 47, 16, 0x7b9692);
    for (const [x, y] of [[subject.x - 66, r.y + 150], [subject.x + 59, r.y + 202]]) {
      inkLine(g, x - 11, y, x + 11, y, 2, 0xc0ccba, 5);
      inkLine(g, x, y - 11, x, y + 11, 2, 0xc0ccba, 3);
      inkLine(g, x - 8, y - 8, x + 8, y + 8, 1.5, 0xc0ccba, 2);
    }
    box(g, r.x + 34, fy - 88, 87, 66, 0x79918a, 3);
    for (let y = fy - 78; y < fy - 30; y += 15) inkLine(g, r.x + 44, y, r.x + 111, y + 1, 2, 0xb4c4ae, y);
    lamp(g, subject.x - 90, r.y + 54, 160, r.height - 60, 0xb6cbb9);
  }
  const door = MAP_NODES[room.doorNodeId]; const side = door.x > work.x ? 1 : -1;
  sealDoor(g, door.x, door.y, accent, side); sign('入口', door.x - 17, door.y - 158, 13, '#49595b');
  g.fillStyle(accent).fillTriangle(door.x - side * 26, door.y - 91, door.x - side * 46, door.y - 101, door.x - side * 46, door.y - 81);
}
function drawMedical(g: Graphics, sign: Sign): void {
  const r = MAP_DEFINITION.safeRect; const fy = r.y + r.height; shell(g, r, 0x8da181, 0xb0b6a1, 0x879a83, 25);
  sign('医疗休整区', r.x + 29, r.y + 69, 27, '#3c5443'); sign('SAFE / 抵达后恢复', r.x + 30, r.y + 105, 15, '#5a705b');
  glass(g, r.x + 249, r.y + 73, 149, 85, 0xa5b29b);
  for (const x of [r.x + 35, r.x + r.width - 145]) {
    box(g, x + 9, fy - 47, 111, 33, 0x7d9077, 3); box(g, x, fy - 63, 129, 22, 0xcfc6a9, 3);
    box(g, x + 5, fy - 70, 35, 14, 0xb5baa1, 2); box(g, x + 15, fy - 14, 6, 14, INK, 0); box(g, x + 109, fy - 14, 6, 14, INK, 0);
    hatch(g, x + 84, fy - 59, 31, 13, 0x737b65, 8, 0.32);
  }
  box(g, r.x + 196, fy - 112, 56, 92, 0x9ba98e, 3);
  box(g, r.x + 219, fy - 97, 13, 44, 0xd3cbaa, 0); box(g, r.x + 204, fy - 82, 43, 13, 0xd3cbaa, 0);
  box(g, r.x + 466, r.y + 86, 46, 61, 0xc0b69a, 2);
  box(g, r.x + 478, r.y + 80, 20, 9, 0x6b7466, 2);
  for (let row = 0; row < 3; row++) inkLine(g, r.x + 473, r.y + 104 + row * 11, r.x + 503 - row * 4, r.y + 103 + row * 11, 1.5, 0x757c69, row);
  bench(g, r.x + 302, fy, 99, 0x7f967e); sealDoor(g, MAP_NODES['safe-door'].x, fy, 0x9bad8c, -1);
  lamp(g, r.x + 270, r.y + 44, 147, 220, 0xc2c89d);
}

/** Authored-world cutaway: geometry follows map edges, without a second visual navigation graph. */
export function drawArchitecture(g: Graphics, sign: Sign, art?: EnvironmentArt): void {
  if (art?.complete) { drawGeneratedArchitecture(g, sign, art); return; }
  drawVoid(g, sign); drawCorridors(g);
  for (const hall of MAP_DEFINITION.halls) drawHall(g, hall, sign);
  for (const id of Object.keys(MAP_DEFINITION.rooms) as AnomalyId[]) drawRoom(g, id, sign);
  drawMedical(g, sign);
  // Some graph edges are high catwalks inside a taller hall. Restore their actual
  // floor after wall cladding, notably the upper-east bridge at y=640.
  for (const edge of MAP_DEFINITION.edges) {
    if (edge.kind !== 'CORRIDOR') continue;
    const a = MAP_NODES[edge.from]; const b = MAP_NODES[edge.to];
    if (a.y === b.y) floor(g, Math.min(a.x, b.x) - 65, a.y, Math.abs(a.x - b.x) + 130);
  }
  // Repaint transit cages after rooms, so no wall hides any section of a real vertical trip.
  for (const edge of MAP_DEFINITION.edges) {
    if (edge.kind !== 'TRANSIT') continue;
    const a = MAP_NODES[edge.from]; const b = MAP_NODES[edge.to];
    drawLadder(g, a.x, Math.min(a.y, b.y), Math.max(a.y, b.y), 122);
  }
  const junctions = MAP_DEFINITION.nodes.filter(node => MAP_DEFINITION.edges.some(edge => edge.kind === 'TRANSIT' && (edge.from === node.id || edge.to === node.id)));
  for (const node of junctions) {
    // The deep landing supports standing endpoint feet; narrow grating preserves vertical continuity.
    g.fillStyle(0x96988a).fillRect(node.x - 68, node.y - 9, 136, 11);
    inkLine(g, node.x - 68, node.y - 9, node.x + 68, node.y - 9, 3, INK, 3);
    inkLine(g, node.x - 68, node.y + 2, node.x + 68, node.y + 2, 3, INK, 5);
    inkLine(g, node.x - 65, node.y - 8, node.x + 65, node.y - 8, 2, C.brass, 4);
    for (let x = node.x - 57; x < node.x + 60; x += 22) inkLine(g, x, node.y - 7, x + 7, node.y + 1, 1.5, 0x58685d, x);
  }
  sign('A / 联络井', MAP_NODES['a-top'].x - 98, MAP_NODES['a-top'].y - 60, 16, '#b0b7ad');
  sign('B / 联络井', MAP_NODES['b-top'].x - 100, MAP_NODES['b-top'].y - 57, 16, '#b0b7ad');
  sign('C / 下行通道', MAP_NODES['c-landing'].x - 110, MAP_NODES['c-landing'].y - 45, 16, '#9bafb1');
  sign('01  上层观察', 1002, 362, 17, '#a4b5ad'); sign('← N01', 1482, 811, 13, '#536e6b');
  sign('N02 →', 2110, 813, 13, '#536e6b'); sign('← N03   /   下行 N05', 1095, 1320, 14, '#e0d6bd'); sign('N04 →', 2392, 1555, 14, '#e6d6bd');
  for (const id of Object.keys(ROOM_RECTS) as AnomalyId[]) {
    const r = ROOM_RECTS[id]; const y = r.y + r.height + 37;
    for (const x of [r.x + 35, r.x + r.width - 90]) {
      inkPolygon(g, [{ x, y }, { x: x + 67, y }, { x: x + 67, y: y + 58 }], 0x343d3d, 0, 2);
      inkLine(g, x, y, x + 67, y + 58, 3, 0x515d56, 7);
    }
  }
}

/** Modular generated assets, placed on the existing map without changing a single route node. */
function drawGeneratedArchitecture(g: Graphics, sign: Sign, art: EnvironmentArt): void {
  const d = (name: EnvironmentTextureName, x: number, y: number, w: number, h: number, alpha = 1) => art.draw(name, x, y, w, h, { alpha });
  const floorImage = (x: number, y: number, w: number): void => {
    d('floor_bearing_strip_a_middle', x, y - 12, w, 47);
    d('floor_bearing_strip_a_cap_left', x - 6, y - 12, 22, 47);
    d('floor_bearing_strip_a_cap_right', x + w - 16, y - 12, 22, 47);
  };
  const pipeImage = (x1: number, y1: number, x2: number, y2: number, w = 10, alpha = 1): void => {
    if (y1 === y2) d('industrial_pipe_connectors_a_pipe_horizontal', Math.min(x1, x2), y1 - w / 2, Math.abs(x2 - x1), w, alpha);
    else d('industrial_pipe_connectors_a_pipe_vertical', x1 - w / 2, Math.min(y1, y2), w, Math.abs(y2 - y1), alpha);
  };
  const lampImage = (x: number, y: number, w: number): void => {
    d('industrial_lamp_layers_a_housing', x, y, w, 17);
    d('industrial_lamp_layers_a_light_strip', x + 9, y + 10, w - 18, 5, 0.85);
  };
  const glassImage = (x: number, y: number, w: number, h: number): void => {
    d('observation_window_layers_a_glass', x + 7, y + 7, w - 14, h - 14, 0.75);
    d('observation_window_layers_a_reflection', x + 8, y + 8, w - 16, h - 16, 0.34);
    d('observation_window_layers_a_frame', x, y, w, h);
  };
  const monitorImage = (x: number, y: number, w: number, h: number): void => {
    d('crt_wall_terminal_layers_a_blank_screen', x + w * 0.04, y + h * 0.04, w * 0.92, h * 0.92);
    d('crt_wall_terminal_layers_a_housing', x, y, w, h);
  };
  const deskImage = (x: number, y: number, w: number): void => { d('operator_console_desk_a_console', x - 7, y - 60, w + 7, 60); };
  const benchImage = (x: number, y: number, w: number): void => { d('facility_waiting_bench_a_bench', x - 3, y - 48, w + 6, 48); };
  const gauge = (x: number, y: number, diameter: number): void => {
    d('analog_wall_gauge_a_dial', x - diameter / 2, y - diameter / 2, diameter, diameter);
    d('analog_wall_gauge_a_needle', x - diameter * 0.28, y + diameter * 0.18, diameter * 0.56, diameter * 0.08);
  };
  const doorImage = (id: string, x: number, y: number): void => {
    art.registerDoor(id, d('containment_door_leaf_a_leaf', x - 10, y - 127, 20, 127));
    d('containment_side_door_frame_a_frame', x - 19, y - 137, 38, 137);
    d('nm_v2_env_access_reader_reader', x + 23, y - 90, 12, 30);
    d('nm_v2_env_access_reader_indicator', x + 23, y - 124, 10, 26);
  };
  type WallColor = 'taupe' | 'moss' | 'slate' | 'mauve';
  const shellImage = (r: Rect, color: WallColor, openSide: 'left' | 'right' | 'both' = 'both'): void => {
    d(`room_wall_panel_muted_a_upper_${color}`, r.x, r.y + 5, r.width, r.height - 5);
    d(`room_wall_panel_muted_a_lower_${color}`, r.x + 8, r.y + r.height - 64, r.width - 16, 52);
    const corner = 56;
    d('room_shell_edges_a_corner_top_left', r.x - 12, r.y - 12, corner, corner);
    d('room_shell_edges_a_corner_top_right', r.x + r.width - corner + 12, r.y - 12, corner, corner);
    d('room_shell_edges_a_beam_top', r.x + corner - 14, r.y - 12, r.width - corner * 2 + 28, 17);
    d('room_shell_edges_a_wall_left', r.x - 12, r.y + corner - 14, 17, r.height - corner + 14 - (openSide !== 'right' ? 137 : 0));
    d('room_shell_edges_a_wall_right', r.x + r.width - 5, r.y + corner - 14, 17, r.height - corner + 14 - (openSide !== 'left' ? 137 : 0));
    // Lower trim stays below feet and never bridges a side-door opening.
    d('room_shell_edges_a_corner_bottom_left', r.x - 12, r.y + r.height + 6, 35, 35);
    d('room_shell_edges_a_corner_bottom_right', r.x + r.width - 23, r.y + r.height + 6, 35, 35);
    d('room_shell_edges_a_beam_bottom', r.x + 17, r.y + r.height + 28, r.width - 34, 14);
    pipeImage(r.x + 18, r.y + 47, r.x + r.width - 18, r.y + 47, 6);
    floorImage(r.x - 6, r.y + r.height, r.width + 12);
  };
  const b = MAP_DEFINITION.bounds;
  d('facility_void_backdrop_a_void_tile', b.x, b.y, b.width, b.height, 0.23);
  for (const x of [96, 1180, 2250, 3320]) d('facility_distant_framework_a_column_crossbeam', x, 65, 90, 2310, 0.26);
  for (const y of [145, 960, 1730, 2375]) pipeImage(90, y, 3440, y, 16, 0.24);
  pipeImage(200, 520, 200, 2330, 27, 0.24); pipeImage(3300, 240, 3300, 2220, 32, 0.24);
  for (const [x, y] of [[3300, 780], [200, 1630], [930, 1790], [3120, 915]]) d('industrial_pipe_connectors_a_handwheel_valve', x - 25, y - 25, 50, 50, 0.45);
  sign('CONTAINMENT COMPLEX', 1630, 130, 44, '#343c48');
  sign('收  容  设  施  /  区 域 07', 1740, 188, 20, '#424953');
  sign('上层观察区', 260, 140, 22, '#747567'); sign('下层安抚区', 1300, 2320, 22, '#4c626e');

  for (const edge of MAP_DEFINITION.edges) {
    const a = MAP_NODES[edge.from], end = MAP_NODES[edge.to];
    if (a.y !== end.y) continue;
    const x = Math.min(a.x, end.x), w = Math.abs(a.x - end.x), y = a.y;
    const margin = edge.kind === 'CORRIDOR' ? 64 : 11;
    d('corridor_wall_segment_a_middle', x - margin, y - 118, w + margin * 2, 119);
    d('corridor_wall_segment_a_edge_left', x - margin - 3, y - 118, 14, 119);
    d('corridor_wall_segment_a_edge_right', x + w + margin - 11, y - 118, 14, 119);
    if (w > 180) lampImage(x + w / 2 - 38, y - 117, 76);
    floorImage(x - margin, y, w + margin * 2);
  }
  for (const hall of MAP_DEFINITION.halls) {
    const r = hall.rect, fy = r.y + r.height;
    const colors: Record<string, WallColor> = { control: 'moss', operations: 'slate', broadcast: 'taupe', records: 'mauve', cold: 'slate' };
    shellImage(r, colors[hall.id]);
    sign(hall.name, r.x + 27, r.y + 74, 27, '#273849');
    sign(hall.subtitle, r.x + 29, r.y + 112, 14, '#506176');
    if (hall.id === 'control') {
      d('operations_buttress_a_top_beam', 1470, r.y + 45, 530, 28);
      monitorImage(1580, r.y + 100, 244, 78); deskImage(1598, fy, 210);
      glassImage(2070, r.y + 91, 170, 89); deskImage(2110, fy, 108);
      benchImage(1150, fy, 124); lampImage(1654, r.y + 47, 142); gauge(1941, r.y + 137, 86);
      sign('主管监控终端', 1598, r.y + 80, 14, '#273849');
    } else if (hall.id === 'operations') {
      glassImage(1490, r.y + 64, 590, 91);
      for (const x of [1483, 1745, 2074]) d('operations_buttress_a_buttress', x - 5, r.y + 42, 33, r.height - 58);
      monitorImage(2155, r.y + 66, 132, 76); deskImage(2168, fy, 115);
      d('nm_v2_env_maintenance_station_cabinet', r.x + 65, fy - 110, 42, 110);
      d('nm_v2_env_maintenance_station_tool_dock', r.x + 122, r.y + 120, 45, 60);
      benchImage(1575, fy, 175); lampImage(1850, r.y + 44, 132);
      d('gugu_gaga_cold_vent_a_vent_box', 2398, fy - 129, 75, 112);
    } else if (hall.id === 'broadcast') {
      for (const x of [1470, 1780, 2105]) d('operations_buttress_a_top_beam', x, r.y + 43, 262, 38);
      for (const x of [1510, 1685, 2078]) d('security_broadcast_horn_a_horn', x, fy - 126, 34, 126);
      monitorImage(1850, r.y + 89, 132, 69); deskImage(1857, fy, 115); lampImage(1851, r.y + 46, 137);
    } else if (hall.id === 'records') {
      for (let x = r.x + 47; x < r.x + r.width - 90; x += 158) {
        if (Math.abs(x + 65 - MAP_NODES['b-gallery'].x) < 100) continue;
        d('archive_drawer_cabinet_a_cabinet', x, fy - 97, 130, 80);
        d('archive_drawer_cabinet_a_folder', x + 13, fy - 115, 40, 17);
        for (const yy of [fy - 81, fy - 49]) d('archive_drawer_cabinet_a_blank_label', x + 49, yy, 32, 7);
      }
      lampImage(2505, r.y + 45, 120);
    } else {
      for (const x of [810, 1130]) {
        d('cooling_relay_fan_a_housing', x, fy - 121, 104, 106);
        d('cooling_relay_fan_a_rotor', x + 17, fy - 106, 70, 70);
      }
      pipeImage(r.x + 18, r.y + 54, r.x + r.width - 18, r.y + 54, 19);
      lampImage(913, r.y + 60, 115);
    }
  }
  const roomColors: Record<AnomalyId, WallColor> = { N01: 'taupe', N02: 'taupe', N03: 'moss', N04: 'mauve', N05: 'slate' };
  for (const id of Object.keys(MAP_DEFINITION.rooms) as AnomalyId[]) {
    const r = ROOM_RECTS[id], fy = r.y + r.height, work = roomWorkFeet(id), subject = creatureFeet(id);
    const door = MAP_NODES[MAP_DEFINITION.rooms[id].doorNodeId], side = door.x > work.x ? 1 : -1;
    shellImage(r, roomColors[id], side === 1 ? 'right' : 'left');
    sign(`${id}   ${anomalyById[id].name}`, r.x + 25, r.y + 61, 27, '#273849');
    sign(`CONTAINMENT ${id.slice(1)} / 概念样本`, r.x + 27, r.y + 96, 13, '#506176');
    glassImage(subject.x - (id === 'N03' ? 143 : 103), r.y + 118, id === 'N03' ? 272 : 204, Math.max(100, r.height - 148));
    deskImage(work.x + 29, fy, 81); monitorImage(work.x - 104, r.y + 137, 78, 53);
    if (id === 'N01') {
      for (const x of [r.x + 26, r.x + r.width - 72]) {
        d('nailong_containment_meter_cabinet_a_meter_cabinet', x, fy - 99, 44, 81); gauge(x + 22, fy - 67, 29);
      }
      gauge(subject.x + 84, r.y + 99, 26); lampImage(subject.x - 77, r.y + 52, 133);
      d('nm_v2_env_n01_soft_display_display_shelf', r.x + 95, r.y + 168, 68, 12);
      d('nm_v2_env_n01_soft_display_soft_object', r.x + 112, r.y + 140, 32, 26);
    } else if (id === 'N02') {
      d('maodie_wall_perch_a_wall_perch', r.x + r.width - 96, fy - 190, 71, 176);
      d('maodie_wall_perch_a_scratch_decal', r.x + 151, r.y + 125, 45, 41, 0.75);
      benchImage(r.x + 29, fy, 95); lampImage(subject.x - 72, r.y + 53, 128);
    } else if (id === 'N03') {
      for (let x = r.x + 28; x < r.x + r.width - 24; x += 78) {
        if (x < work.x - 18 && x + 25 > work.x - 112) continue;
        d('big_dog_acoustic_panel_a_acoustic_panel', x, r.y + 122, 25, 83);
      }
      glassImage(subject.x - 143, r.y + 118, 272, r.height - 148);
      d('big_dog_acoustic_panel_a_anchor_ring', subject.x + 81, fy - 55, 42, 50);
      pipeImage(r.x + 34, r.y + 47, r.x + r.width - 29, r.y + 47, 11); lampImage(subject.x - 110, r.y + 57, 190);
    } else if (id === 'N04') {
      for (const x of [r.x + 43, r.x + r.width - 99]) d('dingdong_chicken_speaker_clock_a_speaker', x, r.y + 111, 66, 132);
      const cx = r.x + r.width / 2, cy = r.y + 154;
      d('dingdong_chicken_speaker_clock_a_clock_dial', cx - 62, cy - 22, 124, 48);
      d('dingdong_chicken_speaker_clock_a_clock_hands', cx - 38, cy + 10, 76, 5);
      lampImage(subject.x - 80, r.y + 57, 140);
    } else {
      for (const xx of [r.x + 12, r.x + r.width - 16]) pipeImage(xx, r.y + 47, xx, fy - 24, 16);
      pipeImage(r.x + 12, r.y + 47, r.x + r.width - 16, r.y + 47, 16);
      d('industrial_pipe_connectors_a_elbow', r.x + 5, r.y + 40, 24, 24);
      d('industrial_pipe_connectors_a_elbow', r.x + r.width - 34, r.y + 40, 24, 24);
      for (const [x, y] of [[subject.x - 66, r.y + 150], [subject.x + 59, r.y + 202]]) d('gugu_gaga_cold_vent_a_frost_decal', x - 12, y - 12, 25, 25, 0.5);
      d('gugu_gaga_cold_vent_a_vent_box', r.x + 34, fy - 88, 87, 66); lampImage(subject.x - 90, r.y + 54, 160);
    }
    doorImage(id, door.x, door.y); sign('入口', door.x - 17, door.y - 158, 13, '#c5c6b4');
  }
  const safe = MAP_DEFINITION.safeRect, fy = safe.y + safe.height;
  shellImage(safe, 'moss', 'left');
  sign('医疗休整区', safe.x + 29, safe.y + 69, 27, '#273849'); sign('SAFE / 抵达后恢复', safe.x + 30, safe.y + 105, 15, '#506176');
  glassImage(safe.x + 249, safe.y + 73, 149, 85);
  for (const x of [safe.x + 35, safe.x + safe.width - 145]) {
    d('medical_recovery_bed_a_bed_frame_mattress', x, fy - 70, 129, 70);
    d('medical_recovery_bed_a_pillow', x + 5, fy - 70, 35, 14);
  }
  d('medical_supply_cabinet_a_cabinet', safe.x + 196, fy - 112, 56, 92);
  d('medical_supply_cabinet_a_blank_chart', safe.x + 466, safe.y + 80, 46, 67);
  d('nm_v2_env_supply_dispenser_dispenser', safe.x + 260, fy - 92, 28, 92);
  benchImage(safe.x + 302, fy, 99); doorImage('SAFE', MAP_NODES['safe-door'].x, fy); lampImage(safe.x + 270, safe.y + 44, 147);
  // Repaint every real bridge and transit segment above wall cladding, as in the vector version.
  for (const edge of MAP_DEFINITION.edges) {
    const a = MAP_NODES[edge.from], end = MAP_NODES[edge.to];
    if (edge.kind === 'CORRIDOR' && a.y === end.y) floorImage(Math.min(a.x, end.x) - 65, a.y, Math.abs(a.x - end.x) + 130);
  }
  for (const edge of MAP_DEFINITION.edges) {
    if (edge.kind !== 'TRANSIT') continue;
    const a = MAP_NODES[edge.from], end = MAP_NODES[edge.to], top = Math.min(a.y, end.y), h = Math.abs(a.y - end.y);
    d('transit_ladder_vertical_a_shaft_wall', a.x - 61, top, 122, h);
    // Repeat at a fixed pitch so long shafts never stretch rung spacing.
    const sectionHeight = 140;
    for (let y = top; y < top + h; y += sectionHeight) {
      const height = Math.min(sectionHeight, top + h - y);
      const section = d('transit_ladder_vertical_a_ladder', a.x - 28, y, 56, sectionHeight);
      if (section && height < sectionHeight) section.setCrop(0, 0, section.frame.width, section.frame.height * height / sectionHeight);
    }
  }
  const junctions = MAP_DEFINITION.nodes.filter(node => MAP_DEFINITION.edges.some(edge => edge.kind === 'TRANSIT' && (edge.from === node.id || edge.to === node.id)));
  for (const node of junctions) d('transit_landing_grate_a_landing_grate', node.x - 68, node.y - 9, 136, 11);
  sign('A / 联络井', MAP_NODES['a-top'].x - 98, MAP_NODES['a-top'].y - 60, 16, '#b0b7ad');
  sign('B / 联络井', MAP_NODES['b-top'].x - 100, MAP_NODES['b-top'].y - 57, 16, '#b0b7ad');
  sign('C / 下行通道', MAP_NODES['c-landing'].x - 110, MAP_NODES['c-landing'].y - 45, 16, '#9bafb1');
  sign('01  上层观察', 1002, 362, 17, '#a4b5ad'); sign('← N01', 1482, 811, 13, '#d0c4a8');
  sign('N02 →', 2110, 813, 13, '#d0c4a8'); sign('← N03   /   下行 N05', 1095, 1320, 14, '#e0d6bd'); sign('N04 →', 2392, 1555, 14, '#e6d6bd');
  for (const r of Object.values(ROOM_RECTS)) for (const x of [r.x + 35, r.x + r.width - 90]) d('facility_distant_framework_a_diagonal_brace', x, r.y + r.height + 37, 67, 58, 0.52);
  // Graphics remains a backing plane only; runtime actors, text, selection and warnings stay separate.
  g.fillStyle(PALETTE.void).fillRect(b.x, b.y, b.width, b.height);
}
