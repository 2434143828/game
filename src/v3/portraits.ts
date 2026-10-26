import type { AnomalyId } from '../../contracts/data-contract';
import { escape } from '../ui/format';

type Part = readonly [name: string, x: number, y: number, width: number, height: number, angle?: number, originX?: number, originY?: number];
const slugs: Record<AnomalyId, string> = {N01:'nailong',N02:'maodie',N03:'big_dog',N04:'dingdong_chicken',N05:'gugu_gaga'};

/** Static UI poses copied from CreatureRig's idle t=0 transforms and draw order.
 * Reuse the live creature's cutout parts; this is a portrait, never a simulated entity.
 * Angles are radians, origins and nonuniform display sizes match Phaser Image.
 */
const poses: Record<AnomalyId, readonly Part[]> = {
  N01: [
    ['tail',-26,-24,42,31,0,.85,.5],['arm_left',-16,-39,16,28,-.12,.5,.1],
    ['body',0,-35,55,59],['foot_left',-15,-5,27,12],['foot_right',15,-5,28,12],
    ['head_neck',7,-70,72,64],['eyes',14,-75,41,24],['muzzle',14,-54,49,19],
    ['arm_right',20,-39,18,24,0,.5,.1],
  ],
  N02: [
    ['tail',-34,-29,32,48,0,.8,.88],['hind_foot_left',-31,-16,23,32],
    ['hind_foot_right',-17,-16,23,32],['arm_left',15,-25,15,27,0,.5,.08],
    ['body',-8,-31,73,44],['head_ears',23,-55,61,57],['calm_face',32,-43,37,23],
    ['arm_right',31,-25,17,28,0,.5,.08],
  ],
  N03: [
    ['tail',-34,-44,35,35,0,.9,.6],['hind_leg',-19,-37,19,36,0,.5,0],
    ['front_leg',26,-39,17,38,0,.5,0],['body',-7,-46,78,49],
    ['hind_leg',-30,-38,22,39,0,.5,0],['front_leg',14,-42,20,43,0,.5,0],
    ['collar_tag',25,-51,39,17,.1],['head_ears',27,-80,73,67],['eyes',36,-87,35,24],
    ['lower_muzzle',36,-62,36,10],['upper_muzzle',36,-69,44,19],['tongue',43,-61,10,12,0,.5,.1],
  ],
  N04: [
    ['tail_feathers',-22,-39,38,40,0,.85,.65],['leg_left',-12,-21,20,23,0,.5,0],
    ['leg_right',12,-21,20,23,0,.5,0],['body',0,-40,64,61],['head_neck',8,-73,56,58],
    ['comb',7,-100,39,24],['upper_beak',28,-69,24,12,0,.1,.5],
    ['lower_beak_wattle',28,-64,22,19,0,.1,.2],['wing',-10,-43,38,27,0,.85,.35],
    ['notification_badge',7,-35,24,25],
  ],
  N05: [
    ['foot_left',-13,-4,29,12],['foot_right',15,-4,30,12],['flipper_left',19,-44,32,21,.95,.1,.5],
    ['body_belly',0,-33,65,55],['head_face_patch',3,-76,69,59],['eyes',12,-75,33,21],
    ['upper_beak',20,-60,16,7],['lower_beak',20,-55,15,5],['scarf_collar',2,-50,58,16],
    ['scarf_short',15,-46,10,20,-.12,.5,0],['scarf_long',4,-46,14,27,.12,.5,0],
    ['flipper_right',-24,-43,33,21,-.9,.85,.5],
  ],
};

export function creaturePortrait(id: AnomalyId, className = '', label = ''): string {
  const parts=poses[id].map(([name,x,y,width,height,angle=0,ox=.5,oy=.5])=>{
    const url=`${import.meta.env.BASE_URL}art/nm-v2/abnormalities/nm_v2_abn_${slugs[id]}_base_parts_${name}.png`;
    return `<image href="${url}" x="${-width*ox}" y="${-height*oy}" width="${width}" height="${height}" preserveAspectRatio="none" transform="translate(${x} ${y}) rotate(${angle*180/Math.PI})"/>`;
  }).join('');
  return `<svg class="v06-creature-portrait ${escape(className)}" viewBox="-72 -123 144 132" xmlns="http://www.w3.org/2000/svg" ${label?`role="img" aria-label="${escape(label)}"`:'aria-hidden="true"'} focusable="false"><g transform="scale(${id==='N03'?1.06:1})">${parts}</g></svg>`;
}
