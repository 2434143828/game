import Phaser from 'phaser';
import type { AnomalyId } from '../../../contracts/data-contract';
import type { EncounterState } from '../../v3/model';

/** Independent exterior locations. These images do not own collision or combat state. */
export const FIELD_THEMES: Record<AnomalyId, { file: string; name: string; medium: string; color: number; messages: string[] }> = {
  N01: { file: 'n01-mall.png', name: '商场中庭 · 亲子快闪活动', medium: '拍照 / 模仿 / 评论复读', color: 0xffcf70, messages: ['我是奶龙', '可爱！', '我是奶龙', '想rua'] },
  N02: { file: 'n02-community.png', name: '老旧居民区 · 棋牌室外', medium: '口角 / 表情包 / 情绪扩散', color: 0xf19582, messages: ['急了！', '别吵', '破防了', '！！'] },
  N03: { file: 'n03-pet-park.png', name: '城市宠物公园 · 直播草坪', medium: '直播 / 应援 / 声浪', color: 0xff91bb, messages: ['♥ LIVE', '汪汪汪', '神中神', '♥ 太可爱了'] },
  N04: { file: 'n04-transit.png', name: '地铁连通道 · 广播覆盖区', medium: '通知 / 循环播放 / 广播侵入', color: 0xffd063, messages: ['叮咚', '广播循环中', '叮咚！', '↻ 通知重复'] },
  N05: { file: 'n05-nursery.png', name: '商场母婴区 · 儿童休息角', medium: '哭闹 / 安抚 / 情绪共鸣', color: 0xd4bbef, messages: ['咕咕嘎嘎', '安抚失败', '呜哇……', '咕咕嘎嘎'] },
};

export class FieldArt {
  readonly container: Phaser.GameObjects.Container;
  private readonly background: Phaser.GameObjects.Image;
  private readonly graphics: Phaser.GameObjects.Graphics;
  private readonly labels: Phaser.GameObjects.Text[] = [];
  private textCursor = 0;
  private current: { theme: AnomalyId; texture: string; loaded: boolean; simulationTimeSec: number; windup: boolean; pulse: number } | null = null;

