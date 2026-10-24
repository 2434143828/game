#!/usr/bin/env python3
"""Validate the design package, not a game implementation. Standard library only."""
from __future__ import annotations
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
ERRORS: list[str] = []
CHECKS = 0

def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not condition:
        ERRORS.append(message)

def num(value: Any, path: str, lower: float = 0, upper: float | None = None) -> None:
    valid = isinstance(value, (int, float)) and not isinstance(value, bool)
    valid = valid and math.isfinite(value) and value >= lower
    if upper is not None:
        valid = valid and value <= upper
    check(bool(valid), f'{path}: invalid numeric value {value!r}')

def integer(value: Any, path: str, lower: int = 0) -> None:
    check(isinstance(value, int) and not isinstance(value, bool) and value >= lower,
          f'{path}: expected integer >= {lower}, got {value!r}')

def damage(d: dict[str, Any], path: str) -> None:
    check(set(d) == {'type', 'kind', 'amount'}, f'{path}: unexpected/missing fields')
    if d.get('type') == 'PALE':
        check(d.get('kind') == 'MAX_RATIO', f'{path}: PALE must use MAX_RATIO')
        num(d.get('amount'), path + '.amount', 0.0001, 1)
    else:
        check(d.get('type') in ('RED', 'WHITE', 'BLACK'), f'{path}: unknown damage type')
        check(d.get('kind') == 'FLAT', f'{path}: non-PALE must use FLAT')
        num(d.get('amount'), path + '.amount', 0)

def resistances(r: dict[str, Any], path: str) -> None:
    check(set(r) == {'RED', 'WHITE', 'BLACK', 'PALE'}, f'{path}: four types required')
    for k, v in r.items():
        num(v, path + '.' + k, 0.01, 3)

def unique_ids(values: list[dict[str, Any]], path: str) -> set[str]:
    ids = [x['id'] for x in values]
    check(len(ids) == len(set(ids)), f'{path}: duplicate IDs')
    return set(ids)

def load(name: str) -> Any:
    return json.loads((ROOT / 'config' / name).read_text(encoding='utf-8'))

def validate_facility() -> None:
    """Check the authored spatial extension without changing the seven original gameplay configs."""
    facility = load('facility.json')
    bounds, camera, ambient = facility['bounds'], facility['camera'], facility['ambient']
    for key in ('width', 'height'):
        num(bounds[key], 'facility.bounds.' + key, 1)
    for key in ('minZoom', 'zoom', 'maxZoom'):
        num(camera[key], 'facility.camera.' + key, 0.01)
    check(camera['minZoom'] <= camera['zoom'] <= camera['maxZoom'], 'facility: camera zoom order')
    num(ambient['speedMultiplier'], 'facility.ambient.speedMultiplier', 0.01, 1)
    num(ambient['waitMinSec'], 'facility.ambient.waitMinSec')
    num(ambient['waitMaxSec'], 'facility.ambient.waitMaxSec', ambient['waitMinSec'])
    ids = unique_ids(facility['nodes'], 'facility.nodes')
    nodes = {n['id']: n for n in facility['nodes']}
    graph = {node_id: set() for node_id in ids}
    for n in nodes.values():
        num(n['x'], 'facility.' + n['id'] + '.x', bounds['x'], bounds['x'] + bounds['width'])
        num(n['y'], 'facility.' + n['id'] + '.y', bounds['y'], bounds['y'] + bounds['height'])
        check(n['zone'] in ('ROOM', 'CORRIDOR', 'SAFE', 'TRANSIT'), 'facility: node zone')
    for edge in facility['edges']:
        check(edge['from'] in ids and edge['to'] in ids, 'facility: missing edge node')
        if edge['from'] not in ids or edge['to'] not in ids:
            continue
        a, b = nodes[edge['from']], nodes[edge['to']]
        check((a['x'] == b['x']) != (a['y'] == b['y']), 'facility: nonzero orthogonal edge')
        check(edge['kind'] in ('ROOM', 'CORRIDOR', 'SAFE', 'TRANSIT'), 'facility: edge kind')
        if edge['kind'] == 'CORRIDOR':
            check(a['y'] == b['y'] and a.get('floorId') == b.get('floorId'), 'facility: corridor floor mismatch')
        graph[edge['from']].add(edge['to'])
        graph[edge['to']].add(edge['from'])
    visited, pending = set(), [next(iter(ids))]
    while pending:
        node_id = pending.pop()
        if node_id not in visited:
            visited.add(node_id)
            pending.extend(graph[node_id] - visited)
    check(visited == ids, 'facility: all paths must be connected')
    check(set(facility['rooms']) == {f'N0{i}' for i in range(1, 6)}, 'facility: same five room IDs')
    for room_id, room in facility['rooms'].items():
        for key in ('workNodeId', 'doorNodeId', 'entryNodeId'):
            check(room[key] in ids, f'facility.{room_id}.{key}: missing node')
        work = nodes.get(room['workNodeId'], {})
        check(work.get('roomId') == room_id and work.get('zone') == 'ROOM', f'facility.{room_id}: work position')
    for key in ('idleNodeIds', 'patrolNodeIds'):
        check(bool(facility[key]), f'facility.{key}: empty route list')
        for node_id in facility[key]:
            check(nodes.get(node_id, {}).get('zone') == 'CORRIDOR', f'facility.{key}: public corridor required')
    check(any(n['zone'] == 'SAFE' and n['x'] == facility['safePoint']['x']
              and n['y'] == facility['safePoint']['y'] for n in nodes.values()), 'facility: safe spawn node')

