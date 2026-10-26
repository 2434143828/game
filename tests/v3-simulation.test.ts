import { describe, expect, it } from 'vitest';
import { V3Simulation } from '../src/v3/engine';
import { cardById, v3Config, weaponCards } from '../src/v3/config';
import type { CombatCardInstance } from '../src/v3/model';
import type { AnomalyId, WeaponId } from '../contracts/data-contract';
import { anomalyById } from '../src/data/config';

const run=(s:V3Simulation,seconds:number):void=>{for(let i=0;i<Math.round(seconds/.05);i++)s.step();};
function battle():V3Simulation{const s=new V3Simulation();expect(s.startEncounter('BREACH_CHALLENGE','N01').ok).toBe(true);return s;}
function handCard(s:V3Simulation,id:string,owner='E01'):CombatCardInstance{
  const d=s.state.encounter!.deck;let card=[...d.hand,...d.drawPile,...d.discardPile].find(c=>c.cardId===id&&c.ownerId===owner)!;
  if(!card)throw new Error(`Missing ${id}`);
  d.hand=d.hand.filter(c=>c.instanceId!==card.instanceId);d.drawPile=d.drawPile.filter(c=>c.instanceId!==card.instanceId);d.discardPile=d.discardPile.filter(c=>c.instanceId!==card.instanceId);
  if(d.hand.length===4)d.drawPile.push(d.hand.pop()!);d.hand.push(card);return card;
}
function settleCard(s:V3Simulation,id:string,target?:string):void{const card=handCard(s,id),d=s.state.encounter!.deck;d.globalCooldown=0;const def=cardById[id];const owner=s.state.employees.find(e=>e.id===card.ownerId)!;const enemy=s.state.encounter!.enemies[0];owner.location={...enemy.location,x:enemy.location.x-40};if(def.target==='ALLY')s.state.employees.find(e=>e.id===target)!.location={...owner.location};expect(s.queueCard(card.instanceId,target??(def.target==='SELF'?owner.id:def.target==='TEAM'?'TEAM':enemy.id)).ok).toBe(true);run(s,def.windupSec+.1);expect(d.discardPile.some(c=>c.instanceId===card.instanceId)).toBe(true);}

describe('v0.3 production and progression',()=>{
  it('runs ten minutes with passive income and never automatically breaches',()=>{const s=new V3Simulation();run(s,600);expect(s.state.wallet).toBeCloseTo(70,6);expect(s.state.encounter).toBeNull();expect(s.state.rooms[0].state).toBe('STABLE');});
  it('halts only challenged production and freezes whole state while paused',()=>{const s=new V3Simulation();Object.assign(s.state.rooms[1],{owned:true,rank:1,state:'STABLE'});s.startEncounter('BREACH_CHALLENGE','N01');run(s,1);expect(s.state.wallet).toBeCloseTo(50.05);s.setPaused(true);const before=JSON.stringify(s.state);run(s,10);s.update(500);expect(JSON.stringify(s.state)).toBe(before);});
  it('victory increments once, restores production and cannot duplicate reward',()=>{const s=battle();s.state.encounter!.enemies[0].suppressionHp=0;s.step();expect(s.state.rooms[0].rank).toBe(2);run(s,10);expect(s.state.rooms[0].rank).toBe(2);expect(s.finishEncounter().ok).toBe(true);expect(s.productionPerMinute()).toBe(4);expect(s.finishEncounter().ok).toBe(false);});
  it('capture checks gate and cost; loss neither grants nor duplicates ownership',()=>{const s=new V3Simulation();expect(s.startEncounter('CAPTURE','N02').ok).toBe(false);s.state.rooms[0].rank=2;expect(s.startEncounter('CAPTURE','N02').ok).toBe(true);expect(s.state.wallet).toBe(0);for(const e of s.state.employees)e.hp=0;s.step();expect(s.state.encounter!.result).toBe('DEFEAT');expect(s.state.rooms[1].owned).toBe(false);s.finishEncounter();expect(s.startEncounter('CAPTURE','N02').ok).toBe(false);});
  it('capture success opens room and one official equipment copy',()=>{const s=new V3Simulation();s.state.rooms[0].rank=2;s.startEncounter('CAPTURE','N02');s.state.encounter!.enemies[0].suppressionHp=0;s.step();expect(s.state.rooms[1]).toMatchObject({owned:true,rank:1,state:'STABLE'});expect(s.state.ownedWeapons).toContain('W02');s.finishEncounter();expect(s.startEncounter('CAPTURE','N02').ok).toBe(false);expect(s.equip('E01','W02','A02',1).ok).toBe(true);expect(s.equip('E02','W02','A02',1).ok).toBe(false);});
  it('abandon is not a win and a completed result cannot be abandoned again',()=>{const s=battle();s.abandonEncounter();expect(s.state.rooms[0].rank).toBe(1);expect(s.state.rooms[0].state).toBe('STABLE');s.finishEncounter();s.startEncounter('BREACH_CHALLENGE','N01');s.state.encounter!.enemies[0].suppressionHp=0;s.step();s.abandonEncounter();expect(s.state.rooms[0].rank).toBe(2);});
});

