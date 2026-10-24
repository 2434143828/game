import { describe, expect, it } from 'vitest';
import raw from '../config/gameplay-v3.json';
import { validateV3Config } from '../src/v3/config';

function changed(path:string, value:unknown):unknown {
  const config=structuredClone(raw) as unknown as Record<string,unknown>;
  const keys=path.split('.');let target=config;
  for(const key of keys.slice(0,-1))target=target[key] as Record<string,unknown>;
  const last=keys[keys.length-1];if(value===undefined)delete target[last];else target[last]=value;
  return config;
}
describe('v0.3 config rejects malformed data before simulation',()=>{
  it('accepts current config without changing or sharing its source object',()=>{
    const source=structuredClone(raw),parsed=validateV3Config(source);
    expect(parsed).toEqual(source);expect(parsed).not.toBe(source);
    expect(Object.keys(parsed.cards)).toHaveLength(18);expect(Object.keys(parsed.enemies)).toHaveLength(5);
  });
  it.each([
    ['combat.drawIntervalSec',0],['combat.globalCardCooldownSec',-1],['combat.panicDurationSec',Infinity],
    ['combat.panicRecoverFraction',1.1],['combat.hitFeedbackSec',NaN],['combat.actionFeedbackSec','0.2'],
    ['facility.offlineEarningCapSec',-1],['facility.idleSpeedMultiplier',0],['facility.maxRank',4],
    ['enemies.N01.attackPeriodSec',0],['enemies.N02.rangePx',Infinity],['enemies.N03.hp',0],
    ['enemies.N04.moveSpeedPxPerSec',-10],['enemies.N05.specialEvery',1.5],['enemies.N01.cloneHp',NaN],
    ['captureCosts.N02',-50],['tier.armorMultipliers',[1,0,.8]],['production.N01',[2,NaN,7]],
  ])('reports source and numeric field %s',(path,value)=>{
    expect(()=>validateV3Config(changed(path,value))).toThrow('config/gameplay-v3.json');
    expect(()=>validateV3Config(changed(path,value))).toThrow(path);
  });
  it.each([
    ['version','0.4.0'],['combat.squadSize',4],['combat.startingHand',9],['combat.handLimit',2],
    ['cards.T01.effect','INSTANT_KILL'],['cards.T03.target','ENEMY'],['cards.T01.damage.type','GREEN'],
    ['cards.T01.damage',{kind:'MAX_RATIO',type:'WHITE',amount:.04}],['cards.T01.id','T02'],
    ['cards.BAD',{...raw.cards.T01,id:'BAD'}],['production.N06',[1,2,3]],['enemies.N05',undefined],
    ['captureCosts.N03',undefined],['weaponCards.W05',undefined],['weaponCards.W06',['T01','T02','T03']],
  ])('rejects unsupported enums or missing/extra IDs at %s',(path,value)=>{
    expect(()=>validateV3Config(changed(path,value))).toThrow('config/gameplay-v3.json');
  });
  it.each([
    ['cards.T01.damage',undefined],['cards.T02.durationSec',undefined],['cards.T02.amount',1.1],
    ['cards.T03.amount',0],['cards.N01_2.durationSec',0],['cards.N01_3.amount',2],
    ['cards.N02_3.amount',undefined],['cards.N03_2.amount',-100],['cards.N04_2.durationSec',undefined],
    ['cards.N04_3.target','SELF'],['cards.N05_2.damage',raw.cards.T01.damage],['cards.T01.durationSec',3],
  ])('rejects unusable or silently ignored effect parameters at %s',(path,value)=>{
    expect(()=>validateV3Config(changed(path,value))).toThrow('config/gameplay-v3.json');
  });
  it.each([
    ['weaponCards.W00',['T01','T02']],['weaponCards.W01',['N01_1','N01_1','N01_2']],
    ['weaponCards.W02',['T01','N02_2','N02_3']],['cards.N05_3',undefined],
    ['tier.damageMultipliers',[1,1.25]],['tier.armorMultipliers',[1,.9,.8,.7]],['production.N04',[8,14]],
    ['arena.employeeSpawnX',[240,320]],['arena.employeeSpawnX',[240,240,400]],['arena.maxX',100],
    ['arena.employeeSpawnX',[0,320,400]],['arena.enemySpawnX',1300],
    ['enemies.N01.cloneSpawnOffsets',[90,900]],['enemies.N01.cloneSpawnOffsets',[90,90]],
    ['enemies.N02.cloneCount',2],['enemies.N01.windupSec',4],
  ])('rejects cross-field contract violation at %s',(path,value)=>{
    expect(()=>validateV3Config(changed(path,value))).toThrow('config/gameplay-v3.json');
  });
});
