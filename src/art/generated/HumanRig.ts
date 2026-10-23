import Phaser from 'phaser';
import type { EmployeeRuntime, Point } from '../../../contracts/data-contract';
import type { HumanPose } from '../../scenes/facility/actors';
import { weaponById } from '../../data/config';
import assets from './nm-v2-personnel-manifest.json';

export const PERSONNEL_TEXTURES: readonly {key:string;url:string}[] = assets
  .map(asset => ({key:asset.key, url:asset.url}));
const part = (name: string): string => `nm_v2_agent_base_parts_${name}`;
const hairKeys = [
  'nm_v2_agent_hair_quiff_hair', 'nm_v2_agent_hair_side_fringe_hair',
  'nm_v2_agent_hair_bob_glasses_hair', 'nm_v2_agent_hair_ponytail_front_hair',
  'nm_v2_agent_hair_close_crop_hair', 'nm_v2_agent_hair_bun_front_hair',
];
// Measured from the generated cutouts. Each grip is registered to the real wrist;
// aimOffset compensates for the drawing's resting muzzle/blade direction.
const weaponMounts = {
  W00:{width:20,height:27,ox:0.78,oy:0.80,aimOffset:2.3},
  W01:{width:23,height:27,ox:0.30,oy:0.84,aimOffset:0.89},
  W02:{width:28,height:29,ox:0.19,oy:0.82,aimOffset:0.65},
  W03:{width:31,height:31,ox:0.36,oy:0.86,aimOffset:0.82},
  W04:{width:24,height:29,ox:0.47,oy:0.88,aimOffset:1.15},
  W05:{width:23,height:28,ox:0.21,oy:0.84,aimOffset:0.93},
};
interface Puppet { root: Phaser.GameObjects.Container; pieces: Map<string,Phaser.GameObjects.Image>; used:boolean }

