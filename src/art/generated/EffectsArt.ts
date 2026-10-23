import type Phaser from 'phaser';
import type { AnomalyId, DamageType, Point, Rect } from '../../../contracts/data-contract';
import inventory from './nm-v2-runtime-inventory.json';

const effectNames = {
  hit: 'nm_v2_vfx_hit_tick_key', panic: 'nm_v2_vfx_panic_signal_key', breach: 'nm_v2_vfx_local_signal_tear_key',
  work: 'nm_v2_vfx_work_tick_key', RED: 'nm_v2_vfx_damage_type_red', WHITE: 'nm_v2_vfx_damage_type_white',
  BLACK: 'nm_v2_vfx_damage_type_black', PALE: 'nm_v2_vfx_damage_type_pale',
  n01a: 'nm_v2_poll_n01_repeat_comment_blank', n01b: 'nm_v2_poll_n01_repeat_recommend_blank',
  n02a: 'nm_v2_poll_n02_argument_comment_blank', n02b: 'nm_v2_poll_n02_argument_emotion_tag_blank',
  n03a: 'nm_v2_poll_n03_live_live_corner_blank', n03b: 'nm_v2_poll_n03_live_cheer_heart',
  n04a: 'nm_v2_poll_n04_notification_notice_blank', n04b: 'nm_v2_poll_n04_notification_waveform_panel_blank',
  n05a: 'nm_v2_poll_n05_soft_noise_onomatopoeia_blank', n05b: 'nm_v2_poll_n05_soft_noise_soft_noise_key',
  topic: 'nm_v2_show_topic_tag_blank', compression: 'nm_v2_show_compression_shard_key',
  surfaceN01: 'nm_v2_env_room_surface_contamination_n01_yellow_repeat',
  surfaceN02: 'nm_v2_env_room_surface_contamination_n02_emotion_fragments',
  surfaceN03: 'nm_v2_env_room_surface_contamination_n03_live_corner',
  surfaceN04: 'nm_v2_env_room_surface_contamination_n04_notification_strips',
  surfaceN05: 'nm_v2_env_room_surface_contamination_n05_soft_noise',
  conduit: 'nm_v2_env_linked_surface_fragments_conduit_trace',
  glass: 'nm_v2_env_linked_surface_fragments_glass_corner',
} as const;
type EffectName = keyof typeof effectNames;

export const effectsArtAssets = Object.values(effectNames).filter(name => inventory.some(a => a.key === name)).map(name => ({
  key: `generated:${name}`, url: `${import.meta.env.BASE_URL}${inventory.find(a => a.key === name)!.url.slice(1)}`,
}));

export function preloadEffectsArt(scene: Phaser.Scene): void {
  for (const asset of effectsArtAssets) {
    if (!scene.textures.exists(asset.key)) scene.load.image(asset.key, asset.url);
  }
}

/** Raster key art only. Scene supplies actual state and simulation seconds;
 * precise telegraphs, damage labels and selection geometry remain procedural. */
export class EffectsArt {
  readonly container: Phaser.GameObjects.Container;
  private readonly images: Phaser.GameObjects.Image[] = [];
  private cursor = 0;

  constructor(private readonly scene: Phaser.Scene, parent?: Phaser.GameObjects.Container) {
    this.container = scene.add.container(0, 0);
    parent?.add(this.container);
  }

  beginFrame(): void { this.cursor = 0; }

  endFrame(): void {
    for (let i = this.cursor; i < this.images.length; i++) this.images[i].setVisible(false);
  }

  hit(point: Point, remaining: number, kind?: DamageType): void {
    if (remaining <= 0) return;
    const alpha = Math.min(1, remaining / 0.3), spread = (1 - alpha) * 16;
    this.draw('hit', point, 48 + spread, 38 + spread * 0.6, alpha);
    if (kind) this.damage(point, kind, remaining);
  }

  damage(point: Point, kind: DamageType, remaining: number): void {
    if (remaining <= 0) return;
    const alpha = Math.min(1, remaining / 0.3), spread = (1 - alpha) * 12;
    this.draw(kind, point, 42 + spread, 42 + spread, alpha * 0.9);
  }

