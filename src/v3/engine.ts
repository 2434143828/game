import type { AnomalyId, ArmorId, DamageSpec, EmployeeId, Location, Point, Result, WeaponId } from '../../contracts/data-contract';
import { anomalyById, armorById, config, weaponById } from '../data/config';
import { resolveEmployeeDamage, resolveEnemyDamage } from '../simulation/damage';
import { legacyNavigation, type Navigation } from '../simulation/navigation';
import { makeState } from '../simulation/state';
import { anomalyIds, cardById, v3Config as cfg, weaponCards } from './config';
import type { CardDefinition, CombatCardInstance, CombatEvent, EncounterState, V3Employee, V3Enemy, V3State } from './model';

const EPS = 1e-7;
const success = (): Result<void> => ({ ok: true, value: undefined });
const fail = (code: string, message: string): Result<void> => ({ ok: false, code, message });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const distance = (a: Point, b: Point): number => Math.hypot(a.x-b.x,a.y-b.y);
const scaled = (damage: DamageSpec, multiplier: number): DamageSpec => ({ ...damage, amount: damage.amount * multiplier });

export function createV3State(navigation: Navigation = legacyNavigation): V3State {
  const spawn = navigation.locate(navigation.safePoint)!;
  const employeeSpawn = (index:number):Location => {
    const candidate=navigation.locate({x:spawn.x+(index-1)*44,y:spawn.y});
    return candidate?.zone==='SAFE'?candidate:{...spawn};
  };
  const base = makeState(undefined, spawn);
  return { saveVersion: 3, phase: 'FACILITY', wallet: base.progress.wallet, simulationTimeSec: 0, timeScale: 1, speed: 1,
    rooms: anomalyIds.map(anomalyId => ({ anomalyId, owned: anomalyId === 'N01', rank: anomalyId === 'N01' ? 1 : 0, state: anomalyId === 'N01' ? 'STABLE' : 'LOCKED' })),
    employees: base.employees.slice(0,3).map((e, index) => ({ ...e, location: employeeSpawn(index), home: employeeSpawn(index), weaponTier: 1, armorTier: 1, hitUntilSec: 0, actionUntilSec: 0, panicUntilSec: 0, blockUntilSec: 0, blockReduction: 0, counterUntilSec: 0, counterDamage: 0, removedCards: false, idleNextAtSec: 1+index*1.4, idleCycle: index, attackTargetId: null })),
    encounter: null, rngState: 31023, sequence: 0, logs: [], ownedWeapons: ['W01'], ownedArmors: ['A01'], migrationSummary: [] };
}

