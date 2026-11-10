import test from 'node:test';
import assert from 'node:assert/strict';
import { emitChatRead, resetChatReads } from './src/lib/chatReadReceipts.js';

function socket() {const events=[];return {events,emit:(...args)=>events.push(args)};}
test('socket delivery and chat render acknowledge one message only once',()=>{
  const s=socket();
  assert.equal(emitChatRead(s,'chat','m1'),true);
  assert.equal(emitChatRead(s,'chat','m1'),false);
  assert.deepEqual(s.events,[['message:read',{chatId:'chat'}]]);
});
test('a burst of distinct messages keeps every immediate receipt',()=>{
  const s=socket();
  for(let i=0;i<20;i++) {emitChatRead(s,'chat','m'+i);emitChatRead(s,'chat','m'+i);}
  assert.equal(s.events.length,20); // formerly two paths = 40 emits
});
test('reopening the same conversation marks it read again',()=>{
  const s=socket();
  emitChatRead(s,'chat','m1');
  emitChatRead(s,'chat','m1',true);
  emitChatRead(s,'chat','m1');
  assert.equal(s.events.length,2);
});
test('reconnect and account changes cannot inherit a suppressed watermark',()=>{
  const a=socket(),b=socket();
  emitChatRead(a,'chat','m1');resetChatReads(a);emitChatRead(a,'chat','m1');
  emitChatRead(b,'chat','m1');
  assert.equal(a.events.length,2);assert.equal(b.events.length,1);
});
test('different chats and legacy reads without a watermark stay independent',()=>{
  const s=socket();
  emitChatRead(s,'a','m');emitChatRead(s,'b','m');
  emitChatRead(s,'a');emitChatRead(s,'a');
  assert.equal(s.events.length,4);
  assert.equal(emitChatRead(null,'a','m'),false);
});
test('a failed emit can be retried immediately',()=>{
  const s=socket(),emit=s.emit;
  s.emit=()=>{throw new Error('closed transport');};
  assert.throws(()=>emitChatRead(s,'chat','m'));
  s.emit=emit;assert.equal(emitChatRead(s,'chat','m'),true);
});