  panic(foot: Point, simulationTimeSec: number): void {
    const phase = Math.floor(simulationTimeSec * 5) % 4;
    this.draw('panic', { x: foot.x, y: foot.y - 70 }, 64 + phase * 2, 31, 0.86, 0.5, 0.65);
  }

  breach(rect: Rect, simulationTimeSec: number, anomalyId: AnomalyId): void {
    const phase = Math.floor(simulationTimeSec * 4) % 5;
    const width = Math.min(100, rect.width / 4);
    // Only room-edge decoration: never a collision boundary or attack warning.
    for (let i = 0; i < 3; i++) {
      const y = rect.y + 70 + i * Math.max(28, (rect.height - 100) / 3);
      const alpha = 0.42 + ((i + phase) % 3) * 0.12;
      this.draw('breach', { x: rect.x + 15 + width / 2, y }, width, 13, alpha);
      this.draw('breach', { x: rect.x + rect.width - 15 - width / 2, y: y + 4 }, width, 13, alpha, 0.5, 0.5, true);
    }
    // Polluted media stays in the upper wall area, clear of feet, doors and room labels.
    // Simulation time makes insertion motion freeze with the rest of the game.
    const pair: Record<AnomalyId, [EffectName, EffectName]> = {
      N01: ['n01a', 'n01b'], N02: ['n02a', 'n02b'], N03: ['n03a', 'n03b'],
      N04: ['n04a', 'n04b'], N05: ['n05a', 'n05b'],
    };
    const cycle = simulationTimeSec % 4;
    const visibility = Math.min(1, cycle * 3, (4 - cycle) * 3);
    const shift = (1 - visibility) * 12;
    this.draw(`surface${anomalyId}`, {x:rect.x + rect.width * 0.65, y:rect.y + 90}, 100, 50, 0.55);
    this.draw('conduit', {x:rect.x + rect.width - 50, y:rect.y + 48}, 70, 22, 0.45);
    this.draw('glass', {x:rect.x + 44, y:rect.y + 118}, 34, 36, 0.5);
    this.draw(pair[anomalyId][0], {x:rect.x + rect.width * 0.30 - shift, y:rect.y + 100}, 85, 34, visibility * 0.8);
    this.draw(pair[anomalyId][1], {x:rect.x + rect.width * 0.72 + shift, y:rect.y + 124}, anomalyId === 'N03' ? 28 : 82, 32, visibility * 0.7);
    this.draw('topic', {x:rect.x + rect.width * 0.50, y:rect.y + 78}, 76, 13, visibility * 0.5);
    this.draw('compression', {x:rect.x + rect.width - 45, y:rect.y + 160}, 48, 20, visibility * 0.45);
  }

  work(point: Point, simulationTimeSec: number): void {
    const phase = Math.floor(simulationTimeSec * 4) % 3;
    this.draw('work', { x: point.x, y: point.y - phase * 2 }, 21, 20, 0.55 + phase * 0.12, 0.5, 0.65);
  }

  /** Read-only evidence, including values that must freeze during a pause. */
  getState(): ReadonlyArray<{ texture: string; x: number; y: number; width: number; height: number; alpha: number }> {
    return this.images.filter(image => image.visible).map(image => ({
      texture: image.texture.key, x: image.x, y: image.y,
      width: image.displayWidth, height: image.displayHeight, alpha: image.alpha,
    }));
  }

  destroy(): void { this.container.destroy(true); this.images.length = 0; }

  private draw(name: EffectName, point: Point, width: number, height: number, alpha: number,
    originX = 0.5, originY = 0.5, flipX = false): void {
    const key = `generated:${effectNames[name]}`;
    if (!this.scene.textures.exists(key)) return;
    let image = this.images[this.cursor++];
    if (!image) {
      image = this.scene.add.image(0, 0, key);
      this.container.add(image);
      this.images.push(image);
    }
    image.setTexture(key).setPosition(point.x, point.y).setOrigin(originX, originY)
      .setDisplaySize(width, height).setAlpha(alpha).setFlipX(flipX).setVisible(true);
  }
}