def validate() -> int:
    expected = {'game.json', 'days.json', 'anomalies.json', 'equipment.json',
                'skills.json', 'assets.json', 'localization.zh-CN.json', 'facility.json',
                'gameplay-v3.json'}
    # The independent v0.3 extension has a strict Zod schema in src/v3/config.ts
    # and malformed-input coverage in tests/v3-config.test.ts. Keep the original
    # eight files fully validated below; this allowlist still rejects other JSON.
    check({p.name for p in (ROOT / 'config').glob('*.json')} == expected,
          'config: expected seven original gameplay JSON files, facility.json and gameplay-v3.json')
    validate_facility()
    g, days, ad, eq, skills, assets, loc = [load(f) for f in (
        'game.json', 'days.json', 'anomalies.json', 'equipment.json',
        'skills.json', 'assets.json', 'localization.zh-CN.json')]
    anomalies = ad['anomalies']
    aid = unique_ids(anomalies, 'anomalies')
    wid = unique_ids(eq['weapons'], 'weapons')
    armorid = unique_ids(eq['armors'], 'armors')
    sid = unique_ids(skills, 'skills')
    check(aid == {f'N0{i}' for i in range(1, 6)}, 'exactly five anomaly IDs')
    check([a['name'] for a in anomalies] == ['奶龙', '耄耋', '大狗', '叮咚鸡', '咕咕嘎嘎'], 'five names/order mismatch')
    check(wid == {f'W0{i}' for i in range(6)}, 'five special and one starter weapon')
    check(armorid == {f'A0{i}' for i in range(6)}, 'five special and one starter armor')
    check(sid == {f'S0{i}' for i in range(1, 6)}, 'exactly five skills')
    integer(g['schemaVersion'], 'schemaVersion', 1)
    check(g['schemaVersion'] == 1, 'unsupported design schema')
    econ = g['economy']
    for k in ('initialWallet','archiveBehaviorCost','archiveCombatCost','equipmentPairCost','skillUnlockCost'):
        integer(econ[k], 'economy.'+k)
    check(econ['spendingReducesQuotaProgress'] is False, 'spending must not roll back quota')
    check(econ['quotaCountsOnlyCompletedWork'] is True, 'quota must count completed work')
    check(econ['equipmentCopiesPerAnomaly'] == 1, 'one equipment copy per anomaly')
    check(econ['breachReward'] == econ['suppressionReward'] == econ['dailyBonus'] == 0, 'no breach/suppression/daily income reward')
    check(g['dayEnd']['requiresNoBreaches'] is False, 'end day must allow unresolved breaches')
    check(g['dayEnd']['requiresIdleEmployees'] is False, 'end day must allow unfinished work')
    check(g['work']['automaticRepeat'] is False, 'automatic repeat is out of scope')
    check(g['employee']['equipmentLostOnIncapacitation'] is False, 'prototype does not drop equipment')
    check(g['employee']['friendlyFire'] is False, 'prototype does not damage allies')
    check(g['combat']['blackToEnemyAppliesOnce'] is True, 'black damage applies once to enemy bar')
    check(g['simulation']['fixedStepSec'] == 0.05, 'fixed step must match default contract')
    check(g['simulation']['allowedTimeScales'] == [0,1,2], 'supported time scales')
    check(g['simulation']['pauseOnHidden'] is True, 'pause on hidden tab')
    p = g['pressure']
    check(0 <= p['min'] < p['warning'] < p['danger'] < p['breachThreshold'], 'pressure thresholds must increase')
    num(p['afterRecovery'], 'pressure.afterRecovery', 0, p['breachThreshold']-1)
    num(p['recoverySec'], 'pressure.recoverySec', 0.05)
    for key in ('hpMax','spMax','moveSpeedPxPerSec','safeHpPerSec','safeSpPerSec'):
        num(g['employee'][key], 'employee.'+key, 0.01)
    num(g['employee']['panicRecoverFraction'], 'employee.panicRecoverFraction', 0.01, 1)
    unique_ids(days, 'days')
    check([d['day'] for d in days] == [1,2,3], 'day sequence must be 1,2,3')
    seen_a: set[str] = set()
    seen_e: set[str] = set()
    for day in days:
        integer(day['quota'], 'day.quota', 1)
        check(not (set(day['newAnomalyIds']) & seen_a), 'new anomaly duplicates earlier day')
        check(not (set(day['newEmployeeIds']) & seen_e), 'new employee duplicates earlier day')
        seen_a.update(day['newAnomalyIds']); seen_e.update(day['newEmployeeIds'])
        check(set(day['activeAnomalyIds']) == seen_a, 'active roster must accumulate')
        check(set(day['activeAnomalyIds']) <= aid, 'unknown day anomaly reference')
        check(day['rosterCount'] == len(seen_e), 'employee rosterCount mismatch')
        check(all(re.fullmatch(r'E0[1-6]', e) for e in day['newEmployeeIds']), 'employee ID namespace mismatch')
    check(seen_a == aid, 'all five anomalies must be available by day3')
    check(len(seen_e) == 6, 'six employees by day3')
    check(len(g['layout']['roomCentersX']) == 5, 'five room layout positions')
    check(g['tutorial']['anomalyId'] in aid, 'tutorial source exists')
    check(g['tutorial']['offerAtProduced'] < days[0]['quota'], 'tutorial before day1 quota')
    check(g['tutorial']['grantsEnergy'] is False, 'no tutorial energy reward')
    check(g['tutorial']['optional'] is True, 'tutorial can be skipped')

    amap = {a['id']: a for a in anomalies}
    wmap = {w['id']: w for w in eq['weapons']}
    armap = {a['id']: a for a in eq['armors']}
    smap = {s['id']: s for s in skills}
    check({a['roomIndex'] for a in anomalies} == set(range(5)), 'room index mismatch')
    rules = {'REPEAT_INTERACT','REPEAT_WORKER','RAPID_RESTART','NON_SOOTHE_STREAK','NEGLECT'}
    check({a['specialWorkRule']['kind'] for a in anomalies} == rules, 'five distinct work rules expected')
    for a in anomalies:
        path = a['id']
        check(a['weaponId'] in wid and a['armorId'] in armorid and a['skillId'] in sid, path+': missing linked content')
        check(wmap[a['weaponId']]['sourceAnomalyId'] == a['id'], path+': weapon source mismatch')
        check(armap[a['armorId']]['sourceAnomalyId'] == a['id'], path+': armor source mismatch')
        check(smap[a['skillId']]['sourceAnomalyId'] == a['id'], path+': skill source mismatch')
        check(a['id'] in days[a['unlockDay']-1]['newAnomalyIds'], path+': wrong unlock day')
        num(a['initialPressure'], path+'.initialPressure', 0, p['breachThreshold']-1)
        check(len(a['workProfiles']) == 3, path+': exactly three work profiles')
        check({w['type'] for w in a['workProfiles']} == {'OBSERVE','INTERACT','SOOTHE'}, path+': work types mismatch')
        for w in a['workProfiles']:
            num(w['durationSec'], path+'.durationSec', 0.05)
            integer(w['energy'], path+'.energy', 1)
            num(w['pressureDelta'], path+'.pressureDelta', -100, 100)
            damage(w['hazard'], path+'.work.hazard')
        soothe = next(w for w in a['workProfiles'] if w['type']=='SOOTHE')
        check(soothe['pressureDelta'] < 0 and soothe['energy'] > 0, path+': positive-yield pressure relief needed')
        resistances(a['resistances'], path+'.resistances')
        b = a['breach']
        damage(b['damage'], path+'.breach.damage')
        num(b['suppressionHpMax'], path+'.suppressionHpMax', 1)
        num(b['moveSpeedPxPerSec'], path+'.speed', 0)
        num(b['attackPeriodSec'], path+'.period', 0.05)
        num(b['windupSec'], path+'.windup', 0.05, b['attackPeriodSec'])
        check(b['firstAttackDelaySec'] >= g['combat']['breachSpawnGraceSec'], path+': first attack earlier than grace')
        check(b['targetScope'] in ('CORRIDOR','FACILITY_EXCEPT_SAFE'), path+': invalid scope')
        if 'cloneCount' in b:
            check(a['id']=='N01' and b['cloneCount']==2, 'only N01 has two clones')
            check(b['clonesCanSpawnClones'] is False, 'clones cannot recurse')
            damage(b['cloneDamage'], path+'.cloneDamage')
        check(bool(a['archive']['behavior']) and bool(a['archive']['combat']), path+': missing archive text')
    check(len(ad['links']) == 1, 'only one link in prototype')
    link = ad['links'][0]
    check(link['sourceAnomalyId']=='N04' and link['targetAnomalyId']=='N03', 'link direction mismatch')
    check(link['oncePerSourceBreach'] is True and link['reverseLink'] is False, 'link must be one-shot and directed')
    num(link['ifTargetContained']['pressureAdd'], 'link.pressure', 1, 100)
    for w in eq['weapons']:
        damage(w['damage'], w['id']+'.damage')
        num(w['attackPeriodSec'], w['id']+'.period', 0.05)
        num(w['windupSec'], w['id']+'.windup', 0.01, w['attackPeriodSec'])
        num(w['rangePx'], w['id']+'.range', 1)
        check(set(w)=={'id','name','sourceAnomalyId','damage','attackPeriodSec','rangePx','windupSec','unlimitedStarter'}, w['id']+': no extra/passive equipment fields')
        check(w['unlimitedStarter'] == (w['id']=='W00'), w['id']+': starter flag mismatch')
    for a in eq['armors']:
        resistances(a['resistances'], a['id']+'.resistances')
        check(set(a)=={'id','name','sourceAnomalyId','resistances','unlimitedStarter'}, a['id']+': no passive effects on armor')
        check(a['unlimitedStarter'] == (a['id']=='A00'), a['id']+': starter flag mismatch')
    check({s['hotkey'] for s in skills} == {'1','2','3','4','5'}, 'skill hotkeys must be unique')
    for s in skills:
        check(s['sourceAnomalyId'] in aid, s['id']+': invalid source')
        integer(s['energyCost'], s['id']+'.energyCost', 1)
        num(s['cooldownSec'], s['id']+'.cooldown', 0.05)
        if 'damage' in s: damage(s['damage'], s['id']+'.damage')
        for k in ('durationSec','radiusPx','knockbackPx','restoreSp'):
            if k in s: num(s[k], s['id']+'.'+k, 0.01)
    check({x['anomalyId'] for x in assets['characters']} == aid, 'asset sources must cover all five')
    check(all(x['officialReferenceProvided'] is False for x in assets['characters']), 'no official references included in this package')
    check(all(isinstance(k,str) and isinstance(v,str) for k,v in loc.items()), 'localization must be string mapping')
    for key in ('energy.wallet','energy.quota','day.finish','hint.noEnergyOnBreach','error.invalidSkillTarget'):
        check(key in loc, 'missing localization: '+key)

    quota_total = sum(d['quota'] for d in days)
    cost_per = sum(econ[k] for k in ('archiveBehaviorCost','archiveCombatCost','equipmentPairCost','skillUnlockCost'))
    budget = econ['initialWallet'] + quota_total
    check(budget >= cost_per*5, 'all fixed content should be affordable at exact three-day quotas')
    doc = (ROOT/'docs/01_游戏策划与实现规格.md').read_text(encoding='utf-8')
    check('{{' not in doc, 'unexpanded main-document template')
    for a in anomalies: check(a['name'] in doc, 'missing anomaly in main document')
    for f in ('README.md','AGENTS.md','CODEX_START.md','docs/DECISIONS.md',
              'docs/02_开发任务与验收.md','docs/03_数值与数据契约.md',
              'docs/04_素材与文案清单.md','contracts/data-contract.ts'):
        check((ROOT/f).is_file(), 'missing delivery file: '+f)
    acceptance=(ROOT/'docs/02_开发任务与验收.md').read_text(encoding='utf-8')
    caseids=re.findall(r'^\| ([GWCSP]\d{2}) \|', acceptance, flags=re.M)
    check(len(caseids)==len(set(caseids)), 'duplicate acceptance case ID')
    if ERRORS:
        print('DESIGN VALIDATION FAILED')
        for e in ERRORS: print(' -',e)
        return 1
    print(f'DESIGN VALIDATION PASSED: {CHECKS} assertions')
    print('JSON files: 9 (8 legacy files validated here + independent gameplay-v3 extension)')
    print('v0.3 validation: src/v3/config.ts Zod schema and tests/v3-config.test.ts; run npm run test.')
    print('Anomalies: 5; work profiles: 15; special weapons/armors: 5 each; skills: 5; links: 1')
    print(f'Implementation acceptance scenarios specified (not executed): {len(caseids)}')
    print(f'Budget check: initial {econ["initialWallet"]} + quotas {quota_total} = {budget}; fixed unlocks {cost_per*5}; remaining {budget-cost_per*5}')
    print('Scope: design data validation only. No game implementation or playtest was executed.')
    return 0

if __name__ == '__main__':
    try:
        sys.exit(validate())
    except (OSError, json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        print(f'DESIGN VALIDATION ERROR: {exc}', file=sys.stderr)
        sys.exit(1)
