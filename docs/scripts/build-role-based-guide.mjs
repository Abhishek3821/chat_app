// Native OOXML builder. Execute through the Codex node_repl runtime.
// Preset: compact_reference_guide. Header pattern: memo_masthead.
// Overrides: quiet title block, 8.5pt code, 9.5pt tables, 9pt page furniture.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const docs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(docs, 'ROLE_BASED_ACCESS_GUIDE.md'), 'utf8');
const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const relns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const links = [];

function run(text, code = false, bold = false) {
  return `<w:r>${code || bold ? `<w:rPr>${code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/>' : ''}${bold ? '<w:b/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${escape(text)}</w:t></w:r>`;
}
function inline(text) {
  const pieces = [], pattern = /(`([^`]+)`|\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    pieces.push(run(text.slice(last, match.index)));
    if (match[2]) pieces.push(run(match[2], true));
    else if (match[3]) pieces.push(run(match[3], false, true));
    else {
      const id = `link${links.length + 1}`; links.push({ id, url: match[5] });
      pieces.push(`<w:hyperlink r:id="${id}"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>${escape(match[4])}</w:t></w:r></w:hyperlink>`);
    }
    last = match.index + match[0].length;
  }
  pieces.push(run(text.slice(last)));
  return pieces.join('');
}
function paragraph(text, style = 'Normal') {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${inline(text)}</w:p>`;
}
function codeBlock(lines) {
  return `<w:p><w:pPr><w:pStyle w:val="Code"/><w:keepLines/></w:pPr>${lines.map((line, i) => `${i ? '<w:r><w:br/></w:r>' : ''}<w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r>`).join('')}</w:p>`;
}
function table(rows) {
  const columns = rows[0].length;
  const widths = columns === 4 ? [3400, 1800, 1800, 2360] : columns === 3 ? [3000, 2700, 3660] : [3600, 5760];
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblInd w:w="120" w:type="dxa"/><w:tblLayout w:type="fixed"/>
    <w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:start w:w="120" w:type="dxa"/><w:end w:w="120" w:type="dxa"/></w:tblCellMar>
    <w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map((side) => `<w:${side} w:val="single" w:sz="4" w:color="D6DEE8"/>`).join('')}</w:tblBorders></w:tblPr>
    <w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('')}</w:tblGrid>
    ${rows.map((row, index) => `<w:tr><w:trPr><w:cantSplit/>${index === 0 ? '<w:tblHeader/>' : ''}</w:trPr>${row.map((text, col) => `<w:tc><w:tcPr><w:tcW w:w="${widths[col]}" w:type="dxa"/><w:vAlign w:val="center"/>${index === 0 ? '<w:shd w:fill="E8EEF5"/>' : ''}</w:tcPr>${paragraph(index === 0 ? `**${text}**` : text, 'TableText')}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
}
const lines = source.split(/\r?\n/), body = [];
let numberId = 1;
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.trim()) continue;
  if (line.startsWith('```')) {
    const code = []; while (++i < lines.length && !lines[i].startsWith('```')) code.push(lines[i]);
    body.push(codeBlock(code)); continue;
  }
  if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) {
      if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((cell) => cell.trim()));
      i++;
    }
    i--; body.push(table(rows)); body.push(paragraph('', 'TableAfter')); continue;
  }
  if (line.startsWith('# ')) {
    body.push(paragraph('CHATKONECT', 'Kicker'));
    body.push(paragraph('Role-based access guide', 'Title'));
    body.push(paragraph('Permission matrices, resource scope and enforcement', 'Subtitle'));
    continue;
  }
  if (line.startsWith('## ')) { body.push(paragraph(line.slice(3), 'Heading1')); continue; }
  if (line.startsWith('### ')) { body.push(paragraph(line.slice(4), 'Heading2')); continue; }
  if (/^(- |\d+\. )/.test(line)) {
    const bullet = line.startsWith('- ');
    if (!bullet && line.startsWith('1. ')) numberId++;
    const text = line.replace(/^(- |\d+\. )/, '');
    body.push(`<w:p><w:pPr><w:pStyle w:val="ListText"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${bullet ? 1 : numberId}"/></w:numPr></w:pPr>${inline(text)}</w:p>`);
    continue;
  }
  let text = line;
  while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|\||```)/.test(lines[i + 1])) text += ' ' + lines[++i];
  body.push(paragraph(text, line.startsWith('Updated:') ? 'Metadata' : 'Normal'));
}
const xml = (value) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${value}`;
function style(id, name, size, color, before, after, extra = '') {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="${before}" w:after="${after}" w:line="300" w:lineRule="auto"/>${extra}</w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${/^(Heading|Title|Kicker)/.test(id) ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:color w:val="${color}"/></w:rPr></w:style>`;
}
const entries = new Map();
entries.set('word/numbering.xml', xml(`<w:numbering xmlns:w="${ns}">${['bullet','decimal'].map((format,i)=>`<w:abstractNum w:abstractNumId="${i}"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${format}"/><w:lvlText w:val="${i ? '%1.' : '&#8226;'}"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:spacing w:before="0" w:after="80" w:line="300" w:lineRule="auto"/><w:ind w:left="540" w:hanging="271"/></w:pPr></w:lvl></w:abstractNum>`).join('')}<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${Array.from({length:numberId-1},(_,i)=>`<w:num w:numId="${i+2}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`));
entries.set('[Content_Types].xml', xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[
  ['document','application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'],
  ['styles','application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'],
  ['numbering','application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'],
  ['settings','application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'],
  ['header1','application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'],
  ['footer1','application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'],
].map(([name,type]) => `<Override PartName="/word/${name}.xml" ContentType="${type}"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`));
entries.set('_rels/.rels', xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="document" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="core" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'));
entries.set('word/document.xml', xml(`<w:document xmlns:w="${ns}" xmlns:r="${relns}"><w:body>${body.join('')}<w:sectPr><w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708"/><w:cols w:space="720"/></w:sectPr></w:body></w:document>`));
entries.set('word/_rels/document.xml.rels', xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[
  ['styles','styles','styles.xml'],['numbering','numbering','numbering.xml'],['settings','settings','settings.xml'],['header','header','header1.xml'],['footer','footer','footer1.xml'],
].map(([id,type,target]) => `<Relationship Id="${id}" Type="${relns}/${type}" Target="${target}"/>`).join('')}${links.map(({id,url}) => `<Relationship Id="${id}" Type="${relns}/hyperlink" Target="${escape(url)}" TargetMode="External"/>`).join('')}</Relationships>`));
entries.set('word/styles.xml', xml(`<w:styles xmlns:w="${ns}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="172435"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="120" w:line="300" w:lineRule="auto"/><w:widowControl/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="120" w:line="300" w:lineRule="auto"/><w:widowControl/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="172435"/></w:rPr></w:style>
  ${style('Title','Title',48,'172435',0,100,'<w:keepNext/>')}
  ${style('Subtitle','Subtitle',24,'526277',0,160,'<w:keepNext/>')}
  ${style('Kicker','Kicker',20,'2E74B5',0,60,'<w:keepNext/>')}
  ${style('Metadata','Metadata',18,'526277',0,160)}
  ${style('Heading1','Heading 1',32,'2E74B5',360,200,'<w:keepNext/><w:keepLines/><w:outlineLvl w:val="0"/>')}
  ${style('Heading2','Heading 2',26,'2E74B5',280,140,'<w:keepNext/><w:keepLines/><w:outlineLvl w:val="1"/>')}
  ${style('Heading3','Heading 3',24,'1F4D78',200,100,'<w:keepNext/><w:keepLines/><w:outlineLvl w:val="2"/>')}
  ${style('ListText','List Text',22,'172435',0,80)}
  ${style('TableCitation','Table Citation',19,'526277',80,80)}
  ${style('TableText','Table Text',19,'172435',0,40)}
  ${style('TableAfter','Table After',4,'172435',0,0)}
  ${style('PageFurniture','Page Furniture',18,'526277',0,0)}
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="80" w:after="160" w:line="240" w:lineRule="auto"/><w:shd w:fill="F3F6FA"/><w:ind w:left="120" w:right="120"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="17"/><w:color w:val="172435"/></w:rPr></w:style>
  <w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="2E74B5"/><w:u w:val="single"/></w:rPr></w:style>
  </w:styles>`));
entries.set('word/settings.xml', xml(`<w:settings xmlns:w="${ns}"><w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/></w:settings>`));
entries.set('word/header1.xml', xml(`<w:hdr xmlns:w="${ns}">${paragraph('ChatKonect  |  Developer reference', 'PageFurniture')}</w:hdr>`));
entries.set('word/footer1.xml', xml(`<w:ftr xmlns:w="${ns}"><w:p><w:pPr><w:pStyle w:val="PageFurniture"/><w:jc w:val="right"/></w:pPr>${run('15 October 2026  |  Page ')}<w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`));
entries.set('docProps/core.xml', xml('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>ChatKonect Role-Based Access Developer Guide</dc:title><dc:creator>ChatKonect</dc:creator><dc:description>Platform, workspace, group and resource authorization reference</dc:description><dcterms:created xsi:type="dcterms:W3CDTF">2026-10-15T00:00:00Z</dcterms:created></cp:coreProperties>'));

// Small ZIP writer with stored entries. OOXML is an ordinary ZIP container.
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
const local = [], central = []; let offset = 0;
for (const [name, content] of entries) {
  const filename = Buffer.from(name), data = Buffer.from(content), crc = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0); header.writeUInt16LE(20,4); header.writeUInt32LE(crc,14);
  header.writeUInt32LE(data.length,18); header.writeUInt32LE(data.length,22); header.writeUInt16LE(filename.length,26);
  local.push(header, filename, data);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50,0); directory.writeUInt16LE(20,4); directory.writeUInt16LE(20,6);
  directory.writeUInt32LE(crc,16); directory.writeUInt32LE(data.length,20); directory.writeUInt32LE(data.length,24);
  directory.writeUInt16LE(filename.length,28); directory.writeUInt32LE(offset,42);
  central.push(directory,filename); offset += header.length + filename.length + data.length;
}
const centralBytes = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(entries.size,8); end.writeUInt16LE(entries.size,10);
end.writeUInt32LE(centralBytes.length,12); end.writeUInt32LE(offset,16);
const output = path.join(docs, 'ChatKonect_Role_Based_Access_Guide.docx');
fs.writeFileSync(output, Buffer.concat([...local,centralBytes,end]));
console.log(JSON.stringify({ output, bytes:fs.statSync(output).size, paragraphs:body.length, designPreset:'compact_reference_guide', overrides:['Consolas 8.5pt code blocks', '9.5pt table text', 'quiet title block'] }));