describe('v0.4 result card progression data',()=>{
  it('derives the next target from live room state and prerequisites',()=>{
    const s=new V3Simulation();
    expect(s.nextTarget()).toMatchObject({anomalyId:'N01',mode:'BREACH_CHALLENGE',currentRank:1,nextRank:2,available:true});
    s.state.rooms[0].rank=2;
    expect(s.nextTarget()).toMatchObject({anomalyId:'N02',mode:'CAPTURE',currentRank:0,nextRank:1,available:true,requirement:null});
    s.state.wallet=100;
    expect(s.nextTarget()).toMatchObject({anomalyId:'N02',mode:'CAPTURE',available:true,energyCost:50});
    s.state.rooms[0].rank=3;s.state.wallet=0;
    expect(s.nextTarget()).toMatchObject({anomalyId:'N02',mode:'CAPTURE',currentRank:0,nextRank:1,available:false});
    s.state.wallet=100;
    expect(s.nextTarget()).toMatchObject({anomalyId:'N02',mode:'CAPTURE',available:true,energyCost:50});
  });
  it('exposes real victory deltas and keeps the summary reward-free on repeated reads',()=>{
    const s=new V3Simulation();
    expect(s.startEncounter('BREACH_CHALLENGE','N01').ok).toBe(true);
    const enc=s.state.encounter!;enc.enemies[0].suppressionHp=0;s.step();
    const summary=s.victorySummary();
    expect(summary).toMatchObject({result:'VICTORY',anomalyId:'N01',previousRank:1,currentRank:2,productionBefore:2,productionAfter:4,egoTier:2});
    expect(summary?.rewards.some(item=>item.includes('I → II'))).toBe(true);
    const again=s.victorySummary();
    expect(again).toEqual(summary);
    expect(s.state.rooms[0].rank).toBe(2);
    expect(s.finishEncounter().ok).toBe(true);
  });
});

