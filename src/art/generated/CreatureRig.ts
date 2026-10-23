import type Phaser from 'phaser';
import type { AnomalyId } from '../../../contracts/data-contract';
import type { CreaturePose } from '../characters/abnormalities';
import inventory from './nm-v2-runtime-inventory.json';

const SLUG: Readonly<Record<AnomalyId, string>> = {"N01":"nailong","N02":"maodie","N03":"big_dog","N04":"dingdong_chicken","N05":"gugu_gaga"};
const PARTS: Readonly<Record<AnomalyId, readonly string[]>> = {
  N01: ['body','head_neck','muzzle','eyes','arm_left','arm_right','foot_left','foot_right','tail','repeat_eyes','repeat_mouth'],
  N02: ['body','head_ears','calm_face','arm_left','arm_right','hind_foot_left','hind_foot_right','tail','outburst_face'],
  N03: ['body','head_ears','eyes','upper_muzzle','lower_muzzle','tongue','front_leg','hind_leg','tail','collar_tag','hype_eyes'],
  N04: ['body','head_neck','comb','upper_beak','lower_beak_wattle','wing','tail_feathers','leg_left','leg_right','notification_badge','loop_badge_overlay'],
  N05: ['body_belly','head_face_patch','eyes','upper_beak','lower_beak','flipper_left','flipper_right','foot_left','foot_right','scarf_collar','scarf_long','scarf_short','cry_eyes'],
};
const POLLUTION_PARTS = new Set(['repeat_eyes','repeat_mouth','outburst_face','hype_eyes','loop_badge_overlay','cry_eyes']);
const textureKey = (id: AnomalyId, part: string): string => `nm_v2_abn_${SLUG[id]}_${POLLUTION_PARTS.has(part)?'pollution':'base'}_parts_${part}`;
export const CREATURE_TEXTURES: readonly { key: string; url: string }[] =
  inventory.filter(asset=>asset.scope==='abnormalities').map(({key,url})=>({key,url}));

interface EntityRig {
  id: AnomalyId;
  root: Phaser.GameObjects.Container;
  floor: Phaser.GameObjects.Graphics;
  marks: Phaser.GameObjects.Graphics;
  parts: Map<string, Phaser.GameObjects.Image>;
}
interface Motion {
  time: number; walk: number; beat: number; breath: number; glitch: number;
  breached: boolean; windup: boolean; impact: boolean; stunned: boolean; hurt: number;
}
export interface CreatureRigSnapshot {
  key: string; id: AnomalyId; x: number; y: number; scaleX: number; scaleY: number;
  parts: readonly { name: string; x: number; y: number; scaleX: number; scaleY: number; rotation: number; alpha: number; visible: boolean }[];
}
type DrawPart = (part: string, x: number, y: number, width: number, height: number, angle?: number, ox?: number, oy?: number, alpha?: number) => void;

/** AI-generated cutout parts. This layer has no gameplay state and never advances a clock. */
export class CreatureRig {
  readonly container: Phaser.GameObjects.Container;
  private readonly entities = new Map<string, EntityRig>();
  private readonly used = new Set<string>();

  constructor(private readonly scene: Phaser.Scene, parent?: Phaser.GameObjects.Container) {
    this.container = scene.add.container(0, 0);
    this.container.setName('generated-creature-rigs');
    if (parent) parent.add(this.container);
  }

  beginFrame(): void { this.used.clear(); }

  getReadiness(): { id: AnomalyId; missing: string[]; renderer: string }[] {
    return (Object.keys(PARTS) as AnomalyId[]).map(id => {
      const missing = PARTS[id].filter(part => !this.scene.textures.exists(textureKey(id, part)));
      return { id, missing, renderer: missing.length ? 'procedural-placeholder' : 'modern-media-v2' };
    });
  }

