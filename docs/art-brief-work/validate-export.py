import json
import pathlib
import xml.etree.ElementTree as ET
import zipfile

root = pathlib.Path(__file__).resolve().parents[2]
output = root / 'outputs/01a144a7-9b8e-7ec0-91c1-cb1e9446d500/网梗收容_美术素材生成需求_v1.0_20261021.xlsx'
ns = {'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'xdr':'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing'}
with zipfile.ZipFile(output) as z:
    assert z.testzip() is None
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    sheets = [e.attrib['name'] for e in wb.findall('s:sheets/s:sheet',ns)]
    assert sheets == ['素材需求','逐张提示词','生成规范','参考图'], sheets
    shared=[]
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns):
            shared.append(''.join(si.itertext()))
    def value(c):
        if c.attrib.get('t')=='inlineStr': return ''.join(c.find('s:is',ns).itertext())
        v=c.findtext('s:v',None,ns)
        if c.attrib.get('t')=='s': return shared[int(v)]
        return v
    errors=[]
    formulas=0
    panes={}
    cells=[]
    for n, sheet in enumerate(sheets,1):
        x=ET.fromstring(z.read(f'xl/worksheets/sheet{n}.xml'))
        sheetcells={c.attrib['r']: value(c) for c in x.findall('.//s:c',ns)}
        cells.append(sheetcells)
        errors += [(sheet,c.attrib['r'],value(c)) for c in x.findall('.//s:c',ns) if c.attrib.get('t')=='e']
        formulas += len(x.findall('.//s:f',ns))
        pane=x.find('s:sheetViews/s:sheetView/s:pane',ns)
        panes[sheet]=pane.attrib if pane is not None else None
        for row in x.findall('s:sheetData/s:row',ns):
            assert float(row.attrib.get('ht','15'))<=409.5
    assert not errors, errors
    names=[cells[1][f'B{i}'] for i in range(8,296)]
    assert len(set(names))==288
    for i in range(8,296):
        prompt=cells[1][f'D{i}']
        assert prompt and '【唯一交付文件】' in prompt and '【禁止】' in prompt
        assert names[i-8] in prompt
        assert 'characters_units.json' not in prompt
    media=[n for n in z.namelist() if n.startswith('xl/media/')]
    assert len(media)==16,len(media)
    tables=[n for n in z.namelist() if n.startswith('xl/tables/') and n.endswith('.xml')]
    assert len(tables)==2,len(tables)
    for table in tables:
        x=ET.fromstring(z.read(table))
        assert x.find('s:autoFilter',ns) is not None
    for sheet in sheets[:2]:
        assert panes[sheet].get('ySplit')=='7', panes
    assert not any(n.startswith('xl/externalLinks') for n in z.namelist())
    assert 'EQUIPMENT' in ''.join(v for v in cells[0].values() if v)
    result={'ok':True,'sheets':sheets,'requirements':105,'generationTasks':288,'embeddedImages':len(media),'formulas':formulas,'errorCells':errors,'freezePanes':panes,'bytes':output.stat().st_size}
    print(json.dumps(result,ensure_ascii=False,indent=2))
    (root/'docs/art-brief-work/export-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