/** Deliberate combat fixture: all damage still goes through real queued card actions/AI impacts. */
function isolatedCardBattle(weapon:WeaponId):V3Simulation {
  const s=new V3Simulation();s.state.employees[0].weaponId=weapon;s.startEncounter('BREACH_CHALLENGE','N01');
  s.state.employees.forEach((e,i)=>{e.location={...e.location,x:800-i*40};e.nextAttackStartAtSec=1e9;e.sp=40;});
  s.state.encounter!.enemies.forEach((n,i)=>{n.location.x=[850,900,1130][i];n.nextAttackStartAtSec=1e9;n.suppressionHp=1000;n.suppressionHpMax=1000;});
  return s;
}
function executeIsolated(s:V3Simulation,id:string,target?:string):void {
  const c=handCard(s,id),def=cardById[id],enc=s.state.encounter!;
  expect(s.queueCard(c.instanceId,target??(def.target==='SELF'?c.ownerId:def.target==='TEAM'?'TEAM':def.target==='ALLY'?'E02':enc.enemies[0].id)).ok).toBe(true);
  for(let i=0;i<200&&enc.deck.pendingCast;i++)s.step();
  expect(enc.deck.pendingCast).toBeNull();expect(enc.deck.discardPile.some(x=>x.instanceId===c.instanceId)).toBe(true);
}
describe('v0.3 all 18 card numerical and temporal contracts',()=>{
  const damages:[WeaponId,string,number,'RED'|'WHITE'|'BLACK',boolean][]=[
    ['W00','T01',8,'RED',false],['W01','N01_1',14,'WHITE',false],
    ['W02','N02_1',20,'RED',false],['W03','N03_1',12,'RED',true],
    ['W03','N03_3',26,'RED',true],['W04','N04_1',12,'BLACK',false],['W05','N05_1',10,'WHITE',false],
  ];
  it.each(damages)('%s %s applies its exact damage once with actual range and AOE membership',(weapon,id,amount,type,aoe)=>{
    const s=isolatedCardBattle(weapon);executeIsolated(s,id);const enemies=s.state.encounter!.enemies;
    expect(1000-enemies[0].suppressionHp).toBeCloseTo(amount*anomalyById.N01.resistances[type]);
    expect(1000-enemies[1].suppressionHp).toBeCloseTo(aoe?amount*anomalyById.N01.resistances[type]:0);
    expect(enemies[2].suppressionHp).toBe(1000);
    expect(s.state.logs.filter(e=>e.kind==='CARD')).toHaveLength(1);
  });
  it.each([['W00','T02',.2],['W02','N02_2',.4]]as const)('%s %s reduces actual incoming white damage and expires at 3 seconds',(weapon,id,reduction)=>{
    const s=isolatedCardBattle(weapon);executeIsolated(s,id);const e=s.state.employees[0],n=s.state.encounter!.enemies[0];
    expect(e.blockUntilSec-s.state.simulationTimeSec).toBeCloseTo(3);
    n.targetEmployeeId=e.id;n.windupEndsAtSec=s.state.simulationTimeSec+.05;n.warningRangePx=100;n.attackPhase='WINDUP';const before=e.sp;s.step();
    expect(before-e.sp).toBeCloseTo(8*(1-reduction));
    e.nextAttackStartAtSec=1e9;n.nextAttackStartAtSec=1e9;run(s,3);
    n.targetEmployeeId=e.id;n.windupEndsAtSec=s.state.simulationTimeSec+.05;const after=e.sp;s.step();expect(after-e.sp).toBeCloseTo(8);
  });
  it.each([['W00','T03',6,false],['W05','N05_2',18,false],['W05','N05_3',10,true]]as const)('%s %s restores exact SP to only the intended employees',(weapon,id,amount,team)=>{
    const s=isolatedCardBattle(weapon);executeIsolated(s,id);
    expect(s.state.employees.map(e=>e.sp)).toEqual(team?[40+amount,40+amount,40+amount]:[40,40+amount,40]);
  });
  it('N01_2 cancels an actual telegraph and applies exactly 2 seconds control',()=>{const s=isolatedCardBattle('W01'),n=s.state.encounter!.enemies[0];n.windupEndsAtSec=1.2;n.attackPhase='WINDUP';executeIsolated(s,'N01_2');expect(n.windupEndsAtSec).toBeNull();expect(n.stunnedUntilSec-s.state.simulationTimeSec).toBeCloseTo(2);expect(s.state.employees[0].sp).toBe(40);});
  it('N01_3 copies exactly half of the prior successful damage without recursive records',()=>{const s=isolatedCardBattle('W01'),enc=s.state.encounter!;executeIsolated(s,'N01_1');enc.deck.globalCooldown=0;s.state.employees[0].nextAttackStartAtSec=1e9;const hp=enc.enemies[0].suppressionHp,record=structuredClone(enc.lastAttackCard);executeIsolated(s,'N01_3');expect(hp-enc.enemies[0].suppressionHp).toBeCloseTo(7*anomalyById.N01.resistances.WHITE);expect(enc.lastAttackCard).toEqual(record);});
  it('N02_3 retaliates for 22 red damage exactly once upon a real incoming attack',()=>{const s=isolatedCardBattle('W02');executeIsolated(s,'N02_3');const e=s.state.employees[0],n=s.state.encounter!.enemies[0];expect(e.counterUntilSec-s.state.simulationTimeSec).toBeCloseTo(5);n.targetEmployeeId=e.id;n.warningRangePx=100;for(let i=0;i<2;i++){n.windupEndsAtSec=s.state.simulationTimeSec+.05;s.step();}expect(1000-n.suppressionHp).toBeCloseTo(22*anomalyById.N01.resistances.RED);expect(s.state.logs.filter(x=>x.kind==='COUNTER')).toHaveLength(1);});
  it('N03_2 moves the actual target 100px and cancels its attack',()=>{const s=isolatedCardBattle('W03'),n=s.state.encounter!.enemies[0];n.windupEndsAtSec=1.2;const x=n.location.x;executeIsolated(s,'N03_2');expect(n.location.x-x).toBeGreaterThan(95);expect(n.location.x-x).toBeLessThanOrEqual(100);expect(n.windupEndsAtSec).toBeNull();});
  it('N04_2 delays the pending impact by exactly 2 seconds',()=>{const s=isolatedCardBattle('W04'),n=s.state.encounter!.enemies[0];n.windupEndsAtSec=5;executeIsolated(s,'N04_2');expect(n.windupEndsAtSec).toBe(7);expect(s.state.employees[0].sp).toBe(40);});
  it('N04_3 enhances exactly one attack card by 30%, not auto attacks or later cards',()=>{const s=isolatedCardBattle('W04'),enc=s.state.encounter!;executeIsolated(s,'N04_3');expect(enc.nextAttackMultiplier).toBe(1.3);enc.deck.globalCooldown=0;executeIsolated(s,'N04_1');expect(1000-enc.enemies[0].suppressionHp).toBeCloseTo(12*1.3*anomalyById.N01.resistances.BLACK);expect(enc.nextAttackMultiplier).toBe(1);const c=enc.deck.discardPile.find(x=>x.cardId==='N04_1')!;enc.deck.discardPile=enc.deck.discardPile.filter(x=>x!==c);enc.deck.drawPile.push(c);enc.deck.globalCooldown=0;const before=enc.enemies[0].suppressionHp;executeIsolated(s,'N04_1');expect(before-enc.enemies[0].suppressionHp).toBeCloseTo(12*anomalyById.N01.resistances.BLACK);});
});