  render(id: AnomalyId, pose: CreaturePose, key: string): boolean {
    if (!PARTS[id].every(part => this.scene.textures.exists(textureKey(id, part)))) return false;
    let rig = this.entities.get(key);
    if (rig && rig.id !== id) { rig.root.destroy(true); this.entities.delete(key); rig = undefined; }
    if (!rig) {
      const root = this.scene.add.container();
      this.container.add(root);
      const floor = this.scene.add.graphics();
      const marks = this.scene.add.graphics();
      root.add(floor);
      const parts = new Map<string, Phaser.GameObjects.Image>();
      for (const part of PARTS[id]) {
        const image = this.scene.add.image(0, 0, textureKey(id, part)).setVisible(false);
        image.setName(part);
        root.add(image);
        parts.set(part, image);
      }
      if (id === 'N03') {
        for (const part of ['front_leg', 'hind_leg']) {
          const image = this.scene.add.image(0, 0, textureKey(id, part)).setVisible(false);
          image.setName(`${part}_far`);
          root.add(image);
          parts.set(`${part}_far`, image);
        }
      }
      root.add(marks);
      rig = { id, root, floor, marks, parts };
      this.entities.set(key, rig);
    }
    this.used.add(key);
    const scale = pose.enemy?.isClone ? 0.76 : id === 'N03' ? 1.06 : 1;
    rig.root.setVisible(true).setPosition(pose.foot.x, pose.foot.y).setScale(pose.facing * scale, scale);
    const stunned = Boolean(pose.enemy && pose.enemy.stunnedUntilSec > pose.time);
    const m: Motion = {
      time: pose.time, walk: pose.moving && !stunned ? Math.sin(pose.stride) : 0,
      beat: pose.working && !stunned ? Math.sin(pose.time * 4.3) : 0,
      breath: stunned ? 0 : Math.sin(pose.time * (pose.working ? 3.7 : 1.8)),
      glitch: pose.enemy && !stunned ? Math.sin(Math.floor(pose.time * 7) * 2.7) : 0,
      breached: Boolean(pose.enemy), windup: pose.enemy?.attackPhase === 'WINDUP',
      impact: (pose.impactRemaining ?? 0) > 0, stunned, hurt: pose.hurt,
    };
    for (const image of rig.parts.values()) image.setVisible(false);
    const lean = m.hurt > 0 ? -3 : m.windup ? -2 : m.impact ? 4 : 0;
    const current = rig;
    const draw: DrawPart = (part, x, y, width, height, angle = 0, ox = 0.5, oy = 0.5, alpha = 1) => {
      const image = current.parts.get(part);
      if (!image) return;
      image.setVisible(true).setOrigin(ox, oy).setPosition(x + (y < -15 ? lean : 0), y)
        .setDisplaySize(width, height).setRotation(angle).setAlpha(alpha);
      if (pose.enemy?.isClone) image.setTint(0xd9e1ea); else image.clearTint();
      current.root.bringToTop(image);
    };
    if (id === 'N01') this.nailong(draw, m, pose.working);
    else if (id === 'N02') this.cat(draw, m, pose.working);
    else if (id === 'N03') this.dog(draw, m, pose.working);
    else if (id === 'N04') this.chicken(draw, m, pose.working);
    else this.penguin(draw, m, pose.working);
    rig.root.bringToTop(rig.marks);
    rig.floor.clear().fillStyle(0x211e24, 0.28).fillEllipse(0, 3, id === 'N03' ? 108 : 67, 12);
    if (pose.selected) rig.floor.lineStyle(3, 0xffcf43, 1).strokeEllipse(0, 2, id === 'N03' ? 110 : 78, 17);
    rig.marks.clear();
    if (m.stunned) {
      rig.marks.lineStyle(2, 0xa2c3ca, 0.8).strokeEllipse(0, -114, 35, 9);
      for (const x of [-16, 16]) {
        rig.marks.lineStyle(2, 0xd3ad56).lineBetween(x - 4, -114, x + 4, -114)
          .lineBetween(x, -118, x, -110);
      }
    }
    if (m.hurt > 0) {
      rig.marks.lineStyle(2, 0x211e24, Math.min(1, m.hurt * 5));
      for (let i = 0; i < 5; i++) {
        const s = i % 2 ? -1 : 1;
        rig.marks.lineBetween(s * 36, -20 - i * 15, s * 45, -23 - i * 15);
      }
    }
    if (m.breached && (id === 'N04' || id === 'N05')) {
      const y = -75 + Math.floor(m.time * 6) % 4 * 15;
      rig.marks.lineStyle(1.6, id === 'N04' ? 0x9d5345 : 0xa2c3ca, 0.7)
        .lineBetween(-33 + m.glitch * 2, y, -22, y + 1).lineBetween(22, y + 3, 35, y + 2);
    }
    return true;
  }

