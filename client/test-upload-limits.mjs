import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./src/lib/api.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('export const MAX_UPLOAD_BYTES'),source.indexOf('/** Build a loadable URL'))
  .replace(/export (const|function|async function)/g,'$1');
const calls=[];
const {assertUploadable,uploadFiles}=new Function('api','ensureMediaToken',body+'\nreturn {assertUploadable,uploadFiles};')(
  {post:async(...args)=>{calls.push(args);return {data:{attachments:[]}};}},async()=>{});
const mb=1024*1024;
test('existing images stay capped at 10 MB and regular video/files at 50 MB',()=>{
  assert.doesNotThrow(()=>assertUploadable([{name:'photo.png',size:10*mb}]));
  assert.throws(()=>assertUploadable([{name:'photo.png',size:10*mb+1}]),/10 MB/);
  assert.doesNotThrow(()=>assertUploadable([{name:'video.mp4',size:50*mb},{name:'file.pdf',size:50*mb}]));
  assert.throws(()=>assertUploadable([{name:'file.pdf',size:50*mb+1}]),/limit is 50 MB/);
});
test('video-note size is rejected before any network request',async()=>{
  const before=calls.length;
  assert.doesNotThrow(()=>assertUploadable([{name:'note.webm',size:10*mb}],{type:'videoNote'}));
  await assert.rejects(uploadFiles([{name:'note.webm',size:10*mb+1}],{type:'videoNote'}),/Video note.*10 MB/);
  assert.equal(calls.length,before);
});
test('video-note uploads declare their stricter server-side limit',async()=>{
  await uploadFiles([new File(['sample'],'note.webm',{type:'video/webm'})],{type:'videoNote'});
  assert.deepEqual(calls.at(-1)[2].params,{type:'videoNote'});
  await uploadFiles([new File(['sample'],'file.txt',{type:'text/plain'})]);
  assert.equal(calls.at(-1)[2].params,undefined);
});
