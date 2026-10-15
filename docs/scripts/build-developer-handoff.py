"""Build partner handoff DOCX files using the bundled document runtime.

Preset: compact_reference_guide. Header: memo_masthead, quiet title stack.
Named overrides: Title 24pt; Subtitle 12pt; Code Consolas 8pt single-spaced;
TableText 9pt/1.15; Footer 9pt. Lists use native numbering, not text markers.
"""
from pathlib import Path
import re
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.enum.style import WD_STYLE_TYPE

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'Developer_Handoff'
OUT.mkdir(exist_ok=True)

def element(tag, **attrs):
    e = OxmlElement('w:' + tag)
    for key, value in attrs.items():
        e.set(qn('w:' + key), str(value))
    return e

def style(doc, name, size, color, before=0, after=6, line=1.25, bold=False, font='Calibri'):
    s = doc.styles[name] if name in doc.styles else doc.styles.add_style(name, WD_STYLE_TYPE.PARAGRAPH)
    s.font.name, s.font.size, s.font.bold = font, Pt(size), bold
    s.font.color.rgb = RGBColor.from_string(color)
    f = s.paragraph_format
    f.space_before, f.space_after, f.line_spacing = Pt(before), Pt(after), line
    f.widow_control = True
    return s

def inline(p, text):
    # Relative source links remain readable file references in the standalone guide.
    text = re.sub(r'\[([^]]+)\]\(([^)]+)\)', r'\1 (\2)', text)
    for part in re.split(r'(`[^`]+`|\*\*.+?\*\*)', text):
        r = p.add_run(part[1:-1] if part.startswith('`') else part[2:-2] if part.startswith('**') else part)
        if part.startswith('`'):
            r.font.name, r.font.size = 'Consolas', Pt(9)
        elif part.startswith('**'):
            r.bold = True

def setup_lists(doc):
    root = doc.part.numbering_part.element
    for ident, fmt, marker in [(90, 'bullet', '\u2022'), (91, 'decimal', '%1.')]:
        abstract = element('abstractNum', abstractNumId=ident)
        lvl = element('lvl', ilvl=0)
        for e in [element('start', val=1), element('numFmt', val=fmt), element('lvlText', val=marker), element('lvlJc', val='left')]:
            lvl.append(e)
        pp = element('pPr')
        tabs = element('tabs'); tabs.append(element('tab', val='num', pos=540)); pp.append(tabs)
        pp.append(element('ind', left=540, hanging=271))
        pp.append(element('spacing', before=0, after=80, line=300, lineRule='auto'))
        lvl.append(pp); abstract.append(lvl); root.append(abstract)
        num = element('num', numId=ident); num.append(element('abstractNumId', val=ident)); root.append(num)