  endFrame(): void {
    for (const [key, rig] of this.entities) rig.root.setVisible(this.used.has(key));
  }

  getState(): readonly CreatureRigSnapshot[] {
    return [...this.entities].filter(([, rig]) => rig.root.visible).map(([key, rig]) => ({
      key, id: rig.id, x: rig.root.x, y: rig.root.y, scaleX: rig.root.scaleX, scaleY: rig.root.scaleY,
      parts: [...rig.parts].map(([name, image]) => ({ name, x: image.x, y: image.y,
        scaleX: image.scaleX, scaleY: image.scaleY, rotation: image.rotation, alpha: image.alpha, visible: image.visible })),
    }));
  }

  destroy(): void { this.container.destroy(true); this.entities.clear(); this.used.clear(); }

  private nailong(p: DrawPart, m: Motion, working: boolean): void {
    const headX = 7 + (working ? 3 + m.beat : 0), headY = -70;
    p('tail', -26, -24, 42, 31, m.walk * 0.04, 0.85, 0.5);
    p('arm_left', -16, -39, 16, 28, -0.12 - m.walk * 0.12, 0.5, 0.1);
    p('body', 0, -35 + m.breath * 0.5, 55, 59);
    p('foot_left', -15 + m.walk * 4, -5, 27, 12, m.walk * 0.04);
    p('foot_right', 15 - m.walk * 4, -5, 28, 12, -m.walk * 0.04);
    p('head_neck', headX, headY + m.breath, 72, 64, m.hurt > 0 ? -0.06 : m.beat * 0.025);
    p(m.breached ? 'repeat_eyes' : 'eyes', headX + 7 + m.glitch, headY - 5 + m.breath, 41, 24);
    p('muzzle', headX + 7, headY + 16 + m.breath, 49, 19, m.impact ? 0.07 : 0);
    if(m.breached)p('repeat_mouth',headX+9,headY+17+m.breath,27,12);
    p('arm_right', 20, -39, 18, 24, m.windup ? -0.8 : working ? -0.55 + m.beat * 0.15 : m.walk * 0.16, 0.5, 0.1);
  }

  private cat(p: DrawPart, m: Motion, working: boolean): void {
    const headY = working ? -58 : -55, headX = 23 + m.glitch;
    p('tail', -34, -29, 32, 48, m.walk * 0.09, 0.8, 0.88);
    p('hind_foot_left', -31 + m.walk * 4, -16, 23, 32, m.walk * 0.08);
    p('hind_foot_right', -17 - m.walk * 4, -16, 23, 32, -m.walk * 0.08);
    p('arm_left', 15, -25, 15, 27, m.walk * 0.15, 0.5, 0.08);
    p('body', -8, -31, 73, 44);
    p('head_ears', headX, headY + m.breath, 61, 57, m.hurt > 0 ? -0.08 : m.beat * 0.025);
    p(m.breached ? 'outburst_face' : 'calm_face', headX + 9, headY + 12 + m.breath, 37, 23);
    p('arm_right', 31, -25, 17, 28,
      m.impact ? -0.65 : m.windup ? -0.25 : working ? -0.22 - m.beat * 0.08 : -m.walk * 0.15, 0.5, 0.08);
  }

