import collections
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

work = Path(__file__).resolve().parent
summary = json.loads((work / 'build-summary.json').read_text(encoding='utf-8'))
output = Path(summary['outfile'])
ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
with zipfile.ZipFile(output) as z:
    assert z.testzip() is None
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    sheets = [x.attrib['name'] for x in wb.findall('s:sheets/s:sheet', ns)]
    assert sheets == ['素材需求', '逐张提示词', '生成规范', '程序与动效', '验收清单'], sheets
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for item in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si', ns):
            shared.append(''.join(item.itertext()))
    def val(c):
        if c.attrib.get('t') == 'inlineStr':
            return ''.join(c.find('s:is', ns).itertext())
        value = c.findtext('s:v', None, ns)
        return shared[int(value)] if c.attrib.get('t') == 's' else value
    cells, errors, panes, formulas, maxheight = [], [], {}, 0, 0
    for n, name in enumerate(sheets, 1):
        xml = ET.fromstring(z.read(f'xl/worksheets/sheet{n}.xml'))
        cells.append({c.attrib['r']: val(c) for c in xml.findall('.//s:c', ns)})
        errors += [(name, c.attrib['r'], val(c)) for c in xml.findall('.//s:c', ns) if c.attrib.get('t') == 'e']
        formulas += len(xml.findall('.//s:f', ns))
        pane = xml.find('s:sheetViews/s:sheetView/s:pane', ns)
        panes[name] = pane.attrib if pane is not None else None
        for row in xml.findall('s:sheetData/s:row', ns):
            maxheight = max(maxheight, float(row.attrib.get('ht', '15')))
    assert maxheight <= 409.5, maxheight
    assert not errors, errors
    n = summary['counts']['pngs']
    filenames = [cells[1][f'A{r}'] for r in range(8, 8+n)]
    assert filenames == summary['files']
    assert len(set(filenames)) == n
    by_group = collections.Counter(cells[1][f'B{r}'] for r in range(8, 8+n))
    by_priority = collections.Counter(cells[1][f'G{r}'] for r in range(8, 8+n))
    lengths = []
    for r in range(8, 8+n):
        prompt = cells[1][f'D{r}']
        assert prompt and cells[1][f'A{r}'] in prompt
        assert '【单张范围】' in prompt and '【禁止项】' in prompt
        assert '现代新媒体收容机构' in prompt and 'TEST_LINK_V2' not in prompt
        assert '.codex/attachments' not in prompt and 'C:/Users/' not in prompt
        assert cells[1][f'K{r}'] == '待生成'
        lengths.append(len(prompt))
    for r in range(8, 8+summary['counts']['groups']):
        assert float(cells[0][f'H{r}']) == by_group[cells[0][f'A{r}']]
    for p in ['P0常态','P1局部污染','P2扩展演出']:
        assert by_priority[p] == summary['counts'][p]
    for r in range(8, 25):
        assert cells[4][f'F{r}'] == '待验收'
    assert not any(f.startswith('xl/externalLinks') for f in z.namelist())
    tables = [f for f in z.namelist() if f.startswith('xl/tables/') and f.endswith('.xml')]
    assert len(tables) == 4
    for f in tables:
        assert ET.fromstring(z.read(f)).find('s:autoFilter', ns) is not None
    for name in ['素材需求','逐张提示词','程序与动效','验收清单']:
        assert panes[name].get('ySplit') == '7'
    result = {'ok':True,'sheets':sheets,**summary['counts'],'formulas':formulas,'errorCells':errors,'maxRowHeightPt':maxheight,'maxPromptChars':max(lengths),'bytes':output.stat().st_size,'freezePanes':panes,'priorityCounts':dict(by_priority)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    (work / 'export-validation-v2.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