def add_table(doc, rows):
    n = len(rows[0])
    widths = [2880, 6480] if n == 2 else [3300, 3300, 2760] if n == 3 else [9360 // n] * n
    widths[-1] = 9360 - sum(widths[:-1])
    t = doc.add_table(rows=0, cols=n); t.autofit = False
    pr = t._tbl.tblPr
    pr.find(qn('w:tblW')).set(qn('w:w'), '9360')
    pr.find(qn('w:tblW')).set(qn('w:type'), 'dxa')
    pr.append(element('tblInd', w=120, type='dxa'))
    margins = element('tblCellMar')
    for side, value in [('top',80),('bottom',80),('start',120),('end',120)]:
        margins.append(element(side, w=value, type='dxa'))
    pr.append(margins)
    borders = element('tblBorders')
    for side in ['top','left','bottom','right','insideH','insideV']:
        borders.append(element(side, val='single', sz=4, color='D6DEE8'))
    pr.append(borders)
    for col, width in zip(t.columns, widths): col.width = Inches(width/1440)
    for index, row in enumerate(rows):
        cells = t.add_row().cells
        trpr = t.rows[-1]._tr.get_or_add_trPr(); trpr.append(element('cantSplit'))
        if index == 0: trpr.append(element('tblHeader'))
        for cell, text, width in zip(cells, row, widths):
            cell.width = Inches(width/1440)
            if index == 0: cell._tc.get_or_add_tcPr().append(element('shd', fill='E8EEF5'))
            p = cell.paragraphs[0]; p.style = 'TableText'; inline(p, text)
            if index == 0:
                for run in p.runs: run.bold = True
    doc.add_paragraph('').paragraph_format.space_after = Pt(0)

def build(source, title, filename):
    d = Document(); sec = d.sections[0]
    sec.page_width, sec.page_height = Inches(8.5), Inches(11)
    sec.top_margin = sec.bottom_margin = sec.left_margin = sec.right_margin = Inches(1)
    sec.header_distance = sec.footer_distance = Inches(.492)
    style(d, 'Normal',11,'172435')
    style(d, 'Title',24,'172435',after=5,bold=True)
    style(d, 'Subtitle',12,'526277',after=8)
    for level, size, before, after, color in [(1,16,18,10,'2E74B5'),(2,13,14,7,'2E74B5'),(3,12,10,5,'1F4D78')]:
        s = style(d, f'Heading {level}',size,color,before,after,bold=True)
        s.paragraph_format.keep_with_next = True
    for name in ['List Bullet','List Number']: style(d,name,11,'172435',after=4)
    style(d,'Code',8,'172435',before=4,after=0,line=1,font='Consolas')
    style(d,'TableText',9,'172435',after=2,line=1.15)
    style(d,'PageFurniture',9,'526277',after=0,line=1)
    style(d,'TableCitation',9,'526277',before=4,after=4)
    setup_lists(d)
    h = sec.header.paragraphs[0]; h.style='PageFurniture'; h.add_run('CHATKONECT  |  APP DEVELOPER HANDOFF')
    p = sec.footer.paragraphs[0]; p.style='PageFurniture'; p.alignment=2
    p.add_run('15 October 2026  |  ')
    field=element('fldSimple', instr='PAGE'); p._p.append(field)
    d.add_paragraph('CHATKONECT', 'Subtitle')
    d.add_paragraph(title,'Title')
    d.add_paragraph('Platform integration reference  |  15 October 2026','Subtitle')
    lines=source.splitlines(); i=0; sequence=100
    while i<len(lines):
        line=lines[i].strip(); i+=1
        if not line or line.startswith('# ') or line == '---': continue
        if line.startswith('```'):
            while i<len(lines) and not lines[i].startswith('```'):
                raw=lines[i]; i+=1
                d.add_paragraph(raw,'Code')
            i+=1; continue
        if line.startswith('|'):
            rows=[]
            while line.startswith('|'):
                if not re.fullmatch(r'[| :\-]+',line):
                    rows.append([x.strip() for x in re.split(r'(?<!\\)\|',line)[1:-1]])
                if i>=len(lines): break
                line=lines[i].strip()
                if not line.startswith('|'): break
                i+=1
            add_table(d,rows); continue
        if line.startswith('##'):
            level=min(len(line)-len(line.lstrip('#'))-1,3)
            d.add_paragraph(line.lstrip('# ').strip(),f'Heading {level}'); continue
        list_match=re.match(r'^(?:(\d+)\.\s+|[-*]\s+)(.*)',line)
        if list_match:
            num=91 if list_match[1] else 90
            p=d.add_paragraph(style='List Number' if list_match[1] else 'List Bullet')
            if list_match[1]:
                if list_match[1]=='1':
                    sequence+=1
                    nd=element('num',numId=sequence); nd.append(element('abstractNumId',val=91))
                    override=element('lvlOverride',ilvl=0); override.append(element('startOverride',val=1)); nd.append(override)
                    d.part.numbering_part.element.append(nd)
                num=sequence
            np=element('numPr'); np.append(element('ilvl',val=0)); np.append(element('numId',val=num)); p._p.get_or_add_pPr().append(np)
            inline(p,list_match[2]); continue
        while i<len(lines) and lines[i].strip() and not re.match(r'^(#|\||```|\d+\.\s|[-*]\s)',lines[i]):
            line+=' '+lines[i].strip(); i+=1
        inline(d.add_paragraph(),line)
    d.core_properties.title='ChatKonect '+title
    d.core_properties.author='ChatKonect'
    dest=OUT/filename; d.save(dest)
    print(f'{dest}: {len(d.paragraphs)} paragraphs, {len(d.tables)} tables')

platform=(OUT/'PLATFORM_HANDOFF.md').read_text(encoding='utf-8')
developer=(ROOT/'DEVELOPER_INTEGRATION.md').read_text(encoding='utf-8')
developer=re.sub(r'Updated:.*?\n', 'Prepared: 15 October 2026. Based on the integration in this repository.\n',developer,count=1)
developer=developer[:developer.index('Verification in this task covers')] + '''Validation status: this handoff was checked against local platform routes, controllers and loader interfaces. Automated test commands are provided for the implementation team; they were not rerun for this documentation-only handoff. Production deployment, physical-device and cross-network media acceptance testing remain the receiving team's responsibility.

Companion document: ChatKonect_Platform_Guide.docx. Actual deployment origins, App ID and privately delivered App secret must be supplied by the operator before implementation.
'''
(OUT/'APP_DEVELOPER_HANDOFF.md').write_text(developer,encoding='utf-8')
build(platform,'Platform guide','ChatKonect_Platform_Guide.docx')
build(developer,'App developer integration guide','ChatKonect_App_Developer_Guide.docx')
