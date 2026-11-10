import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { modules, caveats } from './feature-catalogue.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const output = path.join(root, 'output/pdf');
fs.mkdirSync(output, { recursive: true });
const name = 'ChatKonect_All_Modules_All_Features_2026-10-20';
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
for (const m of modules) for (const s of m.sources) if (!fs.existsSync(path.join(root, s))) throw new Error('Missing source: ' + s);

// Enumerate mounted REST declarations, including chained router.route() calls.
const imports = new Map([...read('server/routes/index.js').matchAll(/import\s+(\w+)\s+from\s+'\.\/(\w+\.js)'/g)].map(m=>[m[1],m[2]]));
imports.set('webhookRoutes', 'webhookRoutes.js'); imports.set('hookIngressRoutes', 'webhookRoutes.js');
const mounts = [...read('server/routes/index.js').matchAll(/router\.use\('([^']+)',\s*(\w+)\)/g)].filter(m=>imports.has(m[2]));
const routes = [];
for (const mount of mounts) {
  const source = 'server/routes/' + imports.get(mount[2]);
  const owner = mount[2] === 'hookIngressRoutes' ? 'hookIngressRoutes' : mount[2] === 'webhookRoutes' ? 'webhookRoutes' : 'router';
  const code = read(source).split('\n').filter(s=>!/^\s*\/\//.test(s)).join('\n');
  const direct = new RegExp(`\\b${owner}\\.(get|post|put|patch|delete)\\('([^']+)'\\s*,([^;]+);`, 'g');
  const routePath = p => '/api' + mount[1] + (p === '/' ? '' : p);
  for (const m of code.matchAll(direct)) routes.push({method:m[1].toUpperCase(),path:routePath(m[2]),group:mount[1],source,handler:m[3].trim().replace(/\s+/g,' ')});
  for (const m of code.matchAll(/router\.route\('([^']+)'\)((?:\.(?:get|post|put|patch|delete)\([^;]+)+);/g)) {
    for (const op of m[2].matchAll(/\.(get|post|put|patch|delete)\(([^)]+)\)/g)) routes.push({method:op[1].toUpperCase(),path:routePath(m[1]),group:mount[1],source,handler:op[2]});
  }
}
routes.unshift({method:'GET',path:'/api/health',group:'System',source:'server/routes/index.js',handler:'health / readiness'});
routes.push({method:'GET',path:'/api/v1/ice',group:'Shared ICE',source:'server/routes/index.js',handler:'protect, getIceServers'});
const socketCode = read('server/socket/index.js');
const incoming = new Set([...socketCode.matchAll(/socket\.on\('([^']+)'/g)].map(m=>m[1]));
for (const m of socketCode.matchAll(/onAll\(\[([^\]]+)\]/g)) for (const s of m[1].matchAll(/'([^']+)'/g)) incoming.add(s[1]);
const sourceFiles = [...new Set(modules.flatMap(m=>m.sources).concat(routes.map(r=>r.source),'server/socket/index.js'))].sort();
const total = modules.reduce((n,m)=>n+m.features.length,0);
const catalogue = {title:'ChatKonect - all modules and features',date:'2026-10-20',moduleCount:modules.length,featureCount:total,routeCount:routes.length,incomingSocketEventCount:incoming.size,modules,routes,incomingSocketEvents:[...incoming].sort(),caveats,sources:sourceFiles.map(file=>({file,sha256:crypto.createHash('sha256').update(read(file)).digest('hex')}))};
fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(catalogue,null,2));
let markdown = `# ChatKonect - All Modules and All Features\n\nSource snapshot: 20 October 2026. ${modules.length} modules; ${total} feature/control/rule entries.\n\n`;
for (const [i,m] of modules.entries()) markdown += `## ${String(i+1).padStart(2,'0')}. ${m.title}\n\n${m.access}\n\n` + m.features.map((f,j)=>`${i+1}.${j+1}. ${f}`).join('\n') + '\n\nSources: '+m.sources.map(s=>'`'+s+'`').join(', ')+'\n\n';
markdown += '## Scope and implementation notes\n\n' + caveats.map(t=>'- '+t).join('\n')+'\n\n## REST surface\n\n'+routes.map(r=>`- ${r.method} ${r.path}`).join('\n')+'\n\n## Incoming realtime event surface\n\n'+[...incoming].sort().map(s=>'- '+s).join('\n')+'\n';
fs.writeFileSync(path.join(output,name+'.md'),markdown);

// Dependency-free vector PDF writer. Core PDF fonts keep text selectable and
// searchable; canvas supplies measured line wrapping for repeatable layout.
const W=595.28,H=841.89,L=48,R=W-48,CW=R-L;
const ink='#152d40',teal='#087f8c',muted='#647585',pale='#edf6f6',line='#dbe5e9';
function loadFont(file) {
  const bytes=fs.readFileSync(file), tables={};
  for(let i=0;i<bytes.readUInt16BE(4);i++){const o=12+i*16;tables[bytes.toString('ascii',o,o+4)]=bytes.readUInt32BE(o+8);}
  const head=tables.head, hhea=tables.hhea, units=bytes.readUInt16BE(head+18), count=bytes.readUInt16BE(hhea+34);
  const cmap=tables.cmap;let format4;
  for(let i=0;i<bytes.readUInt16BE(cmap+2);i++){const off=cmap+bytes.readUInt32BE(cmap+4+i*8+4);if(bytes.readUInt16BE(off)===4)format4=off;}
  if(!format4)throw new Error('No font cmap format 4');
  const segments=bytes.readUInt16BE(format4+6)/2, end=format4+14, start=end+segments*2+2, delta=start+segments*2, range=delta+segments*2;
  const glyph=code=>{for(let i=0;i<segments;i++){if(code>bytes.readUInt16BE(end+i*2)||code<bytes.readUInt16BE(start+i*2))continue;const d=bytes.readInt16BE(delta+i*2),r=bytes.readUInt16BE(range+i*2);if(!r)return(code+d)&65535;const g=bytes.readUInt16BE(range+i*2+r+(code-bytes.readUInt16BE(start+i*2))*2);return g?(g+d)&65535:0;}return 0;};
  const metric=n=>Math.round(n*1000/units);
  const widths=Array.from({length:95},(_,i)=>metric(bytes.readUInt16BE(tables.hmtx+Math.min(glyph(i+32),count-1)*4)));
  return {bytes,widths,bbox:[36,38,40,42].map(o=>metric(bytes.readInt16BE(head+o))),ascent:metric(bytes.readInt16BE(hhea+4)),descent:metric(bytes.readInt16BE(hhea+6))};
}
const fonts=[loadFont('C:/Windows/Fonts/arial.ttf'),loadFont('C:/Windows/Fonts/arialbd.ttf')];
const ascii = s => String(s).replace(/[\u2010-\u2015]/g,'-').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[^\x20-\x7e\n]/g,'');
const esc = s => ascii(s).replace(/([\\()])/g,'\\$1');
function width(s,size,bold=false){return [...ascii(s)].reduce((n,c)=>n+(fonts[bold?1:0].widths[c.charCodeAt(0)-32]||0),0)*size/1000;}
function wrap(s,size,max,bold=false){
  const lines=[]; let row='';
  for(const word of ascii(s).split(/\s+/)){const next=row?row+' '+word:word;if(row&&width(next,size,bold)>max){lines.push(row);row=word;}else row=next;}
  if(row)lines.push(row);return lines;
}
const rgb = h => [1,3,5].map(i=>(parseInt(h.slice(i,i+2),16)/255).toFixed(4)).join(' ');
const pages=[]; let p;
function page(label='FEATURE CATALOGUE'){p={ops:[],links:[],label,checks:[]};pages.push(p);return p;}
function rect(x,y,w,h,color){p.ops.push(`${rgb(color)} rg ${x} ${H-y-h} ${w} ${h} re f`);}
function rule(y){rect(L,y,CW,.6,line);}
function text(s,x,y,size=10,bold=false,color=ink){
  s=ascii(s);p.ops.push(`BT /${bold?'F2':'F1'} ${size} Tf ${rgb(color)} rg 1 0 0 1 ${x.toFixed(2)} ${(H-y-size).toFixed(2)} Tm (${esc(s)}) Tj ET`);
  p.checks.push({text:s,x,y,width:width(s,size,bold),size});
}
function paragraph(s,x,y,size,max,bold=false,color=ink,leading=size*1.4){for(const row of wrap(s,size,max,bold)){text(row,x,y,size,bold,color);y+=leading;}return y;}
function heading(kicker,title,sub=''){
  text(kicker,L,75,9,true,teal);
  let y=paragraph(title,L,95,22,CW,true,ink,27)+12;
  if(sub)y=paragraph(sub,L,y,9.2,CW,false,muted,13)+12;
  rule(y);return y+18;
}
function footer(index){
  rule(790);text('ChatKonect  /  Product and developer feature inventory',L,802,8,false,muted);
  const num=`${index+1} / ${pages.length}`;text(num,R-width(num,8),802,8,false,muted);
  text('20 OCTOBER 2026  |  LOCAL SOURCE SNAPSHOT',L,36,8,true,muted);
}

page('COVER');rect(0,0,W,472,ink);rect(48,70,42,5,'#29c4b7');text('CHATKONECT',L,99,15,true,'#8be3dc');
text('All modules.',L,164,43,true,'#ffffff');text('All features.',L,218,43,true,'#ffffff');
paragraph('A detailed module-by-module catalogue for the app owner and development team.',L,302,15,440,false,'#d4e6ef',23);
text('SOURCE EDITION  /  20 OCTOBER 2026',L,418,10,true,'#8be3dc');
const stats=[[modules.length,'MODULES'],[total,'DETAILED ENTRIES'],[routes.length,'REST OPERATIONS']];
stats.forEach(([n,label],i)=>{const x=L+i*169;text(String(n),x,512,31,true,teal);text(label,x,555,8.5,true,muted);});
paragraph('Each module begins with its name and access context, followed by individually numbered features, small controls and important behavior rules.',L,613,11,CW,false,ink,17);
paragraph('Includes a clickable module index, source references, API/event appendices and clearly marked implementation limits.',L,690,10,CW,false,muted,15);

const toc=[];
for(let start=0;start<modules.length;start+=25){page('MODULE INDEX');let y=heading('FIND A MODULE',`Module index${start?' / continued':''}`,'Click a module name to open its feature list. The PDF also includes bookmarks.');
  for(let i=start;i<Math.min(start+25,modules.length);i++){
    const m=modules[i];const lines=wrap(m.title,9.5,CW-86,true);const height=Math.max(22,lines.length*12+5);
    text(String(i+1).padStart(2,'0'),L,y,9.5,true,teal);let yy=y;
    for(const s of lines){text(s,L+30,yy,9.5,true);yy+=12;}
    toc.push({page:p,index:i,y,height});rule(y+height-4);y+=height;
  }
}
const modulePages=[];
for(const [i,m] of modules.entries()){
  modulePages.push(pages.length);page('MODULE '+String(i+1).padStart(2,'0'));
  let y=heading(`MODULE ${String(i+1).padStart(2,'0')}  /  ${m.features.length} ENTRIES`,m.title,m.access);
  const featureFont=m.features.length>25?9:10;
  const featureLeading=m.features.length>25?11.5:14;
  const featureGap=m.features.length>25?3.5:7;
  for(const [j,f] of m.features.entries()){
    const rows=wrap(f,featureFont,CW-51);const height=rows.length*featureLeading+featureGap;
    if(y+height>770-32-m.sources.length*10){page('MODULE '+String(i+1).padStart(2,'0'));y=heading(`MODULE ${String(i+1).padStart(2,'0')}  /  CONTINUED`,m.title,'Continued feature list.');}
    text(`${i+1}.${String(j+1).padStart(2,'0')}`,L,y+1,8.5,true,teal);
    for(const row of rows){text(row,L+43,y,featureFont);y+=featureLeading;}y+=featureGap;
  }
  rule(y+4);text('SOURCE REFERENCES',L,y+13,7,true,muted);
  let sy=y+25;for(const source of m.sources){text(source,L,sy,7,false,muted);sy+=10;}
}
for(const row of toc){p=row.page;const n=String(modulePages[row.index]+1);text(n,R-width(n,9),row.y,9,true,teal);p.links.push({x:L,y:row.y-2,w:CW,h:row.height,target:modulePages[row.index]});}

page('SCOPE AND LIMITS');let y=heading('READ THIS WITH THE CATALOGUE','Scope and implementation notes','Features are a source inventory, not a fresh end-to-end test sign-off.');
for(const [i,s] of caveats.entries()){
  const lines=wrap(s,10,CW-24);if(y+lines.length*14+15>770){page('SCOPE AND LIMITS');y=heading('IMPLEMENTATION NOTES','Scope / continued');}
  text(String(i+1).padStart(2,'0'),L,y,9,true,teal);y=paragraph(s,L+25,y,10,CW-25,false,ink,14)+17;
}

const apiStart=pages.length;page('REST APPENDIX');y=heading('DEVELOPER REFERENCE','REST operation inventory',`${routes.length} mounted operations from ${mounts.length} route mounts plus system/shared ICE routes. Paths use the /api prefix. This index lists the surface, not full request schemas.`);
let prev='';
for(const r of routes){
  const newGroup=prev!==r.group;const rows=wrap(`${r.method.padEnd(6)} ${r.path}`,9,CW-14);
  const need=rows.length*13+9+(newGroup?27:0);
  if(y+need>768){page('REST APPENDIX');y=heading('DEVELOPER REFERENCE','REST inventory / continued');prev='';}
  if(prev!==r.group){rect(L,y,CW,21,pale);text(r.group,L+7,y+5,9.5,true,teal);y+=30;prev=r.group;}
  for(const line of rows){text(line,L+7,y,9,true);y+=13;}y+=8;
}
const eventStart=pages.length;page('REALTIME APPENDIX');y=heading('DEVELOPER REFERENCE','Incoming realtime events',`${incoming.size} registered Socket.IO input names, including compatibility aliases. A registered name still requires its handler's access checks.`);
for(const event of [...incoming].sort()){
  if(y+22>770){page('REALTIME APPENDIX');y=heading('DEVELOPER REFERENCE','Realtime events / continued');}
  text(event,L+8,y,10,false);y+=21;
}
page('COVERAGE MAP');y=heading('SOURCE COVERAGE','How this catalogue was assembled',`${sourceFiles.length} referenced source files. The companion JSON records per-file SHA-256 fingerprints for this edition.`);
for(const line of [
  'Product inventory: client pages, chat/meeting components, stores and hooks were matched with backend controllers, models and utility rules.',
  'REST inventory: all router mounts in server/routes/index.js were enumerated, including appRoutes chained route declarations and the separate public webhook ingress router.',
  'Realtime inventory: server/socket/index.js literal socket.on registrations and onAll compatibility aliases were enumerated.',
  'Every source-reference path is checked for existence during PDF generation. Features receive stable module-local numbers for review and developer discussion.',
  'The companion Markdown provides editable text. The JSON provides the module hierarchy, route list, incoming events and source fingerprints.',
  'Historical feature/audit documents were used for context, while current source and the 20 October audit fixes take precedence where older documents disagree.',
]){y=paragraph(line,L,y,10,CW,false,ink,15)+18;}
y+=5;text('QUICK REFERENCE',L,y,9,true,teal);y+=25;
for(const s of [`REST surface begins on page ${apiStart+1}.`,`Incoming realtime event surface begins on page ${eventStart+1}.`,'Upload limits: image 10 MB; ordinary video/file 50 MB; video note 10 MB.','Recorder duration: video notes stop at 60 seconds.','Protected capabilities: app tokens, sessions, workspaces, groups and scoped credentials remain distinct.'])y=paragraph(s,L,y,10,CW,false,ink,15)+9;

// Add page furniture after all page references are final.
for(const [i,pp] of pages.entries()){p=pp;if(i>0)footer(i);}
// Fail rather than publish clipped text.
const overflow=pages.flatMap((pp,i)=>pp.checks.filter(c=>c.x<0||c.x+c.width>W-12||c.y+c.size>H-12).map(c=>({page:i+1,...c})));
if(overflow.length)throw new Error('PDF text overflow: '+JSON.stringify(overflow));

const objects=[];const alloc=()=>{objects.push('');return objects.length;};const set=(n,s)=>objects[n-1]=s;
const catalog=alloc(),tree=alloc(),regular=alloc(),bold=alloc(),outlines=alloc(),info=alloc();
for(const [i,font] of fonts.entries()){
  const fontStream=alloc(),descriptor=alloc(),fontName=i?'Arial-BoldMT':'ArialMT';
  const compressed=deflateSync(font.bytes).toString('hex')+'>';
  set(fontStream,`<< /Length ${compressed.length} /Length1 ${font.bytes.length} /Filter [/ASCIIHexDecode /FlateDecode] >>\nstream\n${compressed}\nendstream`);
  set(descriptor,`<< /Type /FontDescriptor /FontName /${fontName} /Flags 32 /FontBBox [${font.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${font.ascent} /Descent ${font.descent} /CapHeight 716 /StemV 80 /FontFile2 ${fontStream} 0 R >>`);
  set(i?bold:regular,`<< /Type /Font /Subtype /TrueType /BaseFont /${fontName} /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 126 /Widths [${font.widths.join(' ')}] /FontDescriptor ${descriptor} 0 R >>`);
}
const refs=pages.map(()=>({page:alloc(),stream:alloc()}));
for(const [i,pp] of pages.entries()){
  const annotations=pp.links.map(a=>{const n=alloc();set(n,`<< /Type /Annot /Subtype /Link /Border [0 0 0] /Rect [${a.x} ${H-a.y-a.h} ${a.x+a.w} ${H-a.y}] /Dest [${refs[a.target].page} 0 R /Fit] >>`);return `${n} 0 R`;});
  const stream=pp.ops.join('\n');set(refs[i].stream,`<< /Length ${Buffer.byteLength(stream,'ascii')} >>\nstream\n${stream}\nendstream`);
  set(refs[i].page,`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${refs[i].stream} 0 R ${annotations.length?`/Annots [${annotations.join(' ')}]`:''} >>`);
}
const bookmarks=modules.map(()=>alloc());
for(const [i,n] of bookmarks.entries())set(n,`<< /Title (${esc(String(i+1).padStart(2,'0')+'. '+modules[i].title)}) /Parent ${outlines} 0 R ${i?`/Prev ${bookmarks[i-1]} 0 R`:''} ${i<bookmarks.length-1?`/Next ${bookmarks[i+1]} 0 R`:''} /Dest [${refs[modulePages[i]].page} 0 R /Fit] >>`);
set(outlines,`<< /Type /Outlines /First ${bookmarks[0]} 0 R /Last ${bookmarks.at(-1)} 0 R /Count ${bookmarks.length} >>`);
set(tree,`<< /Type /Pages /Kids [${refs.map(r=>r.page+' 0 R').join(' ')}] /Count ${pages.length} >>`);
set(catalog,`<< /Type /Catalog /Pages ${tree} 0 R /Outlines ${outlines} 0 R /PageMode /UseOutlines >>`);
set(info,`<< /Title (${name}) /Author (ChatKonect) /Subject (All modules and detailed features - 20 October 2026) /Creator (ChatKonect source catalogue builder) >>`);
let pdf='%PDF-1.4\n',offsets=[0];for(const [i,obj] of objects.entries()){offsets.push(Buffer.byteLength(pdf,'ascii'));pdf+=`${i+1} 0 obj\n${obj}\nendobj\n`;}
const xref=Buffer.byteLength(pdf,'ascii');pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('');
pdf+=`trailer\n<< /Size ${objects.length+1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(path.join(output,name+'.pdf'),Buffer.from(pdf,'ascii'));
const summary={file:name+'.pdf',pages:pages.length,modules:modules.length,features:total,routes:routes.length,incomingSocketEvents:incoming.size,modulePages:modulePages.map(n=>n+1),overflowChecks:overflow.length};
fs.writeFileSync(path.join(output,name+'_verification.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
