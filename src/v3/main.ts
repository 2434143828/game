import Phaser from 'phaser';
import { largeFacilityNavigation } from '../simulation/graphNavigation';
import { V3Simulation } from './engine';
import { V3Scene } from './Scene';
import { V3HUD } from './HUD';
import { loadV3, saveV3 } from './save';
import { createFieldPreview, fieldPreviewTarget } from './fieldPreview';
import { createCardArtPreview, cardArtPreviewTarget } from './cardArtPreview';
import '../slice.css';
import './style.css';
import './hud-v06.css';
import './hud-v07.css';

const frame=document.querySelector<HTMLElement>('#game-frame')!;
const resize=():void=>{frame.style.transform=`translate(-50%, -50%) scale(${Math.min(innerWidth/1600,innerHeight/900)})`;};
resize();addEventListener('resize',resize);
const previewTarget=fieldPreviewTarget(location.search,import.meta.env.DEV);
const cardPreviewTarget=cardArtPreviewTarget(location.search,import.meta.env.DEV);
const isArtPreview=Boolean(previewTarget||cardPreviewTarget);
// The preview branch must not even read storage: no migration, offline payout,
// autosave or pagehide write may touch the player's ongoing campaign.
const restored=isArtPreview?{status:'EMPTY' as const,state:undefined,message:'美术调试预览，不保存进度'}:loadV3(localStorage,Date.now());
// Corrupt/unrecognized saves are preserved. Such a session is playable but will not autosave over the source.
const persistenceEnabled=!isArtPreview&&restored.status!=='BLOCKED';
export const simulation=cardPreviewTarget?createCardArtPreview(cardPreviewTarget,largeFacilityNavigation):previewTarget?createFieldPreview(previewTarget,largeFacilityNavigation):new V3Simulation(restored.state,{navigation:largeFacilityNavigation});
let hud:V3HUD;
let lastSavedSimulationTime=simulation.state.simulationTimeSec;
let lastResult:string|null=null;
const persist=():void=>{
  if(isArtPreview)return;
  if(!persistenceEnabled){hud?.notify(`本次不覆盖存档：${restored.message}`);return;}
  const result=saveV3(localStorage,simulation.state,Date.now());
  if(!result.ok){hud?.notify(result.message);return;}
  lastSavedSimulationTime=simulation.state.simulationTimeSec;
};
export const scene=new V3Scene(simulation,{
  selectRoom:id=>hud.selectRoom(id),selectEmployee:id=>hud.selectEmployee(id),target:id=>hud.target(id),notify:message=>hud.notify(message),cardTargetKind:()=>hud.cardTargetKind(),cardPresentation:()=>hud.cardPresentation(),
});
hud=new V3HUD(document.querySelector<HTMLElement>('#interface')!,simulation,scene,persist);
if(isArtPreview){
  const badge=document.createElement('div');badge.id='v3-field-preview';badge.textContent=`${cardPreviewTarget?`${cardPreviewTarget} 卡牌美术调试预览`:`${previewTarget} 美术调试预览`}，不保存进度`;
  Object.assign(badge.style,{position:'absolute',left:'22px',top:'42px',zIndex:'50',fontSize:'14px',color:'#ffe6b3',background:'#30271ee8',padding:'4px 12px',border:'1px solid #af8b50',pointerEvents:'none'});
  frame.append(badge);
}
hud.notify(restored.message==='没有本地存档。'?'奶龙 I 阶已收容。先配置三人装备，主动挑战后可提升产能并解锁外勤。':restored.message);
export const game=new Phaser.Game({type:Phaser.AUTO,parent:'game',width:1600,height:900,backgroundColor:'#101b24',scene:[scene],render:{antialias:true,roundPixels:false},audio:{noAudio:true},banner:false});
if(import.meta.env.DEV)Object.defineProperty(window,'__v3Test',{value:{simulation,scene,game},configurable:true});
game.events.on(Phaser.Core.Events.POST_STEP,()=>{
  hud.render();
  const result=simulation.state.encounter?.result??null;
  if(simulation.state.simulationTimeSec-lastSavedSimulationTime>=5||result!==lastResult)persist();
  lastResult=result;
});
// A crash/reload during an encounter is deliberately restored as abandonment, never as a free victory.
addEventListener('pagehide',persist);
document.addEventListener('visibilitychange',()=>{if(document.hidden){
  // Only active combat turns a hidden tab into an explicit tactical pause. Stable-facility
  // saves retain the player's pause intent so normal close/reopen can settle offline income.
  if(simulation.state.encounter){simulation.setPaused(true);hud.notify('战斗切换页面已暂停；返回后手动继续。');}
  persist();
}});
persist();