  private dog(p: DrawPart, m: Motion, working: boolean): void {
    p('tail', -34, -44, 35, 35, m.walk * 0.12, 0.9, 0.6);
    p('hind_leg_far', -19, -37, 19, 36, -m.walk * 0.18, 0.5, 0);
    p('front_leg_far', 26, -39, 17, 38, m.walk * 0.18, 0.5, 0);
    p('body', -7, -46 + m.breath * 0.5, 78, 49);
    p('hind_leg', -30, -38, 22, 39, m.walk * 0.18, 0.5, 0);
    p('front_leg', 14, -42, 20, 43, working ? -0.23 - Math.abs(m.beat) * 0.14 : -m.walk * 0.18, 0.5, 0);
    p('collar_tag', 25, -51 + m.breath * 0.5, 39, 17, 0.1);
    p('head_ears', 27, -80 + m.breath, 73, 67, m.windup ? -0.08 : m.impact ? 0.1 : 0);
    p(m.breached?'hype_eyes':'eyes',36,-87+m.breath,35,24);
    const spread=m.windup?0.12:m.impact?0.22:working?0.08:0;
    p('lower_muzzle',36,-62+m.breath,36,10,spread);
    p('upper_muzzle',36,-69+m.breath,44,19,-spread*0.4);
    p('tongue',43,-61+m.breath,10,12,spread,0.5,0.1);
  }

  private chicken(p: DrawPart, m: Motion, working: boolean): void {
    const stretch = 0, headY = -73 + m.breath;
    p('tail_feathers', -22, -39, 38, 40, m.beat * 0.03, 0.85, 0.65);
    p('leg_left', -12 + m.walk * 4, -21, 20, 23, m.walk * 0.13, 0.5, 0);
    p('leg_right', 12 - m.walk * 4, -21, 20, 23, -m.walk * 0.13, 0.5, 0);
    p('body', 0, -40 + m.breath * 0.4, 64, 61);
    p('head_neck', 8 + m.glitch, headY, 56, 58 + stretch, m.beat * 0.04);
    p('comb', 7 + m.glitch, headY - 27, 39, 24, m.beat * 0.035);
    p('upper_beak', 28 + m.glitch, headY + 4, 24, 12, m.breached ? -0.28 : 0, 0.1, 0.5);
    p('lower_beak_wattle', 28 + m.glitch, headY + 9, 22, 19, m.breached ? (m.windup ? 0.35 : 0.45) : 0, 0.1, 0.2);
    p('wing', -10, -43, 38, 27, m.breached ? 0.55 + (m.impact ? 0.18 : 0) : working ? 0.3 + m.beat * 0.15 : 0, 0.85, 0.35);
    const badgeY = -35 + m.breath * 0.4;
    p('notification_badge',7,badgeY,24,25);
    if(m.breached)p('loop_badge_overlay',7,badgeY,27,28,0,0.5,0.5,0.72);
  }

  private penguin(p: DrawPart, m: Motion, working: boolean): void {
    const headY = -76 + m.breath;
    p('foot_left', -13 + m.walk * 5, -4, 29, 12, m.walk * 0.06);
    p('foot_right', 15 - m.walk * 5, -4, 30, 12, -m.walk * 0.06);
    p('flipper_left', 19, -44, 32, 21, m.windup ? 0.4 : working ? 0.2 + m.beat * 0.16 : 0.95 + m.walk * 0.12, 0.1, 0.5);
    p('body_belly', m.glitch * 0.4, -33 + m.breath * 0.4, 65, 55);
    p('head_face_patch', 3 + m.glitch, headY, 69, 59);
    p(m.breached ? 'cry_eyes' : 'eyes', 12 + m.glitch, headY + 1, 33, 21);
    p('upper_beak',20,headY+16,16,7,m.windup?-0.08:0);
    p('lower_beak',20,headY+21,15,5,m.impact?0.18:m.beat*0.02);
    p('scarf_collar', 2, -50 + m.breath * 0.4, 58, 16);
    p('scarf_short', 15, -46, 10, 20, -0.12 - m.walk * 0.1, 0.5, 0);
    p('scarf_long', 4, -46, 14, 27, 0.12 + m.walk * 0.12, 0.5, 0);
    p('flipper_right', -24, -43, 33, 21, m.windup ? -0.5 : working ? -0.3 - m.beat * 0.16 : -0.9 - m.walk * 0.12, 0.85, 0.5);
  }
}

