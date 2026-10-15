from pathlib import Path
from zipfile import ZipFile
from lxml import etree
from docx import Document

ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
base=Path(__file__).resolve().parents[1]/'Developer_Handoff'
files=list(base.glob('*.docx'))
assert len(files)==2
for f in files:
    with ZipFile(f) as z:
        assert z.testzip() is None
        roots={n:etree.fromstring(z.read(n)) for n in z.namelist() if n.endswith('.xml')}
    r=roots['word/document.xml']
    assert r.xpath('//w:pgSz/@w:w',namespaces=ns)==['12240']
    assert r.xpath('//w:pgSz/@w:h',namespaces=ns)==['15840']
    for t in r.xpath('//w:tbl',namespaces=ns):
        widths=[int(x) for x in t.xpath('./w:tblGrid/w:gridCol/@w:w',namespaces=ns)]
        assert sum(widths)==9360
        for row in t.xpath('./w:tr',namespaces=ns):
            assert [int(x) for x in row.xpath('./w:tc/w:tcPr/w:tcW/@w:w',namespaces=ns)]==widths
    doc=Document(f)
    text='\n'.join(p.text for p in doc.paragraphs)
    assert 'token' in text.lower() and len(text)>6000
    assert 'Verification in this task covers' not in text
    assert '<external_' not in text
    print(f'{f.name}: ZIP, XML, page geometry, table widths and content checks passed ({f.stat().st_size} bytes)')
