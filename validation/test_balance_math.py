"""Spec arithmetic examples only; NOT tests of a built game."""
from __future__ import annotations
import copy
import json
import math
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
def load(name):
    return json.loads((ROOT/'config'/name).read_text(encoding='utf-8'))
GAME=load('game.json')
DAYS=load('days.json')
ANOMALIES=load('anomalies.json')['anomalies']
EQUIPMENT=load('equipment.json')
SKILLS=load('skills.json')

def employee_damage(hp,sp,hp_max,damage,multiplier):
    """A reference arithmetic expression for the design, not game code."""
    if not all(math.isfinite(x) for x in (hp,sp,hp_max,multiplier)):
        raise ValueError('non-finite input')
    if min(hp,sp,hp_max,multiplier)<0:
        raise ValueError('negative input')
    amount=damage['amount']*multiplier
    t=damage['type']
    if t=='PALE':
        if damage['kind']!='MAX_RATIO' or not 0<=damage['amount']<=1:
            raise ValueError('invalid pale ratio')
        hp-=hp_max*amount
    elif damage['kind']!='FLAT':
        raise ValueError('non-pale damage must be flat')
    elif t=='RED': hp-=amount
    elif t=='WHITE': sp-=amount
    elif t=='BLACK': hp-=amount; sp-=amount
    else: raise ValueError('unknown damage type')
    return max(0,hp),max(0,sp)

def enemy_damage(hp_max,damage,multiplier):
    return damage['amount']*multiplier*(hp_max if damage['kind']=='MAX_RATIO' else 1)

class DamageExamples(unittest.TestCase):
    def test_red(self):
        h,s=employee_damage(100,100,100,{'type':'RED','kind':'FLAT','amount':12},.6)
        self.assertAlmostEqual(h,92.8); self.assertEqual(s,100)
    def test_white(self):
        h,s=employee_damage(100,100,100,{'type':'WHITE','kind':'FLAT','amount':12},.6)
        self.assertEqual(h,100); self.assertAlmostEqual(s,92.8)
    def test_black_does_not_split(self):
        h,s=employee_damage(100,100,100,{'type':'BLACK','kind':'FLAT','amount':12},.6)
        self.assertAlmostEqual(h,92.8); self.assertAlmostEqual(s,92.8)
    def test_pale_uses_max_not_current(self):
        h,s=employee_damage(50,100,100,{'type':'PALE','kind':'MAX_RATIO','amount':.06},.55)
        self.assertAlmostEqual(h,46.7); self.assertEqual(s,100)
    def test_enemy_pale(self):
        self.assertAlmostEqual(enemy_damage(240,{'type':'PALE','kind':'MAX_RATIO','amount':.04},1.2),11.52)
    def test_enemy_black_applies_once(self):
        self.assertAlmostEqual(enemy_damage(240,{'type':'BLACK','kind':'FLAT','amount':9},.7),6.3)
    def test_damage_clamps_at_zero(self):
        self.assertEqual(employee_damage(3,2,100,{'type':'BLACK','kind':'FLAT','amount':20},1),(0,0))
    def test_pale_four_is_not_four_percent(self):
        with self.assertRaises(ValueError):
            employee_damage(100,100,100,{'type':'PALE','kind':'MAX_RATIO','amount':4},1)
    def test_armor_changes_damage(self):
        dmg={'type':'WHITE','kind':'FLAT','amount':10}
        a=employee_damage(100,100,100,dmg,1)
        b=employee_damage(100,100,100,dmg,.6)
        self.assertEqual(a[1],90); self.assertEqual(b[1],94)
    def test_skill_two_example(self):
        self.assertAlmostEqual(enemy_damage(160,SKILLS[1]['damage'],.7),22.4)
    def test_skill_four_speed(self):
        self.assertEqual(GAME['employee']['moveSpeedPxPerSec']*SKILLS[3]['moveSpeedMultiplier'],165)
    def test_skill_five_panic_threshold(self):
        threshold=GAME['employee']['spMax']*GAME['employee']['panicRecoverFraction']
        self.assertGreaterEqual(SKILLS[4]['restoreSp'],threshold)

class EconomyExamples(unittest.TestCase):
    def test_total_unlock_budget(self):
        e=GAME['economy']
        per=sum(e[k] for k in ('archiveBehaviorCost','archiveCombatCost','equipmentPairCost','skillUnlockCost'))
        budget=e['initialWallet']+sum(d['quota'] for d in DAYS)
        self.assertEqual(per,110); self.assertEqual(per*5,550)
        self.assertEqual(budget,780); self.assertEqual(budget-per*5,230)
    def test_first_day_forces_initial_choice(self):
        e=GAME['economy']
        per=sum(e[k] for k in ('archiveBehaviorCost','archiveCombatCost','equipmentPairCost','skillUnlockCost'))
        self.assertLess(e['initialWallet']+DAYS[0]['quota'],per*2)
    def test_spending_does_not_rollback_quota(self):
        produced,wallet=150,80
        wallet-=SKILLS[4]['energyCost']
        self.assertEqual(wallet,64); self.assertEqual(produced,150)
        self.assertGreaterEqual(produced,DAYS[0]['quota'])
    def test_quota_not_wallet(self):
        produced,wallet=0,1000
        self.assertLess(produced,DAYS[0]['quota'])
        self.assertGreater(wallet,DAYS[0]['quota'])
    def test_snapshot_example_deep_copy(self):
        snapshot={'wallet':50,'ownedWeapons':[]}
        day=copy.deepcopy(snapshot)
        day['wallet']+=100
        day['ownedWeapons'].append('W01')
        retry=copy.deepcopy(snapshot)
        self.assertEqual(retry,{'wallet':50,'ownedWeapons':[]})
    def test_positive_yield_soothe_for_every_anomaly(self):
        for a in ANOMALIES:
            w=next(w for w in a['workProfiles'] if w['type']=='SOOTHE')
            self.assertGreater(w['energy'],0)
            self.assertLess(w['pressureDelta'],0)
    def test_threshold_work_has_no_income_example(self):
        before,delta,base_reward=90,25,18
        after=min(GAME['pressure']['breachThreshold'],before+delta)
        eligible=after<GAME['pressure']['breachThreshold']
        reward=base_reward if eligible else 0
        self.assertEqual(reward,0)
    def test_no_breach_or_suppression_reward(self):
        self.assertEqual(GAME['economy']['breachReward'],0)
        self.assertEqual(GAME['economy']['suppressionReward'],0)

if __name__=='__main__':
    unittest.main()
