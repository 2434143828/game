import Phaser from 'phaser';
import { config } from './data/config';
import { ContainmentSliceScene } from './scenes/ContainmentSliceScene';
import { SliceController } from './debug/SliceController';
import { SliceHUD } from './ui/SliceHUD';
import { FacilityController } from './game/FacilityController';
import { ContainmentFacilityScene } from './scenes/ContainmentFacilityScene';
import { FacilityHUD } from './ui/FacilityHUD';
import './slice.css';
import './facility.css';

const frame = document.querySelector<HTMLElement>('#game-frame')!;
const resize = (): void => {
  const scale = Math.min(window.innerWidth / config.game.layout.width, window.innerHeight / config.game.layout.height);
  frame.style.transform = `translate(-50%, -50%) scale(${scale})`;
};
resize();
window.addEventListener('resize', resize);

// 旧单室切片保留作回归入口；默认先让玩家看到本轮完整五室演练。
const params = new URLSearchParams(window.location.search);
const legacy = params.get('slice') === '1';
export const controller = legacy ? new SliceController() : new FacilityController(params.get('mode') === 'campaign' ? 'campaign' : 'sandbox');
const root = document.querySelector<HTMLElement>('#interface')!;
const hud = controller instanceof SliceController ? new SliceHUD(root, controller) : new FacilityHUD(root, controller);
const scene = controller instanceof SliceController ? new ContainmentSliceScene(controller) : new ContainmentFacilityScene(controller);
export const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: config.game.layout.width,
  height: config.game.layout.height,
  backgroundColor: '#11171c',
  scene: [scene],
  render: { antialias: true, roundPixels: false },
  audio: { noAudio: true },
  banner: false,
});

// 仅供本地浏览器回归读取当前实例；生产构建会移除此分支。
if (import.meta.env.DEV) {
  Object.defineProperty(window, legacy ? '__sliceTest' : '__facilityTest', { value: { controller, scene, game }, configurable: true });
}

game.events.on(Phaser.Core.Events.POST_STEP, () => hud.render());

document.addEventListener('visibilitychange', () => {
  if (document.hidden && config.game.simulation.pauseOnHidden) {
    controller.simulation.setPaused(true);
    controller.notify('已因切换标签页暂停。返回后请手动继续。');
  }
});

