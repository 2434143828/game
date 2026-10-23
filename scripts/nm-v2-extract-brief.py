"""Read the approved workbook; never author or modify it."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BOOK = ROOT / 'outputs/01a144a7-9b8e-7ec0-91c1-cb1e9446d500/网梗收容_美术素材需求_v2.0_现代新媒体_20261021.xlsx'
OUT = ROOT / 'art-production/nm-v2'
NS = {'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(BOOK) as archive:
    shared=[]
    if 'xl/sharedStrings.xml' in archive.namelist():
        shared=[''.join(x.itertext()) for x in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si',NS)]
    def value(cell):
        if cell.attrib.get('t')=='inlineStr': return ''.join(cell.find('s:is',NS).itertext())
        raw=cell.findtext('s:v',None,NS)
        return shared[int(raw)] if cell.attrib.get('t')=='s' else raw
    xml=ET.fromstring(archive.read('xl/worksheets/sheet2.xml'))
    cells={x.attrib['r']:value(x) for x in xml.findall('.//s:c',NS)}
    tasks=[]
    for row in range(8,315):
        name=cells[f'A{row}']
        tasks.append({'filename':name,'id':cells[f'B{row}'],'displayName':cells[f'C{row}'],'prompt':cells[f'D{row}'],'focus':cells[f'E{row}'],'reference':cells[f'F{row}'],'priority':cells[f'G{row}'],'type':cells[f'H{row}'],'format':cells[f'I{row}'],'deliveryFolder':cells[f'J{row}'],'suffix':cells[f'L{row}']})
assert len(tasks)==307 and len({t['filename'] for t in tasks})==307
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'approved-tasks.json').write_text(json.dumps({'source':str(BOOK.relative_to(ROOT)),'count':307,'tasks':tasks},ensure_ascii=False,indent=2),encoding='utf-8')
print('Extracted 307 approved task prompts.')
