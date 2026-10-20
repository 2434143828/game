import Phaser from 'phaser';
import type { AnomalyId, Rect } from '../../../contracts/data-contract';
import { anomalyById } from '../../data/config';
import { MAP_DEFINITION, MAP_NODES, ROOM_COLORS, ROOM_RECTS, creatureFeet, roomWorkFeet } from './geometry';
import { INK } from './actors';

type Sign = (text: string, x: number, y: number, size?: number, color?: string) => void;
type Graphics = Phaser.GameObjects.Graphics;
const C = { void: 0x10131b, distant: 0x1b202a, cream: 0xd6d3c6, steel: 0x78858a, amber: 0xf0c774, brass: 0xb6a477 };
function box(g: Graphics, x: number, y: number, w: number, h: number, color: number, stroke = 3, strokeColor = INK): void {
  g.fillStyle(color).fillRect(x, y, w, h);
  if (stroke) g.lineStyle(stroke, strokeColor).strokeRect(x, y, w, h);
}
function pipe(g: Graphics, x1: number, y1: number, x2: number, y2: number, width: number, color = C.steel): void {
  g.lineStyle(width + 6, INK).lineBetween(x1, y1, x2, y2);
  g.lineStyle(width, color).lineBetween(x1, y1, x2, y2);
  g.lineStyle(2, 0xe0d9bd, 0.4).lineBetween(x1 - 2, y1 - 2, x2 - 2, y2 - 2);
}
function lamp(g: Graphics, x: number, y: number, width: number, drop = 150, color = C.amber): void {
  box(g, x, y, width, 16, INK, 0); box(g, x + 6, y + 5, width - 12, 7, color, 0);
  g.fillStyle(color, 0.075).fillTriangle(x + width / 2, y + 15, x - 35, y + drop, x + width + 35, y + drop);
}
function floor(g: Graphics, x: number, y: number, width: number, accent = C.brass): void {
  box(g, x, y - 12, width, 15, 0xa8b0a7, 3); box(g, x - 3, y + 3, width + 6, 23, INK, 0);
  box(g, x, y + 27, width, 8, 0x343c46, 0);
  g.lineStyle(3, accent).lineBetween(x + 2, y - 11, x + width - 2, y - 11);
  for (let xx = x + 12; xx < x + width; xx += 40) g.lineStyle(1.5, 0x626e72).lineBetween(xx, y - 8, xx + 8, y);
}
function shell(g: Graphics, r: Rect, accent: number, wall = 0xb8bdb6, lower = 0x959f9e, cut = 0): void {
  box(g, r.x + 18, r.y + 21, r.width + 8, r.height + 18, 0x090c12, 0);
  const poly = [
    { x: r.x - 12, y: r.y + cut }, { x: r.x + cut, y: r.y - 12 },
    { x: r.x + r.width - cut, y: r.y - 12 }, { x: r.x + r.width + 12, y: r.y + cut },
    { x: r.x + r.width + 12, y: r.y + r.height + 12 }, { x: r.x - 12, y: r.y + r.height + 12 },
  ];
  g.fillStyle(0x515a65).fillPoints(poly, true); g.lineStyle(6, INK).strokePoints(poly, true);
  box(g, r.x, r.y + 30, r.width, r.height - 30, C.cream, 4);
  box(g, r.x + 7, r.y + 30, r.width - 14, 10, accent, 0);
  box(g, r.x + 12, r.y + 41, r.width - 24, r.height - 54, wall, 0);
  box(g, r.x + 13, r.y + r.height - 64, r.width - 26, 52, lower, 0);
  for (let x = r.x + 24; x < r.x + r.width - 18; x += 115) {
    g.lineStyle(1.5, lower).lineBetween(x, r.y + 45, x, r.y + r.height - 17);
    g.fillStyle(0x65716f).fillCircle(x, r.y + 51, 2.5).fillCircle(x, r.y + r.height - 24, 2.5);
  }
  pipe(g, r.x + 18, r.y + 49, r.x + r.width - 18, r.y + 49, 7, 0x8d8b79);
  floor(g, r.x - 6, r.y + r.height, r.width + 12, accent);
}
function glass(g: Graphics, x: number, y: number, w: number, h: number, tint = 0x9daead): void {
  box(g, x, y, w, h, 0x3b454e, 4); box(g, x + 7, y + 7, w - 14, h - 14, tint, 0);
  g.fillStyle(0xeeeccf, 0.16).fillTriangle(x + 9, y + 9, x + w * 0.55, y + 9, x + 9, y + h - 9);
  g.lineStyle(2, 0xe9e9d7, 0.48).lineBetween(x + w * 0.22, y + 9, x + 10, y + h * 0.65).lineBetween(x + w * 0.33, y + 9, x + w * 0.12, y + h - 9);
  if (w > 230) box(g, x + w * 0.52, y + 4, 7, h - 8, 0x5b696f, 2);
}
function consoleDesk(g: Graphics, x: number, floorY: number, width: number, color = 0x668e86): void {
  box(g, x + 8, floorY - 36, width - 16, 33, 0x4a555e, 3);
  const pts = [{ x, y: floorY - 60 }, { x: x + width, y: floorY - 60 }, { x: x + width - 8, y: floorY - 35 }, { x: x - 7, y: floorY - 35 }];
  g.fillStyle(0xb8bcb0).fillPoints(pts, true); g.lineStyle(3, INK).strokePoints(pts, true);
  box(g, x + 8, floorY - 54, width * 0.5, 12, 0x24383f, 2); box(g, x + 11, floorY - 52, width * 0.38, 5, color, 0);
  for (let i = 0; i < 3; i++) g.fillStyle(i === 0 ? C.amber : 0xa6bbb0).fillCircle(x + width - 15 - i * 9, floorY - 47, 2.5);
  g.lineStyle(2, 0x899a9a).lineBetween(x + 17, floorY - 27, x + 17, floorY - 9).lineBetween(x + width - 20, floorY - 27, x + width - 20, floorY - 9);
}
function bench(g: Graphics, x: number, floorY: number, width: number, color = 0x747f77): void {
  box(g, x, floorY - 48, width, 27, color, 3); box(g, x - 3, floorY - 21, width + 6, 12, 0xa5a897, 3);
  box(g, x + 12, floorY - 9, 6, 9, INK, 0); box(g, x + width - 18, floorY - 9, 6, 9, INK, 0);
  for (let xx = x + 35; xx < x + width - 20; xx += 38) g.lineStyle(2, INK).lineBetween(xx, floorY - 45, xx, floorY - 24);
}
function wallMonitor(g: Graphics, x: number, y: number, width: number, height: number, tint: number): void {
  box(g, x, y, width, height, 0x202c35, 5); box(g, x + 9, y + 9, width - 18, height - 18, 0x476167, 0);
  const stride = (width - 30) / 7;
  for (let i = 0; i < 7; i++) { const h = height * (0.22 + ((i * 3 + 1) % 5) / 12); box(g, x + 16 + i * stride, y + height - 17 - h, stride * 0.5, h, tint, 0); }
  g.lineStyle(2, 0xb3c3b1, 0.4).lineBetween(x + 14, y + height - 16, x + width - 14, y + height - 16);
}
function sealDoor(g: Graphics, x: number, floorY: number, accent: number, side = 1): void {
  box(g, x - 15, floorY - 133, 30, 133, 0x424b55, 4);
  box(g, x - 10, floorY - 127, 20, 116, 0x1a2430, 1);
  box(g, x - 19, floorY - 137, 38, 12, accent, 3);
  g.lineStyle(4, accent).lineBetween(x + side * 13, floorY - 126, x + side * 13, floorY - 12);
  for (let y = floorY - 119; y < floorY - 10; y += 22) g.fillStyle(0xe2d4a8).fillTriangle(x - 8, y, x + 8, y + 8, x - 8, y + 15);
}
export function drawLadder(g: Graphics, x: number, top: number, bottom: number, width = 122): void {
  box(g, x - width / 2 - 12, top - 11, width + 24, bottom - top + 23, 0x0b1018, 5);
  box(g, x - width / 2, top, width, bottom - top, 0x35434c, 0);
  g.fillStyle(0x90b0b3, 0.09).fillRect(x - width / 2 + 4, top, width - 8, bottom - top);
  for (let y = top + 8; y < bottom; y += 14) {
    g.lineStyle(5, 0x18232e).lineBetween(x - width / 2 + 8, y + 2, x + width / 2 - 8, y + 2);
    g.lineStyle(3, 0x9ea9a3).lineBetween(x - width / 2 + 8, y, x + width / 2 - 8, y);
  }
  for (const dx of [-width / 2, -24, 24, width / 2]) g.lineStyle(4, 0xc1b882).lineBetween(x + dx, top, x + dx, bottom);
  for (let y = top + 40; y < bottom - 20; y += 110) {
    box(g, x - width / 2 - 10, y, 9, 37, 0x6c7a80, 2); box(g, x + width / 2 + 1, y, 9, 37, 0x6c7a80, 2);
  }
}
function drawVoid(g: Graphics, sign: Sign): void {
  const b = MAP_DEFINITION.bounds; box(g, b.x, b.y, b.width, b.height, C.void, 0);
  // A sparse, deep framework surrounds the lit departments, rather than one flat building card.
  for (const [x, w] of [[96, 56], [1180, 78], [2250, 64], [3320, 90]]) {
    box(g, x, 65, w, 2310, C.distant, 0); box(g, x + 9, 65, 8, 2310, 0x242c36, 0);
    for (let y = 100; y < 2350; y += 230) {
      g.lineStyle(6, 0x262f39).lineBetween(x, y, x + w, y + 145).lineBetween(x + w, y, x, y + 145);
      box(g, x - 10, y + 170, w + 20, 18, 0x252d37, 0);
    }
  }
  for (const y of [145, 960, 1730, 2375]) { box(g, 90, y, 3350, 22, 0x1e2630, 0); g.lineStyle(3, 0x2b333d).lineBetween(100, y + 2, 3430, y + 2); }
  pipe(g, 200, 520, 200, 2330, 27, 0x39454f); pipe(g, 3300, 240, 3300, 2220, 32, 0x39454f);
  pipe(g, 350, 915, 3240, 915, 19, 0x373e49); pipe(g, 660, 1790, 1990, 1790, 17, 0x303c46);
  for (const [x, y] of [[3300, 780], [200, 1630], [930, 1790], [3120, 915]]) {
    g.lineStyle(4, 0x4d565f).strokeCircle(x, y, 25);
    g.lineStyle(3, 0x4d565f).lineBetween(x - 21, y, x + 21, y).lineBetween(x, y - 21, x, y + 21);
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
      box(g, x - 64, y - 118, w + 128, 119, 0x52616a, 5); box(g, x - 58, y - 108, w + 116, 93, 0x909e9f, 0);
      box(g, x - 58, y - 38, w + 116, 23, 0x75868a, 0);
      for (let xx = x - 35; xx < x + w + 40; xx += 145) {
        box(g, xx, y - 100, 86, 52, 0xb2bcb5, 2); g.lineStyle(2, 0x82918d).lineBetween(xx + 10, y - 88, xx + 73, y - 88);
      }
      if (w > 180) lamp(g, x + w / 2 - 38, y - 117, 76, 100);
      floor(g, x - 65, y, w + 130);
    } else {
      box(g, x - 11, y - 108, w + 22, 109, 0x738087, 4); box(g, x - 6, y - 101, w + 12, 87, 0xa7b1ac, 0);
      floor(g, x - 12, y, w + 24);
    }
  }
}
function drawHall(g: Graphics, hall: (typeof MAP_DEFINITION.halls)[number], sign: Sign): void {
  const r = hall.rect; const accent = parseInt(hall.accent.slice(1), 16); const fy = r.y + r.height;
  const palettes: Record<string, [number, number, number]> = {
    control: [0xb9c1a1, 0x7c8b70, 44], operations: [0xa8bdc6, 0x687f92, 16],
    broadcast: [0xc5a18b, 0x926a59, 38], records: [0xb3a9c0, 0x746f8a, 65], cold: [0xa8c2c4, 0x648f94, 28],
  };
  const palette = palettes[hall.id]; shell(g, r, accent, palette[0], palette[1], palette[2]);
  sign(hall.name, r.x + 27, r.y + 74, 27, '#35454a');
  sign(hall.subtitle, r.x + 29, r.y + 112, 14, '#53666b');
  if (hall.id === 'control') {
    // Olive control room, raised roof frames and central surveillance wall.
    g.lineStyle(12, 0x5c695e).lineBetween(1470, r.y + 43, 1520, r.y + 89).lineBetween(1520, r.y + 89, 1950, r.y + 89).lineBetween(1950, r.y + 89, 2000, r.y + 43);
    wallMonitor(g, 1580, r.y + 100, 244, 78, 0xc2ce9b); consoleDesk(g, 1598, fy, 210, 0x9fc49c);
    glass(g, 2070, r.y + 91, 170, 89, 0x7f9a8c); consoleDesk(g, 2110, fy, 108, 0xb6ba71);
    bench(g, 1150, fy, 124, 0x768e76); lamp(g, 1654, r.y + 47, 142, 190, 0xe7e2a7);
    g.lineStyle(5, 0x78866b).strokeCircle(1941, r.y + 137, 45); g.lineStyle(2, 0xd7dcc1).strokeCircle(1941, r.y + 137, 35);
    sign('主管监控终端', 1598, r.y + 80, 14, '#4d6356');
  } else if (hall.id === 'operations') {
    // Long blue transfer hall, panoramic glazing and deep buttresses.
    glass(g, 1490, r.y + 64, 590, 91, 0x86a5b1);
    for (const x of [1483, 1745, 2074]) {
      g.fillStyle(0x667e8d).fillPoints([{ x, y: r.y + 42 }, { x: x + 28, y: r.y + 42 }, { x: x + 17, y: fy - 16 }, { x: x - 5, y: fy - 16 }], true);
      g.lineStyle(3, 0x354c5d).lineBetween(x + 3, r.y + 42, x + 3, fy - 16);
    }
    wallMonitor(g, 2155, r.y + 66, 132, 76, 0xa8cbd1); consoleDesk(g, 2168, fy, 115);
    bench(g, 1575, fy, 175, 0x69899b); lamp(g, 1850, r.y + 44, 132, 170, 0xb8dbdf);
    box(g, 2398, fy - 129, 75, 112, 0x71818a, 4);
    for (let y = fy - 119; y < fy - 27; y += 14) g.lineStyle(3, 0xb1c4c5).lineBetween(2410, y, 2460, y);
  } else if (hall.id === 'broadcast') {
    // Copper-red security room with angular transverse frames and lockers.
    for (const x of [1470, 1780, 2105]) {
      g.lineStyle(10, 0x78594d).lineBetween(x, r.y + 43, x + 42, r.y + 81).lineBetween(x + 42, r.y + 81, x + 220, r.y + 81);
    }
    for (const x of [1510, 1685, 2078]) {
      box(g, x, fy - 110, 120, 94, 0x88796f, 3);
      for (let i = 0; i < 3; i++) { box(g, x + 8 + i * 35, fy - 102, 31, 78, 0xb69b83, 2); box(g, x + 27 + i * 35, fy - 69, 3, 13, INK, 0); }
    }
    box(g, 1880, fy - 95, 78, 64, 0xcebc8e, 3); g.fillStyle(0x785348).fillTriangle(1919, fy - 87, 1893, fy - 40, 1945, fy - 40);
    sign('!', 1912, fy - 73, 24, '#e7d8a9'); lamp(g, 1848, r.y + 45, 130, 160, 0xf1c08b);
  } else if (hall.id === 'records') {
    // Violet archive gallery: circular windows and tall, repeating cabinets.
    for (const x of [2150, 2440, 2730]) {
      g.fillStyle(0x6e6884).fillCircle(x + 80, r.y + 75, 41); g.lineStyle(5, 0x4d4b63).strokeCircle(x + 80, r.y + 75, 41);
      g.fillStyle(0xbab6c8).fillCircle(x + 80, r.y + 75, 29);
      g.lineStyle(4, 0x777187).lineBetween(x + 80, r.y + 46, x + 80, r.y + 104);
    }
    for (const x of [2070, 2240, 2420, 2600, 2780]) {
      if (Math.abs(x + 65 - MAP_NODES['b-gallery'].x) < 100) continue;
      box(g, x, fy - 97, 130, 80, 0x696479, 4);
      for (let row = 0; row < 2; row++) { box(g, x + 8, fy - 89 + row * 32, 114, 27, 0xa49baf, 2); box(g, x + 49, fy - 81 + row * 32, 32, 7, 0xd1c5b0, 1); }
    }
    lamp(g, 2505, r.y + 45, 120, 170, 0xd9c7e9);
  } else {
    // Teal lower plant with two large circular cooling units and overhead ducts.
    for (const x of [810, 1130]) {
      box(g, x, fy - 121, 104, 106, 0x71929a, 4); g.lineStyle(5, 0xadc3c2).strokeCircle(x + 52, fy - 71, 35);
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2;
        g.fillStyle(0xa1b8b5).fillTriangle(x + 52, fy - 71, x + 52 + Math.cos(a) * 32, fy - 71 + Math.sin(a) * 32, x + 52 + Math.cos(a + 0.7) * 24, fy - 71 + Math.sin(a + 0.7) * 24);
      }
    }
    pipe(g, r.x + 18, r.y + 54, r.x + r.width - 18, r.y + 54, 19, 0x779ca6);
    lamp(g, 913, r.y + 60, 115, 180, 0xc2e3d8);
  }
}
function drawRoom(g: Graphics, id: AnomalyId, sign: Sign): void {
  const r = ROOM_RECTS[id]; const accent = ROOM_COLORS[id]; const fy = r.y + r.height;
  const work = roomWorkFeet(id); const subject = creatureFeet(id); const room = MAP_DEFINITION.rooms[id];
  shell(g, r, accent, id === 'N05' ? 0xb2c7c5 : id === 'N04' ? 0xc0b5c5 : 0xb8bdb6, 0x929e96, id === 'N04' ? 54 : id === 'N03' ? 30 : 12);
  sign(`${id}   ${anomalyById[id].name}`, r.x + 25, r.y + 61, 27, '#414b4e');
  sign(`CONTAINMENT ${id.slice(1)} / 概念样本`, r.x + 27, r.y + 96, 13, '#657476');
  glass(g, subject.x - (id === 'N03' ? 143 : 103), r.y + 118, id === 'N03' ? 272 : 204, Math.max(100, r.height - 148), id === 'N05' ? 0xa9c0c0 : id === 'N04' ? 0xaaa7b0 : 0xa8b4ad);
  consoleDesk(g, work.x + 29, fy, 81, accent); wallMonitor(g, work.x - 104, r.y + 137, 78, 53, 0xa2b7a4);
  g.fillStyle(0x818d85).fillEllipse(subject.x, fy - 2, id === 'N03' ? 160 : 118, 17);
  g.lineStyle(2, 0x4b5657).strokeEllipse(subject.x, fy - 2, id === 'N03' ? 160 : 118, 17);
  if (id === 'N01') {
    for (const x of [r.x + 26, r.x + r.width - 72]) {
      box(g, x, fy - 99, 44, 81, 0x898d7d, 3); g.lineStyle(3, 0xc9ba85).strokeCircle(x + 22, fy - 67, 15);
      g.lineStyle(2, 0xc9ba85).lineBetween(x + 12, fy - 36, x + 32, fy - 36);
    }
    box(g, subject.x + 56, r.y + 79, 57, 40, 0xc6b06d, 3); g.lineStyle(3, 0x655b36).strokeCircle(subject.x + 84, r.y + 99, 13);
    lamp(g, subject.x - 77, r.y + 52, 133, r.height - 60, 0xf7daa0);
  } else if (id === 'N02') {
    const x = r.x + r.width - 61; pipe(g, x, fy - 190, x, fy - 14, 13, 0x8d7f6c);
    box(g, x - 35, fy - 166, 60, 12, 0xbaaa88, 3); box(g, x - 29, fy - 106, 65, 12, 0xbaaa88, 3);
    for (let i = 0; i < 3; i++) g.lineStyle(3, 0x726b67).lineBetween(r.x + 166 + i * 10, r.y + 125, r.x + 151 + i * 10, r.y + 166);
    bench(g, r.x + 29, fy, 95, 0x8b7f7e); lamp(g, subject.x - 72, r.y + 53, 128, r.height - 60, 0xf1c4ad);
  } else if (id === 'N03') {
    for (let x = r.x + 28; x < r.x + r.width - 24; x += 48) {
      // Reserve a clear wall bay around the operator's monitor.
      if (x < work.x - 18 && x + 25 > work.x - 112) continue;
      box(g, x, r.y + 122, 25, 83, 0x718079, 2);
      for (let y = r.y + 132; y < r.y + 198; y += 12) g.lineStyle(2, 0xadb6a8).lineBetween(x + 4, y, x + 20, y);
    }
    glass(g, subject.x - 143, r.y + 118, 272, r.height - 148, 0x9cae9f);
    g.lineStyle(5, 0x69786e).strokeCircle(subject.x + 93, fy - 16, 12);
    pipe(g, r.x + 34, r.y + 47, r.x + r.width - 29, r.y + 47, 11, 0x7d8e80);
    lamp(g, subject.x - 110, r.y + 57, 190, r.height - 65, 0xd5dfb7);
  } else if (id === 'N04') {
    for (const x of [r.x + 43, r.x + r.width - 99]) {
      box(g, x, r.y + 111, 66, 132, 0x6f687c, 4);
      for (const yy of [r.y + 143, r.y + 204]) {
        g.fillStyle(0x3b3a49).fillCircle(x + 33, yy, 24); g.lineStyle(3, 0xb9b0c2).strokeCircle(x + 33, yy, 18); g.lineStyle(2, 0x8b859e).strokeCircle(x + 33, yy, 9);
      }
    }
    const cx = r.x + r.width / 2; const cy = r.y + 105;
    g.fillStyle(0xd7d0ae).fillCircle(cx, cy, 31); g.lineStyle(4, INK).strokeCircle(cx, cy, 31);
    g.lineStyle(3, INK).lineBetween(cx, cy, cx, cy - 21).lineBetween(cx, cy, cx + 15, cy + 6);
    pipe(g, cx, r.y + 38, cx, cy - 34, 5, 0xb5aa84);
    lamp(g, subject.x - 80, r.y + 57, 140, r.height - 65, 0xe2c3e2);
  } else {
    for (const xx of [r.x + 12, r.x + r.width - 16]) pipe(g, xx, r.y + 47, xx, fy - 24, 16, 0x7da3ac);
    pipe(g, r.x + 12, r.y + 47, r.x + r.width - 16, r.y + 47, 16, 0x7da3ac);
    for (const [x, y] of [[subject.x - 66, r.y + 150], [subject.x + 59, r.y + 202]]) {
      g.lineStyle(3, 0xdaebdf).lineBetween(x - 13, y, x + 13, y).lineBetween(x, y - 13, x, y + 13).lineBetween(x - 9, y - 9, x + 9, y + 9).lineBetween(x - 9, y + 9, x + 9, y - 9);
    }
    box(g, r.x + 34, fy - 88, 87, 66, 0x7a9ca7, 3);
    for (let y = fy - 78; y < fy - 30; y += 10) g.lineStyle(3, 0xbbd0c9).lineBetween(r.x + 44, y, r.x + 111, y);
    lamp(g, subject.x - 90, r.y + 54, 160, r.height - 60, 0xc0e3df);
  }
  const door = MAP_NODES[room.doorNodeId]; const side = door.x > work.x ? 1 : -1;
  sealDoor(g, door.x, door.y, accent, side); sign('入口', door.x - 17, door.y - 158, 13, '#49595b');
  g.fillStyle(accent).fillTriangle(door.x - side * 26, door.y - 91, door.x - side * 46, door.y - 101, door.x - side * 46, door.y - 81);
}
function drawMedical(g: Graphics, sign: Sign): void {
  const r = MAP_DEFINITION.safeRect; const fy = r.y + r.height; shell(g, r, 0x87ab91, 0xc7d0b9, 0x91ab91, 25);
  sign('医疗休整区', r.x + 29, r.y + 69, 27, '#3d6152'); sign('SAFE / 抵达后恢复', r.x + 30, r.y + 105, 15, '#59796a');
  glass(g, r.x + 249, r.y + 73, 149, 85, 0xb6c4b3);
  for (const x of [r.x + 35, r.x + r.width - 145]) {
    box(g, x + 9, fy - 47, 111, 33, 0x7f9684, 3); box(g, x, fy - 63, 129, 22, 0xe5e4ce, 3);
    box(g, x + 5, fy - 70, 35, 14, 0xb3c5b1, 2); box(g, x + 15, fy - 14, 6, 14, INK, 0); box(g, x + 109, fy - 14, 6, 14, INK, 0);
  }
  box(g, r.x + 196, fy - 112, 56, 92, 0xa6bca4, 3);
  g.fillStyle(0xf5edda).fillRect(r.x + 219, fy - 97, 13, 44).fillRect(r.x + 204, fy - 82, 43, 13);
  bench(g, r.x + 302, fy, 99, 0x829d88); sealDoor(g, MAP_NODES['safe-door'].x, fy, 0x9fc3a2, -1);
  lamp(g, r.x + 270, r.y + 44, 147, 220, 0xdae4b5);
}