/** Fixed simulation owns production, positions, impacts and cards; views only issue commands. */
export class V3Simulation {
  state: V3State;
  readonly navigation: Navigation;
  private accumulator = 0;
  constructor(snapshot?: V3State, options: { navigation?: Navigation } = {}) {
    this.navigation = options.navigation ?? legacyNavigation;
    this.state = snapshot ? clone(snapshot) : createV3State(this.navigation);
  }
  private id(prefix: string): string { return `${prefix}-${++this.state.sequence}`; }
  private log(kind: string, message: string, sourceId?: string, targetId?: string, amount?: number, art?: Pick<CombatEvent,'cardId'|'instanceId'|'sourcePoint'|'targetPoint'>): void {
    this.state.logs.push({ id: this.id('event'), timeSec: this.state.simulationTimeSec, kind, message, sourceId, targetId, amount, ...art });
    if (this.state.logs.length > 160) this.state.logs.splice(0,this.state.logs.length-160);
  }
  private random(): number { this.state.rngState = (Math.imul(this.state.rngState,1664525)+1013904223) >>> 0; return this.state.rngState/4294967296; }
  private shuffle(cards: CombatCardInstance[]): void { for (let i=cards.length-1;i>0;i--) { const j=Math.floor(this.random()*(i+1)); [cards[i],cards[j]]=[cards[j],cards[i]]; } }
  setPaused(paused: boolean): void { this.state.timeScale = paused ? 0 : this.state.speed; if (this.state.encounter) this.state.encounter.paused = paused; this.accumulator = 0; }
  setSpeed(speed: 1 | 2): void { if (speed !== 1 && speed !== 2) return; this.state.speed=speed; if (this.state.timeScale) this.state.timeScale=speed; if (this.state.encounter) this.state.encounter.speed=speed; }
  update(deltaMs: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs < 0 || !this.state.timeScale) { this.accumulator=0; return; }
    this.accumulator += Math.min(deltaMs,1000)/1000*this.state.timeScale;
    const dt=config.game.simulation.fixedStepSec;
    while (this.accumulator+EPS>=dt) { this.accumulator=Math.max(0,this.accumulator-dt); this.step(); }
  }
  productionPerMinute(): number { return this.state.rooms.reduce((sum,r)=>sum+(r.owned&&r.state==='STABLE'?cfg.production[r.anomalyId][r.rank-1]:0),0); }
  captureCondition(id: AnomalyId): string | null {
    const rooms=this.state.rooms, room=rooms.find(r=>r.anomalyId===id);
    if (!room) return '未知目标'; if (room.owned) return '已收容';
    if (id==='N02' && (rooms.find(r=>r.anomalyId==='N01')?.rank??0)<2) return '需要奶龙 II 阶';
    if (id==='N03' && !rooms.find(r=>r.anomalyId==='N02')?.owned) return '需要先抓捕耄耋';
    if (id==='N04' && !rooms.find(r=>r.anomalyId==='N03')?.owned) return '需要先抓捕大狗';
    if (id==='N05' && rooms.filter(r=>r.owned&&r.rank>=2).length<3) return '需要三个收容物达到 II 阶';
    if (this.state.wallet+EPS<cfg.captureCosts[id]) return `需要 ${cfg.captureCosts[id]} 能量`;
    return null;
  }
  startEncounter(mode: EncounterState['mode'], anomalyId: AnomalyId): Result<void> {
    if (this.state.encounter) return fail('BUSY','已有战斗进行中');
    const room=this.state.rooms.find(r=>r.anomalyId===anomalyId);
    if (!room || !['CAPTURE','BREACH_CHALLENGE'].includes(mode)) return fail('TARGET','未知目标');
    if (mode==='CAPTURE') { const reason=this.captureCondition(anomalyId); if (reason) return fail('LOCKED',reason); }
    else if (!room.owned||room.rank>=cfg.facility.maxRank) return fail('RANK','未收容或已经满阶');
    const squad=this.state.employees.slice(0,cfg.combat.squadSize);
    if (squad.length!==3||squad.some(e=>e.hp<=0||e.sp<=0)) return fail('SQUAD','需要三名恢复行动的员工');
    if (mode==='CAPTURE') this.state.wallet-=cfg.captureCosts[anomalyId]; else room.state='IN_CHALLENGE';
    const cards=squad.flatMap(e=>weaponCards[e.weaponId].map(cardId=>({ instanceId:this.id('card'),cardId,ownerId:e.id,sourceWeaponId:e.weaponId,tier:e.weaponTier })));
    this.shuffle(cards);
    const ec=cfg.enemies[anomalyId], rank=Math.max(1,room.rank), id=this.id('encounter'), now=this.state.simulationTimeSec;
    const hp=ec.hp*(1+(rank-1)*ec.rankHpMultiplier);
    const enemy: V3Enemy={ id:this.id('enemy'), sourceAnomalyId:anomalyId, breachInstanceId:id,isClone:false,mainEnemyId:null,location:{x:cfg.arena.enemySpawnX,y:cfg.arena.y,zone:'CORRIDOR'},suppressionHp:hp,suppressionHpMax:hp,targetEmployeeId:null,attackPhase:'RECOVERY',nextAttackStartAtSec:now+ec.firstAttackDelaySec,windupEndsAtSec:null,stunnedUntilSec:0,pendingForcedHowl:false,hitUntilSec:0,actionUntilSec:0,attackOrdinal:0,intent:'接近最近员工',specialAttack:false,warningRangePx:ec.rangePx };
    this.state.encounter={id,mode,targetAnomalyId:anomalyId,startRank:room.rank,squadIds:squad.map(e=>e.id),paused:this.state.timeScale===0,speed:this.state.speed,deck:{drawPile:cards,hand:[],discardPile:[],exhausted:[],drawTimer:cfg.combat.drawIntervalSec,globalCooldown:0,pendingCast:null},enemies:[enemy],focusEnemyId:enemy.id,result:null,rewardApplied:false,elapsedSec:0,lastAttackCard:null,nextAttackMultiplier:1,casualties:[]};
    if(anomalyId==='N01')for(let i=0;i<cfg.enemies.N01.cloneCount;i++)this.state.encounter.enemies.push({...clone(enemy),id:this.id('clone'),isClone:true,mainEnemyId:enemy.id,suppressionHp:cfg.enemies.N01.cloneHp,suppressionHpMax:cfg.enemies.N01.cloneHp,location:{...enemy.location,x:enemy.location.x+cfg.enemies.N01.cloneSpawnOffsets[i]}});
    this.state.phase='ENCOUNTER';
    squad.forEach((e,i)=> { e.home={...e.location};e.location={x:cfg.arena.employeeSpawnX[i],y:cfg.arena.y,zone:'CORRIDOR'};e.path=[];e.order={kind:'SUPPRESS',enemyId:enemy.id};e.status='SUPPRESSING';e.attackPhase='RECOVERY';e.windupEndsAtSec=null;e.nextAttackStartAtSec=now;e.attackTargetId=null;e.removedCards=false;e.blockUntilSec=0;e.counterUntilSec=0;e.panicUntilSec=0; });
    for(let i=0;i<cfg.combat.startingHand;i++) this.drawCard();
    this.log('START',`${anomalyById[anomalyId].name}：${mode==='CAPTURE'?'外勤抓捕':'主动失效挑战'}开始`);
    return success();
  }
  private drawCard(): boolean {
    const enc=this.state.encounter;if(!enc||enc.deck.hand.length>=cfg.combat.handLimit)return false;
    const d=enc.deck;
    if(!d.drawPile.length&&d.discardPile.length) { d.drawPile=d.discardPile.splice(0);this.shuffle(d.drawPile); }
    while(d.drawPile.length) { const card=d.drawPile.shift()!;if(this.state.employees.find(e=>e.id===card.ownerId)?.hp!>0) { d.hand.push(card);return true; }d.exhausted.push(card); }
    return false;
  }
  cardUnavailable(instanceId: string, targetId?: string): string | null {
    const enc=this.state.encounter;if(!enc||enc.result)return '当前不在战斗中';
    const d=enc.deck,c=d.hand.find(c=>c.instanceId===instanceId);if(!c)return '卡牌不在手中';
    if(d.pendingCast)return '已有一张牌待施放';if(d.globalCooldown>EPS)return '公共冷却中';
    const e=this.state.employees.find(e=>e.id===c.ownerId);if(!e||!this.canAct(e))return '所属员工无法行动';
    const def=cardById[c.cardId];
    if(def.effect==='COPY'){
      if(!enc.lastAttackCard)return '尚无可复制的攻击牌';
      if(!enc.enemies.some(n=>n.id===enc.lastAttackCard!.targetId&&n.suppressionHp>0))return '上一张攻击牌的目标已失效，请先对存活敌人使用攻击牌';
    }
    if(targetId!==undefined) {
      if(def.effect==='COPY'&&enc.lastAttackCard?.targetId!==targetId)return '复制粘贴必须选择上一张攻击牌的同一目标';
      if(def.target==='ENEMY'&&!enc.enemies.some(n=>n.id===targetId&&n.suppressionHp>0))return '请选择场内敌人';
      if(def.target==='ALLY'&&!this.state.employees.some(a=>enc.squadIds.includes(a.id)&&a.id===targetId&&a.hp>0))return '请选择可行动的队友';
      if(def.target==='SELF'&&targetId!==c.ownerId)return '此牌只能对自身使用';
      if(def.target==='TEAM'&&targetId!=='TEAM')return '此牌目标为全队';
    }
    return null;
  }
  queueCard(instanceId: string,targetId: string): Result<void> {
    const reason=this.cardUnavailable(instanceId,targetId);if(reason)return fail('CARD',reason);
    const enc=this.state.encounter!,card=enc.deck.hand.find(c=>c.instanceId===instanceId)!;
    enc.deck.pendingCast={instanceId,targetId,requestId:this.id('cast'),phase:'APPROACH',resolvesAtSec:null};
    const employee=this.state.employees.find(e=>e.id===card.ownerId)!;employee.windupEndsAtSec=null;employee.attackPhase='RECOVERY';
    this.log('QUEUE',`${employee.displayName}预备${cardById[card.cardId].name}`,employee.id,targetId);return success();
  }
  cancelCard(reason='施牌取消'): void { const enc=this.state.encounter;if(!enc?.deck.pendingCast)return;const c=enc.deck.hand.find(c=>c.instanceId===enc.deck.pendingCast!.instanceId);const owner=this.state.employees.find(e=>e.id===c?.ownerId);if(owner){owner.windupEndsAtSec=null;owner.attackPhase='RECOVERY';}enc.deck.pendingCast=null;this.log('CANCEL',`${reason}，未消耗卡牌或公共冷却`); }
  focusEnemy(id: string): Result<void> { const enc=this.state.encounter;if(!enc||enc.result||!enc.enemies.some(e=>e.id===id&&e.suppressionHp>0))return fail('TARGET','目标不可选');enc.focusEnemyId=id;const castingOwner=enc.deck.hand.find(c=>c.instanceId===enc.deck.pendingCast?.instanceId)?.ownerId;for(const e of this.state.employees.filter(e=>enc.squadIds.includes(e.id)&&e.hp>0)){e.order={kind:'SUPPRESS',enemyId:id};if(e.id!==castingOwner){e.windupEndsAtSec=null;e.attackPhase='RECOVERY';}}return success(); }
  moveEmployee(id: EmployeeId,point: Point): Result<void> {
    const e=this.state.employees.find(e=>e.id===id);if(!e||!this.canAct(e)||!Number.isFinite(point.x)||!Number.isFinite(point.y))return fail('EMPLOYEE','员工不可移动');
    let destination=point,path:Point[]|null;
    if(this.state.encounter) { if(this.state.encounter.result)return fail('RESULT','请返回设施');destination={x:Math.max(cfg.arena.minX,Math.min(cfg.arena.maxX,point.x)),y:cfg.arena.y};path=[destination]; }
    else { if(!this.navigation.corridorAt(point))return fail('PATH','请点击走廊');path=this.navigation.route(e.location,point); }
    if(!path)return fail('PATH','无法到达');
    const pending=this.state.encounter?.deck.pendingCast; if(pending&&this.state.encounter?.deck.hand.find(c=>c.instanceId===pending.instanceId)?.ownerId===id)this.cancelCard();
    e.path=path;e.order={kind:'MOVE',destination};e.status='MOVING';e.windupEndsAtSec=null;e.attackPhase='RECOVERY';return success();
  }
  equip(id: EmployeeId,weaponId: WeaponId,armorId: ArmorId,tier=1): Result<void> {
    if(this.state.encounter)return fail('BATTLE','战斗中不能换装');const e=this.state.employees.find(e=>e.id===id);
    if(!e||!weaponById[weaponId]||!armorById[armorId]||!Number.isInteger(tier)||tier<1)return fail('EQUIPMENT','未知装备或阶级');
    for(const [item,source,owned]of [[weaponId,weaponById[weaponId].sourceAnomalyId,this.state.ownedWeapons],[armorId,armorById[armorId].sourceAnomalyId,this.state.ownedArmors]] as const){if(source&&(!(owned as readonly string[]).includes(item)||(this.state.rooms.find(r=>r.anomalyId===source)?.rank??0)<tier))return fail('LOCKED','装备未解锁或阶级不足');if(!source&&tier!==1)return fail('TIER','训练装备仅 I 阶');}
    if(this.state.employees.some(other=>other.id!==id&&((weaponId!=='W00'&&other.weaponId===weaponId)||(armorId!=='A00'&&other.armorId===armorId))))return fail('COPY','正式装备只有一份，请先让原持有人卸下');
    e.weaponId=weaponId;e.armorId=armorId;e.weaponTier=tier;e.armorTier=tier;this.log('EQUIP',`${e.displayName}更换装备`);return success();
  }
  upgradeEquipment(id:EmployeeId):Result<void>{if(this.state.encounter)return fail('BATTLE','战斗中不能升级');const e=this.state.employees.find(e=>e.id===id);if(!e)return fail('EMPLOYEE','员工不存在');for(const slot of ['weapon','armor']as const){const source=slot==='weapon'?weaponById[e.weaponId].sourceAnomalyId:armorById[e.armorId].sourceAnomalyId;e[slot==='weapon'?'weaponTier':'armorTier']=source?(this.state.rooms.find(r=>r.anomalyId===source)?.rank??1):1;}return success();}
  private canAct(e:V3Employee):boolean{return e.hp>EPS&&e.status!=='PANICKED'&&e.status!=='INCAPACITATED';}
  private moveTowards(e:V3Employee|V3Enemy,p:Point,speed:number,dt:number):void {const d=distance(e.location,p);if(d<EPS)return;const ratio=Math.min(1,speed*dt/d);e.location={...e.location,x:e.location.x+(p.x-e.location.x)*ratio,y:e.location.y+(p.y-e.location.y)*ratio};}
  private walk(e:V3Employee,dt:number,speed:number):void{let remaining=speed*dt;while(e.path.length&&remaining>EPS){const next=e.path[0],d=distance(e.location,next);if(d<=remaining+EPS){e.location=this.state.encounter?{...e.location,...next}:this.navigation.locate(next,e.location)??e.location;e.path.shift();remaining-=d;}else{const p={x:e.location.x+(next.x-e.location.x)*remaining/d,y:e.location.y+(next.y-e.location.y)*remaining/d};e.location=this.state.encounter?{...e.location,...p}:this.navigation.locate(p,e.location,next)??e.location;remaining=0;}}}
  step():void {
    if(!this.state.timeScale)return;const dt=config.game.simulation.fixedStepSec,s=this.state;
    s.simulationTimeSec+=dt;s.wallet+=this.productionPerMinute()/60*dt;
    if(s.encounter?.result)return;
    if(!s.encounter){this.facilityStep(dt);return;}
    const enc=s.encounter,d=enc.deck;enc.elapsedSec+=dt;d.globalCooldown=Math.max(0,d.globalCooldown-dt);
    for(const e of s.employees.filter(e=>enc.squadIds.includes(e.id)))this.checkEmployee(e);
    if(d.hand.length<cfg.combat.handLimit){d.drawTimer=Math.max(0,d.drawTimer-dt);if(d.drawTimer<=EPS){this.drawCard();d.drawTimer=cfg.combat.drawIntervalSec;}}
    this.pendingStep(dt);
    if(enc.result)return;
    for(const e of s.employees.filter(e=>enc.squadIds.includes(e.id)))this.employeeStep(e,dt);
    this.checkResult();
    for(const n of [...enc.enemies]){if(enc.result)break;this.enemyStep(n,dt);this.checkResult();}
    this.checkResult();
  }
  private facilityStep(dt:number):void{const now=this.state.simulationTimeSec;for(const e of this.state.employees){e.hp=Math.min(e.hpMax,e.hp+config.game.employee.safeHpPerSec*dt);e.sp=Math.min(e.spMax,e.sp+config.game.employee.safeSpPerSec*dt);if(e.status==='INCAPACITATED'||e.status==='PANICKED')e.status='IDLE';if(e.path.length){this.walk(e,dt,config.game.employee.moveSpeedPxPerSec*(e.order.kind==='IDLE'?cfg.facility.idleSpeedMultiplier:1));e.status=e.path.length?'MOVING':'IDLE';if(!e.path.length){e.order={kind:'IDLE'};e.idleNextAtSec=now+cfg.facility.idleWaitSec;}}else if(now>=e.idleNextAtSec&&this.navigation.idlePoints.length){const p=this.navigation.idlePoints[e.idleCycle++%this.navigation.idlePoints.length];e.path=this.navigation.route(e.location,p)??[];e.status=e.path.length?'MOVING':'IDLE';e.idleNextAtSec=now+cfg.facility.idleWaitSec;}}}
  private pendingStep(dt:number):void{
    const enc=this.state.encounter!,p=enc.deck.pendingCast;if(!p)return;
    const card=enc.deck.hand.find(c=>c.instanceId===p.instanceId),owner=this.state.employees.find(e=>e.id===card?.ownerId);
    if(!card||!owner||!this.canAct(owner)){this.cancelCard('所属员工无法行动，施牌取消');return;}
    const def=cardById[card.cardId],target=def.target==='ENEMY'?enc.enemies.find(e=>e.id===p.targetId&&e.suppressionHp>0):def.target==='ALLY'?this.state.employees.find(e=>e.id===p.targetId&&e.hp>0):owner;
    if(!target){this.cancelCard('目标已失效，施牌取消');return;}
    if(p.phase==='APPROACH'){
      if(distance(owner.location,target.location)>def.rangePx){owner.status='MOVING';this.moveTowards(owner,target.location,config.game.employee.moveSpeedPxPerSec,dt);return;}
      p.phase='WINDUP';p.resolvesAtSec=this.state.simulationTimeSec+def.windupSec;owner.status='SUPPRESSING';owner.attackPhase='WINDUP';owner.windupEndsAtSec=p.resolvesAtSec;return;
    }
    // Keep the queued action's windup while tracking a moving target. Restarting it at
    // the range boundary can prevent a short-range card from ever resolving.
    if(distance(owner.location,target.location)>def.rangePx+EPS){
      owner.status='MOVING';this.moveTowards(owner,target.location,config.game.employee.moveSpeedPxPerSec,dt);
      if(distance(owner.location,target.location)>def.rangePx+EPS)return;
    }
    owner.status='SUPPRESSING';
    if(this.state.simulationTimeSec+EPS<(p.resolvesAtSec??Infinity))return;
    this.applyCard(card,def,p.targetId);
    enc.deck.hand=enc.deck.hand.filter(c=>c.instanceId!==card.instanceId);enc.deck.discardPile.push(card);enc.deck.globalCooldown=cfg.combat.globalCardCooldownSec;enc.deck.pendingCast=null;
    owner.attackPhase='HIT';owner.actionUntilSec=this.state.simulationTimeSec+cfg.combat.actionFeedbackSec;owner.windupEndsAtSec=null;owner.nextAttackStartAtSec=this.state.simulationTimeSec+weaponById[owner.weaponId].attackPeriodSec;
    this.log('CARD',`${owner.displayName}施放${def.name}`,owner.id,p.targetId,undefined,{cardId:card.cardId,instanceId:card.instanceId,sourcePoint:{x:owner.location.x,y:owner.location.y},targetPoint:{x:target.location.x,y:target.location.y}});this.checkResult();
  }
  private applyCard(card:CombatCardInstance,def:CardDefinition,targetId:string):void{
    const enc=this.state.encounter!,owner=this.state.employees.find(e=>e.id===card.ownerId)!,target=enc.enemies.find(e=>e.id===targetId),now=this.state.simulationTimeSec,tier=cfg.tier.damageMultipliers[card.tier-1]??1;
    if(def.effect==='DAMAGE'||def.effect==='COPY'){
      const base=def.effect==='COPY'?enc.lastAttackCard?.damage:def.damage;
      if(base&&target){const damage=scaled(base,(def.effect==='COPY'?(def.amount??.5):tier)*enc.nextAttackMultiplier);enc.nextAttackMultiplier=1;for(const n of [...enc.enemies].filter(n=>n.id===targetId||(def.radiusPx!==undefined&&distance(n.location,target.location)<=def.radiusPx)))this.damageEnemy(n,damage,owner.id);if(def.effect==='DAMAGE')enc.lastAttackCard={damage,targetId};}
    }
    if(def.effect==='STUN'&&target){target.stunnedUntilSec=now+(def.durationSec??0);this.interrupt(target);}
    if(def.effect==='KNOCKBACK'&&target){target.location.x=Math.max(cfg.arena.minX,Math.min(cfg.arena.maxX,target.location.x+(target.location.x>=owner.location.x?1:-1)*(def.amount??0)));this.interrupt(target);}
    if(def.effect==='DELAY'&&target){if(target.windupEndsAtSec!==null)target.windupEndsAtSec+=def.durationSec??0;else target.nextAttackStartAtSec+=def.durationSec??0;}
    if(def.effect==='BLOCK'){owner.blockReduction=def.amount??0;owner.blockUntilSec=now+(def.durationSec??0);}
    if(def.effect==='COUNTER'){owner.counterDamage=(def.amount??0)*tier;owner.counterUntilSec=now+(def.durationSec??0);}
    if(def.effect==='AMPLIFY')enc.nextAttackMultiplier=1+(def.amount??0);
    if(def.effect==='HEAL')for(const e of this.state.employees.filter(e=>enc.squadIds.includes(e.id)&&e.hp>0&&(def.target==='TEAM'||e.id===targetId))){const before=e.sp;e.sp=Math.min(e.spMax,e.sp+(def.amount??0)*tier);this.checkEmployee(e);this.log('HEAL',`精神恢复`,owner.id,e.id,e.sp-before);}
  }
  private interrupt(n:V3Enemy):void{n.windupEndsAtSec=null;n.attackPhase='RECOVERY';n.nextAttackStartAtSec=Math.max(this.state.simulationTimeSec,n.stunnedUntilSec)+cfg.enemies[n.sourceAnomalyId].attackPeriodSec;n.intent='蓄力被打断';this.log('INTERRUPT','成功打断敌人蓄力',undefined,n.id);}
  private employeeStep(e:V3Employee,dt:number):void{
    const enc=this.state.encounter!,now=this.state.simulationTimeSec;if(!this.canAct(e))return;
    if(enc.deck.pendingCast&&enc.deck.hand.find(c=>c.instanceId===enc.deck.pendingCast!.instanceId)?.ownerId===e.id)return;
    if(e.order.kind==='MOVE'){if(e.path.length){this.walk(e,dt,config.game.employee.moveSpeedPxPerSec);e.status='MOVING';}else{e.status='IDLE';e.attackPhase='RECOVERY';}return;}
    const target=enc.enemies.find(n=>n.id===enc.focusEnemyId&&n.suppressionHp>0)??[...enc.enemies].filter(n=>n.suppressionHp>0).sort((a,b)=>distance(a.location,e.location)-distance(b.location,e.location))[0];if(!target)return;
    const w=weaponById[e.weaponId];e.order={kind:'SUPPRESS',enemyId:target.id};
    if(e.windupEndsAtSec!==null){if(e.attackTargetId!==target.id){e.windupEndsAtSec=null;e.attackPhase='RECOVERY';return;}if(now+EPS<e.windupEndsAtSec)return;e.windupEndsAtSec=null;e.attackPhase='HIT';e.actionUntilSec=now+cfg.combat.actionFeedbackSec;e.nextAttackStartAtSec=now+w.attackPeriodSec;if(distance(e.location,target.location)<=w.rangePx+EPS)this.damageEnemy(target,scaled(w.damage,cfg.tier.damageMultipliers[e.weaponTier-1]??1),e.id);return;}
    if(now>e.actionUntilSec)e.attackPhase='RECOVERY';
    const formationRange=Math.max(24,w.rangePx-enc.squadIds.indexOf(e.id)*14);
    if(distance(e.location,target.location)>formationRange){e.status='MOVING';this.moveTowards(e,target.location,config.game.employee.moveSpeedPxPerSec,dt);return;}
    e.status='SUPPRESSING';if(now+EPS>=e.nextAttackStartAtSec){e.attackPhase='WINDUP';e.windupEndsAtSec=now+w.windupSec;e.attackTargetId=target.id;}
  }
  private enemyStep(n:V3Enemy,dt:number):void{
    if(n.suppressionHp<=0)return;const enc=this.state.encounter!,now=this.state.simulationTimeSec,ec=cfg.enemies[n.sourceAnomalyId];if(now<n.stunnedUntilSec)return;
    const alive=this.state.employees.filter(e=>enc.squadIds.includes(e.id)&&e.hp>0);
    const active=alive.filter(e=>e.location.zone!=='SAFE');
    const target=alive.find(e=>e.id===n.targetEmployeeId&&e.location.zone!=='SAFE')??[...active.length?active:alive].sort((a,b)=>distance(a.location,n.location)-distance(b.location,n.location)||a.id.localeCompare(b.id))[0];if(!target)return;
    n.targetEmployeeId=target.id;
    if(n.windupEndsAtSec!==null){if(now+EPS<n.windupEndsAtSec)return;n.windupEndsAtSec=null;n.attackPhase='HIT';n.actionUntilSec=now+cfg.combat.actionFeedbackSec;n.nextAttackStartAtSec=now+(n.isClone?cfg.enemies.N01.cloneAttackPeriodSec:ec.attackPeriodSec);
      const base=anomalyById[n.sourceAnomalyId].breach.damage,damage=scaled(base,(n.specialAttack?ec.specialDamageMultiplier:1)*(n.isClone?cfg.enemies.N01.cloneDamageMultiplier:1));
      const aoe=n.specialAttack||['N03','N04','N05'].includes(n.sourceAnomalyId);
      for(const e of alive.filter(e=>(aoe||e.id===target.id)&&distance(e.location,n.location)<=n.warningRangePx+EPS))this.damageEmployee(e,damage,n);
      n.intent='攻击恢复';return;
    }
    if(now>n.actionUntilSec)n.attackPhase='RECOVERY';
    const chosen=target;
    const approachRange=Math.max(28,ec.rangePx-(n.isClone?enc.enemies.indexOf(n)*18:0));
    if(distance(chosen.location,n.location)>approachRange){this.moveTowards(n,chosen.location,ec.moveSpeedPxPerSec,dt);n.intent='接近最近员工';return;}
    if(now+EPS>=n.nextAttackStartAtSec){n.attackOrdinal++;n.specialAttack=!n.isClone&&n.attackOrdinal%ec.specialEvery===0;n.warningRangePx=ec.rangePx*(n.specialAttack?ec.specialRangeMultiplier:1);n.intent=n.specialAttack?ec.specialName:'普通攻击';n.attackPhase='WINDUP';n.windupEndsAtSec=now+ec.windupSec;this.log('TELEGRAPH',n.intent,n.id,chosen.id);}
  }
  private damageEnemy(n:V3Enemy,damage:DamageSpec,sourceId:string):void{if(n.suppressionHp<=0)return;const amount=resolveEnemyDamage(n.suppressionHpMax,damage,anomalyById[n.sourceAnomalyId].resistances);n.suppressionHp=Math.max(0,n.suppressionHp-amount);n.hitUntilSec=this.state.simulationTimeSec+cfg.combat.hitFeedbackSec;this.log('HIT','敌人受击',sourceId,n.id,amount);}
  private damageEmployee(e:V3Employee,damage:DamageSpec,n:V3Enemy):void{if(e.hp<=0)return;const now=this.state.simulationTimeSec,multiplier=(cfg.tier.armorMultipliers[e.armorTier-1]??1)*(now<e.blockUntilSec?1-e.blockReduction:1),before=e.hp+e.sp;const result=resolveEmployeeDamage(e.hp,e.sp,e.hpMax,scaled(damage,multiplier),armorById[e.armorId].resistances);e.hp=result.hp;e.sp=result.sp;e.hitUntilSec=now+cfg.combat.hitFeedbackSec;this.log('HIT','员工受击',n.id,e.id,before-e.hp-e.sp);if(now<e.counterUntilSec){e.counterUntilSec=0;this.damageEnemy(n,{type:'RED',kind:'FLAT',amount:e.counterDamage},e.id);this.log('COUNTER','暴怒反击',e.id,n.id);}this.checkEmployee(e);}
  private checkEmployee(e:V3Employee):void{
    const enc=this.state.encounter,now=this.state.simulationTimeSec;if(!enc)return;
    if(e.hp<=EPS){e.hp=0;e.status='INCAPACITATED';e.path=[];e.windupEndsAtSec=null;e.attackPhase='RECOVERY';if(!e.removedCards){e.removedCards=true;enc.casualties.push(e.id);const d=enc.deck;if(d.pendingCast&&d.hand.find(c=>c.instanceId===d.pendingCast!.instanceId)?.ownerId===e.id)this.cancelCard('所属员工重伤，施牌取消');for(const key of ['hand','drawPile','discardPile']as const){d.exhausted.push(...d[key].filter(c=>c.ownerId===e.id));d[key]=d[key].filter(c=>c.ownerId!==e.id);}this.drawCard();this.log('INCAPACITATED',`${e.displayName}重伤，移除所属卡并补抽一张`,e.id);}return;}
    if(e.sp<=EPS&&e.status!=='PANICKED'){e.status='PANICKED';e.panicUntilSec=now+cfg.combat.panicDurationSec;e.windupEndsAtSec=null;e.attackPhase='RECOVERY';if(enc.deck.pendingCast&&enc.deck.hand.find(c=>c.instanceId===enc.deck.pendingCast!.instanceId)?.ownerId===e.id)this.cancelCard('所属员工恐慌，施牌取消');}
    if(e.status==='PANICKED'&&(now+EPS>=e.panicUntilSec||e.sp>=e.spMax*cfg.combat.panicRecoverFraction)){e.sp=Math.max(e.sp,e.spMax*cfg.combat.panicRecoverFraction);e.status='SUPPRESSING';}
  }
  private checkResult():void{const enc=this.state.encounter;if(!enc||enc.result)return;if(enc.enemies.find(n=>!n.isClone)?.suppressionHp!<=EPS)this.complete('VICTORY');else if(this.state.employees.filter(e=>enc.squadIds.includes(e.id)).every(e=>e.hp<=EPS))this.complete('DEFEAT');}
  private complete(result:NonNullable<EncounterState['result']>):void{const enc=this.state.encounter;if(!enc||enc.result)return;this.cancelCard();enc.result=result;for(const e of this.state.employees.filter(e=>enc.squadIds.includes(e.id))){e.windupEndsAtSec=null;e.path=[];e.attackPhase='RECOVERY';}for(const n of enc.enemies){n.windupEndsAtSec=null;n.attackPhase='RECOVERY';}const room=this.state.rooms.find(r=>r.anomalyId===enc.targetAnomalyId)!;if(result==='VICTORY'&&!enc.rewardApplied){if(enc.mode==='CAPTURE'&&!room.owned){room.owned=true;room.rank=1;}else if(enc.mode==='BREACH_CHALLENGE'&&room.rank===enc.startRank){room.rank=Math.min(cfg.facility.maxRank,room.rank+1);}enc.rewardApplied=true;for(const n of enc.enemies)if(n.isClone)n.suppressionHp=0;const a=anomalyById[room.anomalyId];if(!this.state.ownedWeapons.includes(a.weaponId))this.state.ownedWeapons.push(a.weaponId);if(!this.state.ownedArmors.includes(a.armorId))this.state.ownedArmors.push(a.armorId);}room.state=room.owned?'STABLE':'LOCKED';this.log('RESULT',result==='VICTORY'?`${anomalyById[room.anomalyId].name}收容成功，当前 ${room.rank} 阶`:result==='DEFEAT'?'战斗失败，未获得进度':'战斗放弃，无奖励');}
  abandonEncounter():void{this.complete('ABANDONED');}
  finishEncounter():Result<void>{const enc=this.state.encounter;if(!enc?.result)return fail('BATTLE','战斗尚未结束');for(const e of this.state.employees.filter(e=>enc.squadIds.includes(e.id))){e.location={...e.home};e.status=e.hp<=0?'INCAPACITATED':e.sp<=0?'PANICKED':'IDLE';e.order={kind:'IDLE'};e.path=[];e.windupEndsAtSec=null;e.attackPhase='RECOVERY';e.blockUntilSec=0;e.counterUntilSec=0;e.idleNextAtSec=this.state.simulationTimeSec+cfg.facility.idleWaitSec;}this.state.encounter=null;this.state.phase='FACILITY';this.setPaused(false);return success();}
}