  static key(id: AnomalyId): string { return `field-v1:${id}`; }
  static preload(scene: Phaser.Scene): void {
    for (const [id, theme] of Object.entries(FIELD_THEMES)) {
      const key = FieldArt.key(id as AnomalyId);
      if (!scene.textures.exists(key)) scene.load.image(key, `${import.meta.env.BASE_URL}art/field-v1/${theme.file}`);
    }
  }
  constructor(private readonly scene: Phaser.Scene) {
    this.container = scene.add.container().setVisible(false);
    this.background = scene.add.image(0, 55, '__WHITE').setOrigin(0).setDisplaySize(1300, 650);
    this.graphics = scene.add.graphics();
    this.container.add([this.background, this.graphics]);
  }
  private text(value: string, x: number, y: number, size: number, color: string, alpha = 1): void {
    let label = this.labels[this.textCursor++];
    if (!label) {
      label = this.scene.add.text(0, 0, '', { fontFamily: 'Microsoft YaHei,sans-serif', fontSize: size, color, stroke: '#17282e', strokeThickness: 3 });
      this.container.add(label); this.labels.push(label);
    }
    label.setVisible(true).setPosition(x, y).setText(value).setFontSize(size).setColor(color).setAlpha(alpha);
  }
  render(encounter: EncounterState | null, time: number): void {
    const active = encounter?.mode === 'CAPTURE';
    this.container.setVisible(active);
    if (!active || !encounter) { this.current = null; return; }
    const id = encounter.targetAnomalyId, theme = FIELD_THEMES[id], texture = FieldArt.key(id);
    const loaded = this.scene.textures.exists(texture);
    this.background.setVisible(loaded);
    if (loaded) this.background.setTexture(texture).setDisplaySize(1300, 650);
    const windup = !encounter.result && encounter.enemies.some(enemy => enemy.suppressionHp > 0 && enemy.attackPhase === 'WINDUP');
    const pulse = (1 + Math.sin(time * (windup ? 8 : 1.7))) / 2;
    this.current = { theme: id, texture, loaded, simulationTimeSec: time, windup, pulse };
    const g = this.graphics; g.clear(); this.textCursor = 0;
    if (!loaded) { g.fillStyle(0x202b30).fillRect(0, 55, 1300, 650); this.text('外勤素材加载失败', 520, 240, 25, '#ffb4a4'); }

    // All pollution animation reads the simulation clock, including while paused.
    // Decorative signs stay out of the y296–510 health/target/actor band.
    g.fillStyle(0x18262e, 0.91).fillRoundedRect(30, 85, 540, 66, 8);
    g.lineStyle(2, theme.color, 0.75).lineBetween(45, 100, 45, 135);
    this.text(`外勤抓捕 / ${theme.name}`, 59, 96, 19, '#f2ece1');
    this.text(theme.medium, 60, 124, 12, '#c5d3d5');
    const color = `#${theme.color.toString(16).padStart(6, '0')}`;
    for (let i = 0; i < 4; i++) {
      const x = [90, 355, 690, 1000][i] + Math.sin(time * 0.55 + i) * 8;
      const y = [180, 228, 175, 230][i] + Math.sin(time * 0.8 + i * 1.3) * 5;
      const width = [150, 170, 160, 180][i];
      const alpha = windup ? 0.78 + pulse * 0.18 : 0.58;
      g.fillStyle(0x202630, alpha).fillRoundedRect(x, y, width, 35, id === 'N04' ? 3 : 12);
      g.lineStyle(windup ? 2 : 1, theme.color, alpha).strokeRoundedRect(x, y, width, 35, id === 'N04' ? 3 : 12);
      this.text(theme.messages[i], x + 13, y + 7, 16, color, windup ? 1 : 0.87);
      if (id === 'N02') g.lineStyle(2, theme.color, alpha).lineBetween(x + 27, y + 35, x + 16, y + 44);
    }
    if (id === 'N03' || id === 'N05') {
      for (let i = 0; i < 3; i++) {
        const radius = 16 + ((time * 17 + i * 17) % 52);
        g.lineStyle(2, theme.color, (1 - (radius - 16) / 52) * (windup ? 0.8 : 0.3)).strokeEllipse(1205, 190, radius, radius * 0.65);
      }
    }
    if (id === 'N04' || id === 'N05') {
      for (let i = 0; i < 35; i++) {
        const h = (3 + Math.abs(Math.sin(time * 3.2 + i * 0.8)) * (windup ? 20 : 9));
        g.lineStyle(2, theme.color, 0.7).lineBetween(750 + i * 11, 130 - h, 750 + i * 11, 130 + h);
      }
    }
    // Location markers describe the existing single continuous combat lane.
    // Objects in the image are perimeter decoration, never extra hidden colliders.
    const zones = [{ x: 45, w: 240, text: '进入区', color: 0x9bdcc8 }, { x: 323, w: 480, text: '抓捕作业带', color: 0xf4e1ba }, { x: 840, w: 415, text: '异常活动核心', color: theme.color }];
    for (const zone of zones) {
      g.fillStyle(0x18262e, 0.82).fillRoundedRect(zone.x, 562, zone.w, 37, 5);
      g.lineStyle(2, zone.color, 0.8).lineBetween(zone.x + 12, 562, zone.x + zone.w - 12, 562);
      this.text(zone.text, zone.x + 18, 571, 14, '#efeee5');
    }
    this.text('边缘设施 / 非通行区', 47, 631, 12, '#d3dbd7', 0.9);
    if (windup) this.text('异常污染增强 · 敌方正在蓄力', 830, 620, 16, color);
    for (let i = this.textCursor; i < this.labels.length; i++) this.labels[i].setVisible(false);
  }
  getState(): unknown { return this.current ? { ...this.current, background: { x: 0, y: 55, width: 1300, height: 650 }, groundY: 500 } : null; }
}