/** Authored-world cutaway: geometry follows map edges, without a second visual navigation graph. */
export function drawArchitecture(g: Graphics, sign: Sign): void {
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
    g.fillStyle(0xa1aaa2).fillRect(node.x - 68, node.y - 9, 136, 11);
    g.lineStyle(3, INK).strokeRect(node.x - 68, node.y - 9, 136, 11);
    g.lineStyle(2, 0xe2c675).lineBetween(node.x - 65, node.y - 8, node.x + 65, node.y - 8);
    for (let x = node.x - 57; x < node.x + 60; x += 22) g.lineStyle(1.5, 0x54666a).lineBetween(x, node.y - 7, x + 7, node.y + 1);
  }
  sign('A / 联络井', MAP_NODES['a-top'].x - 98, MAP_NODES['a-top'].y - 60, 16, '#b0b7ad');
  sign('B / 联络井', MAP_NODES['b-top'].x - 100, MAP_NODES['b-top'].y - 57, 16, '#b0b7ad');
  sign('C / 下行通道', MAP_NODES['c-landing'].x - 110, MAP_NODES['c-landing'].y - 45, 16, '#9bafb1');
  sign('01  上层观察', 1002, 362, 17, '#a4b5ad'); sign('← N01', 1482, 811, 13, '#536e6b');
  sign('N02 →', 2110, 813, 13, '#536e6b'); sign('← N03   /   下行 N05', 1095, 1320, 14, '#e0d6bd'); sign('N04 →', 2392, 1555, 14, '#e6d6bd');
  for (const id of Object.keys(ROOM_RECTS) as AnomalyId[]) {
    const r = ROOM_RECTS[id]; const y = r.y + r.height + 37;
    for (const x of [r.x + 35, r.x + r.width - 90]) {
      g.fillStyle(0x343c47).fillTriangle(x, y, x + 67, y, x + 67, y + 58);
      g.lineStyle(3, 0x4e5962).lineBetween(x, y, x + 67, y + 58);
    }
  }
}