describe('v0.3 interruption and progression boundaries',()=>{
  it('P1 through P2 can be completed using legal equipment, natural attacks and drawn cards only',()=>{
    const s=new V3Simulation();expect(s.equip('E01','W01','A01',1).ok).toBe(true);
    const play=():void=>{for(let tick=0;tick<2400&&!s.state.encounter!.result;tick++){
      const enc=s.state.encounter!,d=enc.deck;
      if(enc.mode==='CAPTURE'&&enc.capturePhase==='CAPTURABLE'&&!enc.captureEmployeeId)expect(s.startCapture(enc.squadIds[0]).ok).toBe(true);
      if(!d.pendingCast&&d.globalCooldown<1e-7)for(const c of d.hand){const def=cardById[c.cardId],target=def.target==='SELF'?c.ownerId:def.target==='TEAM'?'TEAM':def.target==='ALLY'?[...s.state.employees].filter(e=>e.hp>0).sort((a,b)=>a.sp-b.sp)[0].id:enc.enemies[0].id;if(s.queueCard(c.instanceId,target).ok)break;}
      s.step();
    }};
    s.startEncounter('BREACH_CHALLENGE','N01');play();expect(s.state.encounter!.result).toBe('VICTORY');expect(s.state.rooms[0].rank).toBe(2);
    s.finishEncounter();run(s,20);s.upgradeEquipment('E01');expect(s.startEncounter('CAPTURE','N02').ok).toBe(true);play();expect(s.state.encounter!.result).toBe('VICTORY');expect(s.state.rooms[1].owned).toBe(true);expect(s.state.ownedWeapons).toContain('W02');
  });
  it.each(['panic','death','target']as const)('mid-windup %s cancels before impact with no GCD or attack damage',(reason)=>{
    const s=isolatedCardBattle('W00'),enc=s.state.encounter!,owner=s.state.employees[0],target=enc.enemies[1];
    owner.location.x=target.location.x-40;const c=handCard(s,'T01');s.queueCard(c.instanceId,target.id);s.step();expect(enc.deck.pendingCast?.phase).toBe('WINDUP');
    if(reason==='panic')owner.sp=0;else if(reason==='death')owner.hp=0;else target.suppressionHp=0;
    s.step();expect(enc.deck.pendingCast).toBeNull();expect(enc.deck.globalCooldown).toBe(0);expect(enc.deck.discardPile.some(x=>x.instanceId===c.instanceId)).toBe(false);
    expect((reason==='death'?enc.deck.exhausted:enc.deck.hand).some(x=>x.instanceId===c.instanceId)).toBe(true);
    expect(s.state.logs.some(e=>e.kind==='CARD')).toBe(false);if(reason!=='target')expect(target.suppressionHp).toBe(1000);
  });
  it('successful card replaces the owner auto windup and cannot also hit on the same frame',()=>{const s=isolatedCardBattle('W00'),owner=s.state.employees[0],n=s.state.encounter!.enemies[0];owner.attackPhase='WINDUP';owner.windupEndsAtSec=.05;owner.attackTargetId=n.id;executeIsolated(s,'T01');expect(s.state.logs.filter(e=>e.kind==='HIT'&&e.sourceId===owner.id)).toHaveLength(1);run(s,1);expect(s.state.logs.filter(e=>e.kind==='HIT'&&e.sourceId===owner.id)).toHaveLength(1);});
  it('winning ordinary attack immediately prevents already-ready enemy and clone impacts',()=>{const s=isolatedCardBattle('W00'),enc=s.state.encounter!,owner=s.state.employees[0],boss=enc.enemies[0];boss.suppressionHp=1;owner.nextAttackStartAtSec=0;owner.attackTargetId=boss.id;owner.windupEndsAtSec=.05;owner.attackPhase='WINDUP';for(const n of enc.enemies){n.windupEndsAtSec=.05;n.targetEmployeeId=owner.id;n.warningRangePx=1000;}s.step();expect(enc.result).toBe('VICTORY');expect(owner.sp).toBe(40);});
  it('max rank rejects challenge without charging or creating an encounter',()=>{const s=new V3Simulation();s.state.rooms[0].rank=3;const before=structuredClone(s.state);expect(s.startEncounter('BREACH_CHALLENGE','N01').ok).toBe(false);expect(s.state).toEqual(before);});
  it('second win advances only to III, preserves surviving health, and return restores actual home',()=>{const s=new V3Simulation();s.state.rooms[0].rank=2;const home={...s.state.employees[0].location};s.startEncounter('BREACH_CHALLENGE','N01');s.state.employees[0].hp=22;s.state.employees[0].sp=13;s.state.encounter!.enemies[0].suppressionHp=0;s.step();expect(s.state.rooms[0].rank).toBe(3);s.finishEncounter();expect(s.state.employees[0]).toMatchObject({location:home,hp:22,sp:13,status:'IDLE'});expect(s.state.employees[0].weaponTier).toBe(1);expect(s.startEncounter('BREACH_CHALLENGE','N01').ok).toBe(false);});
  it('reserve employees preserved by old-save migration are not teleported by the three-person encounter',()=>{const s=new V3Simulation();const reserve={...structuredClone(s.state.employees[0]),id:'E04'as const,location:{x:600,y:440,zone:'CORRIDOR'as const}};s.state.employees.push(reserve);s.startEncounter('BREACH_CHALLENGE','N01');s.abandonEncounter();s.finishEncounter();expect(reserve.location).toEqual({x:600,y:440,zone:'CORRIDOR'});});
  it('recovers only in the safe room and does not send zero-vital staff on idle walks',()=>{
    const s=new V3Simulation(),employee=s.state.employees[0];
    employee.hp=20;employee.sp=0;employee.location={x:600,y:440,zone:'CORRIDOR'};employee.status='PANICKED';
    s.step();
    expect(employee.hp).toBe(20);
    expect(employee.path).toHaveLength(0);
    employee.location={...employee.home};
    s.step();
    expect(employee.hp).toBeGreaterThan(20);
    expect(employee.sp).toBeGreaterThan(0);
  });
});
describe('v0.3 unique deck and precise timers',()=>{
  it('three duplicate training weapons produce nine unique owner-bound instances',()=>{const s=battle(),d=s.state.encounter!.deck;expect(d.hand).toHaveLength(3);const all=[...d.hand,...d.drawPile];expect(all).toHaveLength(9);expect(new Set(all.map(c=>c.instanceId)).size).toBe(9);for(const e of s.state.employees)expect(all.filter(c=>c.ownerId===e.id)).toHaveLength(3);});
  it('deterministic seeds give identical opening hands',()=>{expect(battle().state.encounter!.deck).toEqual(battle().state.encounter!.deck);});
  it('draws at exactly five simulation seconds and full hand stores no bonus draw',()=>{const s=battle(),d=s.state.encounter!.deck;s.state.encounter!.enemies[0].suppressionHp=100000;s.state.encounter!.enemies[0].suppressionHpMax=100000;run(s,4.95);expect(d.hand).toHaveLength(3);s.step();expect(d.hand).toHaveLength(4);expect(d.drawTimer).toBe(5);run(s,20);expect(d.drawTimer).toBe(5);settleCard(s,'T02');expect(d.hand).toHaveLength(3);run(s,4.8);expect(d.hand).toHaveLength(3);run(s,.3);expect(d.hand).toHaveLength(4);});
  it('pause queues one card and resolution starts gcd only at real hit',()=>{const s=battle(),d=s.state.encounter!.deck,c=handCard(s,'T01');s.setPaused(true);const target=s.state.encounter!.enemies[0];expect(s.queueCard(c.instanceId,target.id).ok).toBe(true);expect(s.queueCard(d.hand.find(x=>x!==c)!.instanceId,target.id).ok).toBe(false);expect(d.globalCooldown).toBe(0);expect(d.hand).toContain(c);const x=s.state.employees[0].location.x;run(s,2);expect(s.state.employees[0].location.x).toBe(x);s.setPaused(false);s.step();expect(d.pendingCast).not.toBeNull();expect(d.globalCooldown).toBe(0);run(s,8);expect(d.discardPile.some(x=>x.instanceId===c.instanceId)).toBe(true);expect(s.state.logs.filter(x=>x.kind==='CARD'&&x.sourceId===c.ownerId)).toHaveLength(1);});
  it('cancel and vanished target retain card without cooldown',()=>{const s=battle(),d=s.state.encounter!.deck,c=handCard(s,'T01');s.queueCard(c.instanceId,s.state.encounter!.enemies[0].id);s.cancelCard();expect(d.hand).toContain(c);expect(d.globalCooldown).toBe(0);s.queueCard(c.instanceId,s.state.encounter!.enemies[0].id);s.state.encounter!.enemies[0].suppressionHp=0;s.step();expect(d.hand).toContain(c);expect(d.globalCooldown).toBe(0);});
  it('owner incapacitation removes exactly their three cards and compensates once',()=>{const s=battle(),d=s.state.encounter!.deck;const e=s.state.employees[0];const before=d.hand.filter(c=>c.ownerId!==e.id).length;e.hp=0;s.step();expect(d.exhausted).toHaveLength(3);expect(d.hand).toHaveLength(before+1);const after=d.hand.length;run(s,.1);expect(d.hand).toHaveLength(after);expect([...d.hand,...d.drawPile,...d.discardPile].every(c=>c.ownerId!==e.id)).toBe(true);});
  it('discard recycling retains identity and cannot revive removed owner',()=>{const s=battle(),d=s.state.encounter!.deck;s.state.employees[0].hp=0;s.step();d.discardPile.push(...d.drawPile.splice(0),...d.hand.splice(0));d.drawTimer=.05;s.step();expect(d.hand).toHaveLength(1);expect(d.hand[0].ownerId).not.toBe('E01');expect(new Set([...d.hand,...d.drawPile,...d.discardPile,...d.exhausted].map(c=>c.instanceId)).size).toBe(9);});
});
describe('v0.3 spatial combat and cards',()=>{
  it('approaches before attacking and exposes real enemy windup and hits',()=>{const s=battle(),n=s.state.encounter!.enemies[0],x=s.state.employees[0].location.x;run(s,.2);expect(s.state.employees[0].location.x).toBeGreaterThan(x);expect(n.suppressionHp).toBe(n.suppressionHpMax);run(s,12);expect(n.suppressionHp).toBeLessThan(n.suppressionHpMax);expect(s.state.logs.some(e=>e.kind==='TELEGRAPH')).toBe(true);expect(s.state.employees.some(e=>e.sp<e.spMax)).toBe(true);});
  it('retreat moves actual entity and focus resumes automatic chase',()=>{const s=battle(),e=s.state.employees[0];run(s,4);const x=e.location.x;s.moveEmployee(e.id,{x:120,y:500});run(s,1);expect(e.location.x).toBeLessThan(x);s.focusEnemy(s.state.encounter!.enemies[0].id);run(s,1);expect(e.order.kind).toBe('SUPPRESS');});
  it('official equipment upgrade is explicit and battle loadouts are immutable',()=>{const s=new V3Simulation();s.equip('E01','W01','A01',1);s.state.rooms[0].rank=2;expect(s.state.employees[0].weaponTier).toBe(1);s.upgradeEquipment('E01');expect(s.state.employees[0].weaponTier).toBe(2);s.startEncounter('BREACH_CHALLENGE','N01');expect(s.equip('E01','W00','A00',1).ok).toBe(false);expect(s.upgradeEquipment('E01').ok).toBe(false);});
  it('all five weapons provide exactly three cards and every effect executes',()=>{for(let i=1;i<=5;i++){const s=new V3Simulation(),id=`N0${i}`as AnomalyId,w=`W0${i}`as WeaponId;Object.assign(s.state.rooms[i-1],{owned:true,rank:1,state:'STABLE'});s.state.ownedWeapons.push(w);s.state.employees[0].weaponId=w;s.startEncounter('BREACH_CHALLENGE',id);for(const card of weaponCards[w]){const def=cardById[card];if(def.effect==='COPY')expect(s.state.encounter!.lastAttackCard).not.toBeNull();settleCard(s,card,def.target==='ALLY'?'E02':undefined);}expect(s.state.logs.filter(e=>e.kind==='CARD')).toHaveLength(3);}});
  it('interrupt prevents a pending telegraph impact and stun survives pause',()=>{const s=new V3Simulation();s.state.employees[0].weaponId='W01';s.startEncounter('BREACH_CHALLENGE','N01');const n=s.state.encounter!.enemies[0];n.windupEndsAtSec=s.state.simulationTimeSec+1.2;n.attackPhase='WINDUP';settleCard(s,'N01_2');expect(n.windupEndsAtSec).toBeNull();expect(n.stunnedUntilSec).toBeGreaterThan(s.state.simulationTimeSec);s.setPaused(true);const before=JSON.stringify(s.state);run(s,10);expect(JSON.stringify(s.state)).toBe(before);});
  it('first encounter auto combat is real, bounded and winnable without damage injection',()=>{const s=battle();run(s,20);expect(s.state.encounter!.result).toBe('VICTORY');expect(s.state.encounter!.elapsedSec).toBeGreaterThan(6);expect(s.state.encounter!.elapsedSec).toBeLessThanOrEqual(20);});
  it('copy requires a prior attack, same target, and does not recursively replace its record',()=>{const s=new V3Simulation();s.state.employees[0].weaponId='W01';s.startEncounter('BREACH_CHALLENGE','N01');const c=handCard(s,'N01_3');expect(s.cardUnavailable(c.instanceId)).toContain('可复制');settleCard(s,'N01_1');s.state.encounter!.deck.globalCooldown=0;handCard(s,'N01_3');expect(s.cardUnavailable(c.instanceId,s.state.encounter!.enemies[1].id)).toContain('同一目标');const record=structuredClone(s.state.encounter!.lastAttackCard);settleCard(s,'N01_3');expect(s.state.encounter!.lastAttackCard).toEqual(record);});
  it('healing clamps SP, amplification consumes once, and guard replaces rather than stacks',()=>{const s=new V3Simulation();s.state.employees[0].weaponId='W04';s.startEncounter('BREACH_CHALLENGE','N01');settleCard(s,'N04_3');expect(s.state.encounter!.nextAttackMultiplier).toBe(1.3);settleCard(s,'N04_1');expect(s.state.encounter!.nextAttackMultiplier).toBe(1);expect(s.state.encounter!.lastAttackCard!.damage.amount).toBeCloseTo(15.6);const t=battle();settleCard(t,'T03','E02');expect(t.state.employees[1].sp).toBe(100);settleCard(t,'T02');expect(t.state.employees[0].blockReduction).toBe(.2);});
  it('one card success triggers exactly 2.5 cooldown independent of remaining draw timer',()=>{const s=battle(),d=s.state.encounter!.deck,c=handCard(s,'T02');if(d.hand.length===4){const extra=d.hand.find(x=>x.instanceId!==c.instanceId)!;d.hand=d.hand.filter(x=>x!==extra);d.drawPile.push(extra);}d.drawTimer=3;s.queueCard(c.instanceId,c.ownerId);while(d.pendingCast)s.step();expect(d.globalCooldown).toBe(2.5);expect(d.drawTimer).toBeCloseTo(2.6);const other=d.hand[0];expect(s.queueCard(other.instanceId,other.ownerId).ok).toBe(false);run(s,2.45);expect(d.globalCooldown).toBeCloseTo(.05);s.step();expect(d.globalCooldown).toBeCloseTo(0);});
  it('result victory clears actual clones and stable income resumes even before returning',()=>{const s=battle();expect(s.state.encounter!.enemies).toHaveLength(3);s.state.encounter!.enemies[0].suppressionHp=0;s.step();expect(s.state.encounter!.enemies.every(n=>n.suppressionHp===0)).toBe(true);const wallet=s.state.wallet;run(s,60);expect(s.state.wallet-wallet).toBeCloseTo(4);});
});
