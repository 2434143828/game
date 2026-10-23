"""One-time presentation adjustments; no simulation or navigation mutations."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
p = root / 'src/scenes/ContainmentFacilityScene.ts'
s = p.read_text(encoding='utf-8')
s = s.replace('inkBox(g, menu.x, menu.y, menu.width, menu.height, PALETTE.paper, 4, 2);',
              'g.fillStyle(0x1e2630).fillRect(menu.x, menu.y, menu.width, menu.height); g.lineStyle(1, 0x57b8ff).strokeRect(menu.x, menu.y, menu.width, menu.height);')
s = s.replace('0xe5c77d : 0xd8cdb7 : 0xb1afa5', '0x394f66 : 0x283440 : 0x202831')
for before, after in [('#f4e8c9','#d9e1ea'),('#302a20','#d9e1ea'),('#696b65','#7b8795'),('#514634','#a9bbcd'),('#dfdcca','#d9e1ea'),('#e3d7b3','#d9e1ea'),('#d3cbaa','#d9e1ea')]:
    s=s.replace(before,after)
s=s.replace('inkBox(g, p.x - 53, p.y - 15, 106, 30, 0x282a2b, 2, Number(id.slice(1)), 0.98);',
            'g.fillStyle(0x1e2630, 0.98).fillRect(p.x - 53, p.y - 15, 106, 30); g.lineStyle(1, 0x39424e).strokeRect(p.x - 53, p.y - 15, 106, 30);')
s=s.replace('inkBox(g, p.x - width / 2, p.y - 15, width, 30, 0x282a2b, 2, width, 0.98);',
            'g.fillStyle(0x1e2630, 0.98).fillRect(p.x - width / 2, p.y - 15, width, 30); g.lineStyle(1, 0x39424e).strokeRect(p.x - width / 2, p.y - 15, width, 30);')
s=s.replace('inkBox(g, MINI_MAP.x, MINI_MAP.y, MINI_MAP.width, MINI_MAP.height, 0x23282b, 3, 4, 0.99);',
            'g.fillStyle(0x1e2630, 0.99).fillRect(MINI_MAP.x, MINI_MAP.y, MINI_MAP.width, MINI_MAP.height); g.lineStyle(1, 0x39424e).strokeRect(MINI_MAP.x, MINI_MAP.y, MINI_MAP.width, MINI_MAP.height);')
p.write_text(s,encoding='utf-8')

# Retain the previous version's proof. This version explicitly reports incomplete art.
p = root / 'scripts/generated-art-proof.mjs'
s=p.read_text(encoding='utf-8').replace('docs/generated-art-evidence-2026-10-21','docs/nm-v2-evidence-2026-10-22')
s=s.replace("assert.equal(opening.art.creatures.length,5);", "assert.equal(opening.rooms.length,5); report.artCoverage=opening.art.coverage; report.creatureReadiness=opening.art.creatureReadiness; report.artAcceptance='INCOMPLETE';")
s=s.replace("creatures:5,modules:", "actualRooms:5,generatedCreatures:opening.art.creatures.length,modules:")
s=s.replace("assert(calm.art.creatures.some(c=>c.id===id));", "assert(calm.rooms.some(r=>r.anomalyId===id && r.mode==='CONTAINED'));")
s=s.replace("assert(breach.art.creatures.some(c=>c.id===id&&c.key.startsWith('enemy'))||breach.art.creatures.some(c=>c.id===id));", "assert(breach.art.creatureReadiness.some(c=>c.id===id));")
(root/'scripts/nm-v2-art-proof.mjs').write_text(s,encoding='utf-8')
