import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOutgoing } from '../controllers/messageController.js';
const note=extra=>({type:'videoNote',attachments:[{url:'https://example.invalid/note.webm',size:1024,duration:30,...extra}]});
test('video-note attachment metadata respects the 10 MB / 60 second boundary',()=>{
  assert.equal(validateOutgoing(note({size:10*1024*1024,duration:60})).type,'videoNote');
  assert.throws(()=>validateOutgoing(note({size:10*1024*1024+1})),/10 MB/);
  assert.throws(()=>validateOutgoing(note({duration:61})),/60 seconds/);
});
test('ordinary video retains its existing size and duration behavior',()=>{
  const body=note({size:40*1024*1024,duration:120});body.type='video';
  assert.equal(validateOutgoing(body).type,'video');
});
