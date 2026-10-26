import { describe, expect, it } from 'vitest';
import { V3Simulation } from '../src/v3/engine';
import { cardById, v3Config } from '../src/v3/config';

const run=(simulation:V3Simulation,seconds:number):void=>{for(let i=0;i<Math.ceil(seconds/.05);i++)simulation.step();};

function captureReady():V3Simulation {
  const simulation=new V3Simulation();
  simulation.state.rooms[0]!.rank=2;
  expect(simulation.startEncounter('CAPTURE','N02').ok).toBe(true);
  const encounter=simulation.state.encounter!;
  const target=encounter.enemies[0]!;
  target.suppressionHp=1;
  target.nextAttackStartAtSec=1e9;
  simulation.state.employees.forEach((employee,index)=>{
    employee.location={...target.location,x:target.location.x-40-index*20};
    employee.nextAttackStartAtSec=simulation.state.simulationTimeSec;
  });
  run(simulation,2);
  expect(encounter.capturePhase).toBe('CAPTURABLE');
  return simulation;
}

describe('v0.4 capture confirmation',()=>{
  it('locks the target at the configured threshold and requires a device action',()=>{
    const simulation=captureReady(),encounter=simulation.state.encounter!,target=encounter.enemies[0]!;
    expect(target.suppressionHp).toBeCloseTo(target.suppressionHpMax*v3Config.capture.thresholdFraction.N02);
    run(simulation,1);
    expect(encounter.result).toBeNull();
    expect(target.suppressionHp).toBeGreaterThan(0);
  });
  it('walks an operator into range and completes capture through the shared simulation',()=>{
    const simulation=captureReady(),encounter=simulation.state.encounter!;
    expect(simulation.startCapture('E01').ok).toBe(true);
    expect(encounter.capturePhase).toBe('CAPTURING');
    run(simulation,10);
    expect(encounter.result).toBe('VICTORY');
    expect(simulation.state.rooms[1]).toMatchObject({owned:true,rank:1,state:'STABLE'});
  });
  it('keeps capture progress frozen while paused and returns to capturable on timeout',()=>{
    const simulation=captureReady(),encounter=simulation.state.encounter!;
    expect(simulation.startCapture('E01').ok).toBe(true);
    simulation.setPaused(true);
    const before=encounter.captureProgressSec;
    run(simulation,10);
    expect(encounter.captureProgressSec).toBe(before);
    simulation.setPaused(false);
    encounter.captureDeadlineSec=simulation.state.simulationTimeSec;
    simulation.step();
    expect(encounter.capturePhase).toBe('CAPTURABLE');
    expect(encounter.result).toBeNull();
  });
  it('resumes retained progress after a capture interruption instead of resetting it',()=>{
    const simulation=captureReady(),encounter=simulation.state.encounter!;
    expect(simulation.startCapture('E01').ok).toBe(true);
    run(simulation,1);
    const retained=(encounter.captureProgressSec??0)*v3Config.capture.progressRetainFraction;
    expect(retained).toBeGreaterThan(0);
    expect(simulation.moveEmployee('E01',{x:300,y:500}).ok).toBe(true);
    expect(encounter.capturePhase).toBe('CAPTURABLE');
    expect(encounter.captureProgressSec).toBeCloseTo(retained);
    expect(simulation.startCapture('E01').ok).toBe(true);
    expect(encounter.captureProgressSec).toBeCloseTo(retained);
  });
  it('cancels the selected employee pending cast before starting the device',()=>{
    const simulation=captureReady(),encounter=simulation.state.encounter!,target=encounter.enemies[0]!;
    const card=[...encounter.deck.hand,...encounter.deck.drawPile].find(item=>item.ownerId==='E01'&&cardById[item.cardId].target==='ENEMY')!;
    encounter.deck.hand=encounter.deck.hand.filter(item=>item.instanceId!==card.instanceId);
    encounter.deck.drawPile=encounter.deck.drawPile.filter(item=>item.instanceId!==card.instanceId);
    encounter.deck.hand.push(card);
    expect(simulation.queueCard(card.instanceId,target.id).ok).toBe(true);
    expect(encounter.deck.pendingCast?.instanceId).toBe(card.instanceId);
    expect(simulation.startCapture('E01').ok).toBe(true);
    expect(encounter.deck.pendingCast).toBeNull();
    expect(encounter.deck.hand).toContainEqual(card);
    expect(encounter.captureEmployeeId).toBe('E01');
  });
});
