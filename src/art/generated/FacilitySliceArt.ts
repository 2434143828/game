import type Phaser from 'phaser';
import type { Rect } from '../../../contracts/data-contract';
import { EnvironmentArt, FACILITY_V05_SLICE_TEXTURES } from './EnvironmentArt';
import { inkBox, inkLine } from '../ink';

const P = { ink: 0x303d3b, cream: 0xe5e2cc, trim: 0x9ea998, shade: 0x7c8b80, floor: 0xbcc4af, yellow: 0xd6bc70 };
type Graphics = Phaser.GameObjects.Graphics;

/** Presentation only: every floor and opening uses the unchanged authored map. */
export class FacilitySliceArt {
  readonly enabled: boolean;
  constructor(private readonly art: EnvironmentArt) {
    const baseline = import.meta.env.DEV && new URLSearchParams(window.location.search).get('facilityArt') === 'legacy';
    this.enabled = !baseline && Object.values(FACILITY_V05_SLICE_TEXTURES).every(key => art.scene.textures.exists(key));
  }

  /** Suppress legacy corridor segments both outside and inside sample rooms. */
  containsEdge(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    return this.enabled && a.y === b.y && (
      (a.y === 460 && Math.min(a.x, b.x) >= 260 && Math.max(a.x, b.x) <= 1400) ||
      (a.y === 1130 && Math.min(a.x, b.x) >= 1400 && Math.max(a.x, b.x) <= 2300)
    );
  }

  private graphics(): Graphics {
    const g = this.art.scene.add.graphics();
    this.art.container.add(g);
    return g;
  }

  private floor(g: Graphics, x: number, feetY: number, width: number): void {
    // No raised foreground lip: contact line is exactly feetY.
    g.fillStyle(P.floor).fillRect(x, feetY, width, 15);
    g.fillStyle(P.shade).fillRect(x, feetY + 15, width, 9);
    inkLine(g, x, feetY, x + width, feetY, 2.5, P.ink, 4);
    inkLine(g, x, feetY + 24, x + width, feetY + 24, 2, P.ink, 4);
    for (let xx = x + 100; xx < x + width - 20; xx += 130) inkLine(g, xx, feetY + 3, xx, feetY + 12, 1, P.shade, 3);
  }

  private frame(g: Graphics, r: Rect, opening: 'left' | 'right'): void {
    inkBox(g, r.x - 5, r.y - 5, r.width + 10, 17, P.trim, 2.5, 3);
    const feetY = r.y + r.height;
    for (const side of ['left', 'right'] as const) {
      const x = side === 'left' ? r.x - 5 : r.x + r.width - 5;
      inkBox(g, x, r.y + 12, 10, r.height - 12 - (side === opening ? 124 : 0), P.trim, 2, 5);
    }
    this.floor(g, r.x - 5, feetY, r.width + 10);
  }

  private door(id: string, x: number, feetY: number): void {
    const key = 'facility-slice-flat-door-leaf';
    if (!this.art.scene.textures.exists(key)) {
      const source = this.art.scene.add.graphics();
      inkBox(source, 2, 2, 22, 118, P.shade, 2, 2);
      inkBox(source, 7, 14, 12, 30, 0xb8cac3, 1.5, 1);
      inkLine(source, 18, 71, 18, 82, 2, P.cream, 1);
      source.generateTexture(key, 26, 122);
      source.destroy();
    }
    const g = this.graphics();
    g.fillStyle(0x52635c).fillRect(x - 13, feetY - 122, 26, 122);
    const leaf = this.art.scene.add.image(x - 13, feetY - 122, key).setOrigin(0);
    this.art.container.add(leaf);
    this.art.registerDoor(id, leaf);
    const trim = this.graphics();
    inkBox(trim, x - 19, feetY - 127, 38, 8, P.cream, 2, 3);
    inkBox(trim, x - 19, feetY - 119, 6, 119, P.trim, 1.5, 4);
    inkBox(trim, x + 13, feetY - 119, 6, 119, P.trim, 1.5, 4);
    inkBox(trim, x + 24, feetY - 83, 12, 22, P.cream, 1.5, 2);
    trim.fillStyle(P.shade).fillRect(x + 27, feetY - 78, 6, 7);
  }

  room(r: Rect, id: 'N01' | 'SAFE', doorX: number): void {
    const medical = id === 'SAFE';
    const feetY = r.y + r.height;
    const plateHeight = medical ? 210 : 220;
    const cropHeight = medical ? 764 : 734;
    // Scale medical furniture against the 66px employee, not the full room
    // height. Preserve its source aspect and extend the quiet wall to the sides.
    const plateWidth = medical ? plateHeight * 1983 / cropHeight : r.width;
    const wall = this.graphics();
    wall.fillStyle(medical ? 0xe8dfd2 : 0xebe2cf).fillRect(r.x, r.y, r.width, r.height);
    if (medical) {
      const bandY = feetY - plateHeight + 500 / cropHeight * plateHeight;
      wall.fillStyle(0xa5ab9a).fillRect(r.x, bandY, r.width, feetY - bandY);
    }
    this.art.drawSlice(medical ? FACILITY_V05_SLICE_TEXTURES.medicalRest : FACILITY_V05_SLICE_TEXTURES.n01Room,
      r.x + (r.width - plateWidth) / 2, feetY - plateHeight, plateWidth, plateHeight, {}, cropHeight);
    this.frame(this.graphics(), r, medical ? 'left' : 'right');
    this.door(id, doorX, feetY);
  }

  corridor(x: number, feetY: number, width: number): void {
    const top = feetY - 170;
    this.art.drawSlice(FACILITY_V05_SLICE_TEXTURES.connectorCorridor, x, top, width, 170, {}, 735);
    const g = this.graphics();
    inkBox(g, x, top - 5, width, 10, P.trim, 2, 2);
    this.floor(g, x, feetY, width);
  }
}
