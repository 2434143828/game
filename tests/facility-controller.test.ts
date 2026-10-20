import { describe, expect, it, vi } from 'vitest';
import type { AnomalyId, EmployeeId, SaveEnvelope } from '../contracts/data-contract';
import { anomalyById, config, dayByNumber, skillById } from '../src/data/config';
import { FacilityController } from '../src/game/FacilityController';
import { createFacilitySimulation } from '../src/game/createFacilitySimulation';
import { initialProgress, makeSnapshot } from '../src/simulation/state';
import { largeFacilityNavigation } from '../src/simulation/graphNavigation';

function memoryStorage(raw: string | null = null) {
  const storage = {
    raw,
    getItem: vi.fn((_key: string): string | null => storage.raw),
    setItem: vi.fn((_key: string, value: string): void => { storage.raw = value; }),
  };
  return storage;
}
function saved(storage: ReturnType<typeof memoryStorage>): SaveEnvelope {
  return JSON.parse(storage.raw!) as SaveEnvelope;
}

describe('five-room facility controller: real simulation and explicit campaign persistence', () => {
  it('keeps campaign day one at four and sandbox at the configured day-three roster without bonuses', () => {
    const before = JSON.stringify(config);
    const campaign = createFacilitySimulation();
    const sandbox = createFacilitySimulation('sandbox');
    expect(campaign.state).toMatchObject({ day: 1, phase: 'DAY_PREP', producedToday: 0 });
    expect(campaign.state.employees.map(employee => employee.id)).toEqual(dayByNumber[1].newEmployeeIds);
    expect(sandbox.state).toMatchObject({ day: 3, phase: 'RUNNING', producedToday: 0, simulationTimeSec: 0 });
    expect(sandbox.state.employees).toHaveLength(6);
    expect(sandbox.state.rooms.filter(room => room.mode === 'CONTAINED').map(room => room.anomalyId)).toEqual(dayByNumber[3].activeAnomalyIds);
    expect(sandbox.state.progress).toEqual(initialProgress());
    expect(sandbox.state.employees.every(employee => employee.weaponId === 'W00' && employee.armorId === 'A00')).toBe(true);
    expect(JSON.stringify(config)).toBe(before);
  });

  it('never touches disk on construction, unsaved start, restart, mode switch, or any sandbox save/load request', () => {
    const storage = memoryStorage('existing player save');
    const controller = new FacilityController('campaign', storage);
    controller.issue({ type: 'START_DAY' });
    controller.restart();
    controller.setMode('sandbox');
    expect(controller.saveCampaign().ok).toBe(false);
    expect(controller.loadCampaign().ok).toBe(false);
    controller.triggerBreach('N03');
    controller.restart();
    controller.setMode('campaign');
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.raw).toBe('existing player save');
  });

  it('dispatches one real employee to each selected room and earns only completed configured work', () => {
    const controller = new FacilityController('sandbox');
    const assignments = [
      ['N01', 'E01'], ['N02', 'E02'], ['N03', 'E03'], ['N04', 'E04'], ['N05', 'E05'],
    ] as const satisfies readonly (readonly [AnomalyId, EmployeeId])[];
    for (const [roomId, employeeId] of assignments) {
      controller.select([employeeId]);
      controller.selectRoom(roomId);
      expect(controller.assignWork('OBSERVE').ok).toBe(true);
      expect(controller.state.rooms.find(room => room.anomalyId === roomId)?.work).toMatchObject({
        employeeId, roomId, type: 'OBSERVE', phase: 'TRAVELLING',
      });
    }
    expect(controller.state.producedToday).toBe(0);
    for (let step = 0; step < 55 / config.game.simulation.fixedStepSec; step++) controller.simulation.step();
    const expectedIncome = assignments.reduce((sum, [roomId]) => sum + anomalyById[roomId].workProfiles.find(work => work.type === 'OBSERVE')!.energy, 0);
    expect(controller.state.processedWorkIncomeIds.size).toBe(5);
    expect(controller.state.producedToday).toBe(expectedIncome);
    expect(controller.state.progress.wallet).toBe(config.game.economy.initialWallet + expectedIncome);
    const commands = controller.events.filter(event => event.type === 'COMMAND');
    expect(commands).toHaveLength(5);
    expect(new Set(commands.map(event => (event.detail as { command: { commandId: string } }).command.commandId)).size).toBe(5);
  });

  it('requires one selected worker, respects locked campaign rooms, and records failed engine commands', () => {
    const controller = new FacilityController();
    expect(controller.assignWork('OBSERVE')).toMatchObject({ ok: false, code: 'SELECTION' });
    controller.issue({ type: 'START_DAY' });
    controller.select(['E01', 'E02']);
    expect(controller.assignWork('OBSERVE')).toMatchObject({ ok: false, code: 'SELECTION' });
    controller.select(['E01']);
    controller.selectRoom('N05');
    expect(controller.assignWork('OBSERVE')).toMatchObject({ ok: false, code: 'ROOM' });
    expect(controller.events.at(-1)?.detail).toMatchObject({ command: { roomId: 'N05' }, result: { ok: false } });
    expect(controller.state.rooms.find(room => room.anomalyId === 'N05')?.mode).toBe('LOCKED');
  });

  it('keeps paused move/stop/retreat commands in the same real simulation without advancing it', () => {
    const controller = new FacilityController('sandbox');
    controller.select(['E01']);
    controller.togglePause();
    const position = { ...controller.state.employees[0]!.location };
    expect(controller.issue({ type: 'MOVE', employeeIds: ['E01'], point: largeFacilityNavigation.doorPoint('N01') }).ok).toBe(true);
    controller.simulation.advance(1);
    expect(controller.state.employees[0]!.location).toEqual(position);
    expect(controller.state.simulationTimeSec).toBe(0);
    expect(controller.stop().ok).toBe(true);
    expect(controller.state.employees[0]!.order.kind).toBe('IDLE');
    expect(controller.retreat().ok).toBe(true);
    controller.togglePause();
    expect(controller.state.timeScale).toBe(1);
  });

  it('allows genuine breach with linked pressure only in sandbox and awards no resources', () => {
    const campaign = new FacilityController();
    expect(campaign.triggerBreach('N01')).toMatchObject({ ok: false, code: 'MODE' });
    const controller = new FacilityController('sandbox');
    controller.selectRoom('N04');
    const dogBefore = controller.state.rooms.find(room => room.anomalyId === 'N03')!.pressure;
    expect(controller.triggerBreach().ok).toBe(true);
    expect(controller.state.rooms.find(room => room.anomalyId === 'N04')!.mode).toBe('BREACHED');
    expect(controller.state.rooms.find(room => room.anomalyId === 'N03')!.pressure).toBeGreaterThan(dogBefore);
    expect(controller.state.enemies.some(enemy => enemy.sourceAnomalyId === 'N04')).toBe(true);
    expect(controller.state.progress.wallet).toBe(50);
    expect(controller.state.producedToday).toBe(0);
    expect(controller.state.timeScale).toBe(0);
  });

  it('buys skills at the configured price, cancels aim for free, rejects invalid targets, and charges a valid hit once', () => {
    const controller = new FacilityController('sandbox');
    expect(controller.armSkill('S01')).toMatchObject({ ok: false, code: 'LOCKED' });
    expect(controller.issue({ type: 'PURCHASE', anomalyId: 'N01', item: 'SKILL' }).ok).toBe(true);
    const wallet = 50 - config.game.economy.skillUnlockCost;
    expect(controller.state.progress.wallet).toBe(wallet);
    expect(controller.armSkill('S01').ok).toBe(true);
    controller.cancelSkill();
    expect(controller.activeSkillId).toBeNull();
    expect(controller.state.progress.wallet).toBe(wallet);
    controller.armSkill('S01');
    expect(controller.castAt({ kind: 'ENEMY', enemyId: 'missing' })).toMatchObject({ ok: false, code: 'TARGET' });
    expect(controller.activeSkillId).toBe('S01');
    expect(controller.state.skillCooldownRemainingSec.S01).toBe(0);
    expect(controller.state.progress.wallet).toBe(wallet);
    controller.triggerBreach('N01');
    const target = controller.state.enemies[0]!;
    expect(controller.castAt({ kind: 'ENEMY', enemyId: target.id }).ok).toBe(true);
    expect(controller.message).toBe('技能已生效。');
    expect(controller.activeSkillId).toBeNull();
    expect(target.stunnedUntilSec).toBeGreaterThan(controller.state.simulationTimeSec);
    expect(controller.state.progress.wallet).toBe(wallet - skillById.S01.energyCost);
    expect(controller.armSkill('S01')).toMatchObject({ ok: false, code: 'COOLDOWN' });
  });

  it('casts the global movement skill through a normal command without leaving point targeting armed', () => {
    const controller = new FacilityController('sandbox');
    controller.issue({ type: 'PURCHASE', anomalyId: 'N04', item: 'SKILL' });
    expect(controller.armSkill('S04').ok).toBe(true);
    expect(controller.activeSkillId).toBeNull();
    expect(controller.state.employees.every(employee => employee.moveBuffRemainingSec > 0)).toBe(true);
    expect(controller.state.progress.wallet).toBe(50 - config.game.economy.skillUnlockCost - skillById.S04.energyCost);
    expect(controller.events.at(-1)?.detail).toMatchObject({ command: { type: 'CAST_SKILL', target: { kind: 'GLOBAL' } } });
  });

  it('handles the actual first-day teaching pause instead of leaving production permanently frozen', () => {
    const controller = new FacilityController();
    controller.issue({ type: 'START_DAY' });
    // Boundary fixture: the engine itself raises its tutorial after reaching the threshold.
    controller.state.producedToday = config.game.tutorial.offerAtProduced;
    controller.simulation.step();
    expect(controller.state.tutorialPending).toBe(true);
    expect(controller.state.timeScale).toBe(0);
    controller.handleTutorial(false);
    expect(controller.state.tutorialPending).toBe(false);
    expect(controller.state.progress.tutorialOfferHandled).toBe(true);
    expect(controller.state.timeScale).toBe(1);
    const handled = controller.events.filter(event => event.type === 'TUTORIAL').length;
    controller.handleTutorial(true);
    expect(controller.events.filter(event => event.type === 'TUTORIAL')).toHaveLength(handled);
    expect(controller.state.enemies).toHaveLength(0);
  });

  it('preserves corrupt disk content and current live state when explicit loading fails', () => {
    const storage = memoryStorage('{broken json');
    const controller = new FacilityController('campaign', storage);
    const current = controller.simulation;
    expect(controller.loadCampaign()).toMatchObject({ ok: false, code: 'INVALID_SAVE_JSON' });
    expect(controller.simulation).toBe(current);
    expect(storage.raw).toBe('{broken json');
    expect(storage.setItem).not.toHaveBeenCalled();
    controller.issue({ type: 'START_DAY' });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('explicitly saves an entry snapshot, never mid-day purchases or production, and reloads it in preparation', () => {
    const storage = memoryStorage();
    const controller = new FacilityController('campaign', storage);
    expect(controller.saveCampaign().ok).toBe(true);
    controller.issue({ type: 'START_DAY' });
    controller.issue({ type: 'PURCHASE', anomalyId: 'N01', item: 'SKILL' });
    expect(controller.state.progress.wallet).toBe(15);
    expect(controller.saveCampaign().ok).toBe(true);
    expect(saved(storage).snapshot.progress.wallet).toBe(50);
    expect(saved(storage).snapshot.progress.unlockedSkills).toEqual([]);
    expect(controller.loadCampaign().ok).toBe(true);
    expect(controller.state).toMatchObject({ phase: 'DAY_PREP', producedToday: 0, simulationTimeSec: 0 });
    expect(controller.state.progress.wallet).toBe(50);
  });

  it('commits the next day only after its snapshot saves, retaining the report if storage fails', () => {
    const storage = memoryStorage();
    const controller = new FacilityController('campaign', storage);
    controller.saveCampaign();
    controller.issue({ type: 'START_DAY' });
    // Isolated lifecycle fixture, not gameplay/economy acceptance evidence.
    controller.state.producedToday = dayByNumber[1].quota;
    controller.state.progress.wallet += dayByNumber[1].quota;
    controller.issue({ type: 'FINISH_DAY' });
    const reportSimulation = controller.simulation;
    const originalRaw = storage.raw;
    storage.setItem.mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(controller.nextDay()).toMatchObject({ ok: false, code: 'STORAGE_WRITE_FAILED' });
    expect(controller.simulation).toBe(reportSimulation);
    expect(controller.state).toMatchObject({ day: 1, phase: 'DAY_REPORT' });
    expect(storage.raw).toBe(originalRaw);
    expect(controller.nextDay().ok).toBe(true);
    expect(controller.state).toMatchObject({ day: 2, phase: 'DAY_PREP', producedToday: 0 });
    expect(controller.state.employees).toHaveLength(5);
    expect(saved(storage).snapshot.day).toBe(2);
    expect(saved(storage).snapshot.progress.wallet).toBe(200);
  });

  it('retains preparation if a previously enabled start-boundary write fails', () => {
    const storage = memoryStorage();
    const controller = new FacilityController('campaign', storage);
    controller.saveCampaign();
    storage.setItem.mockImplementationOnce(() => { throw new Error('quota exceeded'); });
    expect(controller.issue({ type: 'START_DAY' })).toMatchObject({ ok: false, code: 'STORAGE_WRITE_FAILED' });
    expect(controller.state.phase).toBe('DAY_PREP');
    expect(controller.events.filter(event => event.type === 'COMMAND')).toHaveLength(0);
  });

  it('restarts day two at its entry with prior purchases preserved and today purchases rolled back', () => {
    const progress = initialProgress();
    progress.wallet = 200;
    progress.research.N01.behavior = true;
    progress.unlockedSkills = ['S01'];
    const entry = makeSnapshot(2, progress);
    const storage = memoryStorage(JSON.stringify({ snapshot: entry, demoCompleted: false }));
    const controller = new FacilityController('campaign', storage);
    controller.loadCampaign();
    controller.issue({ type: 'START_DAY' });
    expect(controller.issue({ type: 'PURCHASE', anomalyId: 'N03', item: 'SKILL' }).ok).toBe(true);
    expect(controller.state.progress.unlockedSkills).toEqual(['S01', 'S03']);
    expect(controller.state.progress.wallet).toBe(200 - config.game.economy.skillUnlockCost);
    const calls = storage.setItem.mock.calls.length;
    controller.restart();
    expect(controller.state).toMatchObject({ day: 2, phase: 'DAY_PREP', producedToday: 0 });
    expect(controller.state.progress.wallet).toBe(200);
    expect(controller.state.progress.unlockedSkills).toEqual(['S01']);
    expect(controller.state.progress.research.N01.behavior).toBe(true);
    expect(storage.setItem).toHaveBeenCalledTimes(calls);
    controller.issue({ type: 'START_DAY' });
    expect(storage.setItem).toHaveBeenCalledTimes(calls + 1);
  });

  it('starts a fresh campaign from a completed campaign without replacing its existing completion save', () => {
    const entry = makeSnapshot(3, initialProgress());
    const raw = JSON.stringify({ snapshot: entry, demoCompleted: true });
    const storage = memoryStorage(raw);
    const controller = new FacilityController('campaign', storage);
    controller.loadCampaign();
    expect(controller.state.phase).toBe('COMPLETE');
    controller.newCampaign();
    expect(controller.state).toMatchObject({ day: 1, phase: 'DAY_PREP', producedToday: 0 });
    expect(controller.state.employees).toHaveLength(4);
    expect(controller.state.progress).toEqual(initialProgress());
    controller.issue({ type: 'START_DAY' });
    expect(storage.raw).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('persists and reloads the real completion marker without writing on load or carrying runtime income into the snapshot', () => {
    const entry = makeSnapshot(3, initialProgress());
    const storage = memoryStorage(JSON.stringify({ snapshot: entry, demoCompleted: false }));
    const controller = new FacilityController('campaign', storage);
    expect(controller.loadCampaign().ok).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
    controller.issue({ type: 'START_DAY' });
    // Isolated completion boundary fixture; full gameplay is tested separately.
    controller.state.producedToday = dayByNumber[3].quota;
    controller.state.progress.wallet += dayByNumber[3].quota;
    expect(controller.issue({ type: 'FINISH_DAY' }).ok).toBe(true);
    expect(saved(storage)).toMatchObject({ snapshot: { day: 3, progress: { wallet: 50 } }, demoCompleted: true });
    const calls = storage.setItem.mock.calls.length;
    expect(controller.loadCampaign().ok).toBe(true);
    expect(controller.state.phase).toBe('COMPLETE');
    expect(controller.state.producedToday).toBe(0);
    expect(storage.setItem).toHaveBeenCalledTimes(calls);
  });

  it('clears selection, aim and modal input blocking when replacing the simulation without erasing saved progress', () => {
    const storage = memoryStorage('saved bytes stay');
    const controller = new FacilityController('sandbox', storage);
    controller.select(['E06']);
    controller.selectRoom('N05');
    controller.inputBlocked = true;
    controller.issue({ type: 'PURCHASE', anomalyId: 'N01', item: 'SKILL' });
    controller.armSkill('S01');
    controller.setMode('campaign');
    expect(controller.selected.size).toBe(0);
    expect(controller.selectedRoomId).toBe('N01');
    expect(controller.activeSkillId).toBeNull();
    expect(controller.inputBlocked).toBe(false);
    expect(controller.state.employees).toHaveLength(4);
    expect(storage.raw).toBe('saved bytes stay');
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