/** Articulation changes only render transforms. All time, stride and combat phases are simulation-owned. */
export class HumanRig {
  readonly container: Phaser.GameObjects.Container;
  private puppets = new Map<string,Puppet>();
  constructor(private scene:Phaser.Scene, parent?:Phaser.GameObjects.Container) {
    this.container=scene.add.container(); parent?.add(this.container);
  }
  beginFrame():void { for(const p of this.puppets.values())p.used=false; }
  endFrame():void { for(const p of this.puppets.values())p.root.setVisible(p.used); }
  destroy():void { this.container.destroy(true);this.puppets.clear(); }
  getState():unknown {
    return [...this.puppets.entries()].filter(([,p])=>p.used).map(([id,p])=>({id,
      x:p.root.x,y:p.root.y,scaleX:p.root.scaleX,scaleY:p.root.scaleY,rotation:p.root.rotation,
      parts:[...p.pieces.entries()].filter(([,im])=>im.visible).map(([slot,im])=>({slot,key:im.texture.key,x:im.x,y:im.y,scaleX:im.scaleX,scaleY:im.scaleY,rotation:im.rotation})),
    }));
  }
  private image(p:Puppet,slot:string,key:string,x:number,y:number,w:number,h:number,angle=0,ox=0.5,oy=0.5):void {
    if(!this.scene.textures.exists(key))return;
    let im=p.pieces.get(slot);
    if(!im){im=this.scene.add.image(0,0,key);p.root.add(im);p.pieces.set(slot,im);}
    im.setTexture(key).setVisible(true).setPosition(x,y).setOrigin(ox,oy).setDisplaySize(w,h).setRotation(angle);
    p.root.bringToTop(im);
  }
  private bone(p:Puppet,slot:string,key:string,a:Point,b:Point,width:number):void {
    this.image(p,slot,key,a.x,a.y,width,Math.hypot(b.x-a.x,b.y-a.y)+2,Math.atan2(b.y-a.y,b.x-a.x)-Math.PI/2,0.5,0.08);
  }
  render(employee:EmployeeRuntime,pose:HumanPose):boolean {
    if(!this.scene.textures.exists(part('head'))||!this.scene.textures.exists(part('torso'))||!this.scene.textures.exists(part('shin_right')))return false;
    let p=this.puppets.get(employee.id);
    if(!p){p={root:this.scene.add.container(),pieces:new Map(),used:false};this.container.add(p.root);this.puppets.set(employee.id,p);}
    p.used=true;p.root.setVisible(true);this.container.bringToTop(p.root);
    for(const im of p.pieces.values())im.setVisible(false);
    const index=(Number(employee.id.slice(1))-1)%6;
    const panic=employee.status==='PANICKED',down=employee.status==='INCAPACITATED';
    const injured=employee.hp/employee.hpMax<0.4;
    const move=pose.moving?Math.sin(pose.stride):0;
    const breath=Math.sin(pose.time*2.2+index)*0.45;
    const lift=pose.moving&&!pose.climbing?Math.abs(Math.cos(pose.stride))*1.2:breath;
    const shake=panic?Math.sin(pose.time*19+index)*0.8:0;
    const hurt=pose.hurt>0?Math.sin(pose.hurt*23)*2:0;
    p.root.setPosition(pose.foot.x+shake,pose.foot.y).setScale(pose.facing,1).setRotation(0).setAlpha(1);
    // Downed puppet remains on its real foot location; the whole articulated body lies on the floor.
    if(down)p.root.setPosition(pose.foot.x-27,pose.foot.y-8).setRotation(Math.PI/2*pose.facing);
    const hip={x:-1,y:-24-lift+(injured?2:0)};
    const shoulder={x:(pose.workType?5:pose.moving?3:2)+(injured?3:0)-hurt,y:-44-lift+(injured?3:0)};
    const head={x:shoulder.x+3,y:shoulder.y-13};
    const feet=[-1,1].map(side=>({x:pose.climbing?side*8:side*move*9+side*3,y:-(pose.climbing?6+side*move*6:Math.max(0,side*move)*4)}));
    for(const [i,side] of [-1,1].entries()){
      const suffix=i?'right':'left';
      const knee={x:hip.x+side*move*4+(pose.climbing?8:2),y:pose.climbing?-16-side*move*3:-12};
      this.bone(p,`thigh-${suffix}`,part(`thigh_${suffix}`),hip,knee,7.5);
      this.bone(p,`shin-${suffix}`,part(`shin_${suffix}`),knee,feet[i],6.3);
      this.image(p,`boot-${suffix}`,part(`boot_${suffix}`),feet[i].x+2,feet[i].y-2.5,12,7,pose.climbing?side*0.22:0);
    }
    const farElbow={x:shoulder.x-6-move*4,y:shoulder.y+9};
    const farHand=pose.climbing?{x:-12,y:-53+move*7}:panic?{x:shoulder.x-13,y:shoulder.y-8+Math.sin(pose.time*9)*4}:{x:shoulder.x-6-move*7,y:shoulder.y+20};
    this.bone(p,'upper-far',part('upper_arm_left'),shoulder,farElbow,6.5);
    this.bone(p,'fore-far',part('forearm_left'),farElbow,farHand,5.4);
    this.image(p,'hand-far',part('hand_left'),farHand.x,farHand.y+1,5.5,7);
    this.image(p,'torso',part('torso'),shoulder.x,shoulder.y+10,23,26,(hip.x-shoulder.x)*-0.012);
    const armor=Number(employee.armorId.slice(1));
    // 岗位仅是制服外观；不新增职业属性或恢复效果。
    const roleId=['NMV2_ROLE_002','NMV2_ROLE_003','NMV2_ROLE_004','NMV2_ROLE_005'][index%4];
    const armorAssets=assets.filter(a=>a.id===(armor>0?`EQ_A0${armor}`:roleId));
    for(const [i,a] of armorAssets.entries()){
      const k=a.key;
      if(k.endsWith('shoulder_near'))continue;
      if(k.includes('torso'))this.image(p,`armor-${i}`,k,shoulder.x,shoulder.y+10,24,27);
      else if(k.endsWith('shoulder_far'))this.image(p,`armor-${i}`,k,shoulder.x-7,shoulder.y+2,10,10);
      else if(k.endsWith('collar'))this.image(p,`armor-${i}`,k,shoulder.x,shoulder.y,19,9);
      else {
        const long=k.endsWith('long');
        this.image(p,`armor-${i}`,k,shoulder.x-8+(long?-2:3),shoulder.y+11,long?8:7,long?28:18,Math.sin(pose.time*2.2)*0.03);
      }
    }
    this.image(p,'head',part('head'),head.x,head.y,25,29,panic?Math.sin(pose.time*6)*0.06:injured?0.12:0);
    const faceState=down?'incapacitated':panic?'panic':pose.hurt>0||injured?'hurt':'neutral';
    const face=assets.find(a=>a.id==='STA_009'&&a.key.includes(faceState))??assets.find(a=>a.id==='STA_009');
    if(face)this.image(p,'face',face.key,head.x+2.5,head.y-1.5,17,16);
    const hair=assets.find(a=>a.id===`STA_${String(index+3).padStart(3,'0')}`&&a.key.endsWith('_hair'))?.key??hairKeys[index];
    this.image(p,'hair',hair,head.x-1,head.y-(index===4?11:10),29,index===4?16:21);
    const hairExtras=assets.filter(a=>a.id===`STA_${String(index+3).padStart(3,'0')}`&&a.key!==hair);
    for(const [i,a] of hairExtras.entries()){
      const glasses=/glasses/.test(a.key),bun=/rear_bun/.test(a.key);
      this.image(p,`hair-extra-${i}`,a.key,head.x+(glasses?3:-12),head.y+(glasses?-2:bun?-14:-5),glasses?17:bun?11:12,glasses?7:bun?11:18);
      p.pieces.get(`hair-extra-${i}`)?.setFlipX(!glasses&&!bun);
    }
    let elbow={x:shoulder.x+7-move*3,y:shoulder.y+10};
    let hand={x:shoulder.x+12-move*6,y:shoulder.y+21};let angle=-0.45;
    if(pose.climbing){elbow={x:10,y:-40-move*5};hand={x:14,y:-55-move*7};}
    else if(panic){elbow={x:shoulder.x+13,y:shoulder.y+3};hand={x:head.x+17,y:head.y-4+Math.sin(pose.time*11)*4};}
    else if(pose.workType){const beat=Math.sin(pose.time*(pose.workType==='SOOTHE'?2.4:5));elbow={x:shoulder.x+10,y:shoulder.y+10};hand={x:shoulder.x+22+beat*3,y:shoulder.y+4+beat*3};}
    else if(employee.attackPhase==='WINDUP'&&employee.windupEndsAtSec!==null){const progress=Phaser.Math.Clamp(1-(employee.windupEndsAtSec-pose.time)/weaponById[employee.weaponId].windupSec,0,1);elbow={x:shoulder.x-8,y:shoulder.y};hand={x:shoulder.x-(16-progress*6),y:shoulder.y-10};angle=-1.9+progress*0.7;}
    else if(pose.impactRemaining>0){elbow={x:shoulder.x+12,y:shoulder.y+6};hand={x:shoulder.x+27,y:shoulder.y+5};angle=0.35;}
    else if(injured){elbow={x:shoulder.x+9,y:shoulder.y+14};hand={x:shoulder.x+3,y:shoulder.y+14};}
    this.bone(p,'upper-near',part('upper_arm_right'),shoulder,elbow,6.6);
    const nearShoulder=armorAssets.find(a=>a.key.endsWith('shoulder_near'));
    if(nearShoulder)this.image(p,'armor-shoulder-near',nearShoulder.key,shoulder.x+5,shoulder.y+3,11,11);
    this.bone(p,'fore-near',part('forearm_right'),elbow,hand,5.6);
    if(pose.workType==='OBSERVE')this.image(p,'tablet',part('tablet'),hand.x+3,hand.y+4,19,13,-0.12);
    else if(!pose.workType&&!pose.climbing&&!panic&&!down){
      const weapon=employee.weaponId==='W00'?part('starter_baton'):assets.find(a=>a.id===`EQ_${employee.weaponId}`)?.key ?? part('starter_baton');
      const mount=weaponMounts[weapon===part('starter_baton')?'W00':employee.weaponId];
      if(weapon)this.image(p,'weapon',weapon,hand.x,hand.y,mount.width,mount.height,angle+mount.aimOffset,mount.ox,mount.oy);
    }
    this.image(p,'hand-near',part('hand_right'),hand.x,hand.y+1,6,7);
    for(const im of p.pieces.values()) {
      if(pose.hurt>0&&im.visible)im.setTint(0xffddd3);else im.clearTint();
    }
    return true;
  }
}
