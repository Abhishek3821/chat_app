import test from 'node:test';
import assert from 'node:assert/strict';
import { createReadCoalescer } from '../utils/readCoalescer.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('ten concurrent identical reads use one loader, with no completed-result cache',async()=>{
  const reads=createReadCoalescer(),gate=deferred();let calls=0;
  const load=()=>{calls++;return gate.promise;};
  const pending=Array.from({length:10},()=>reads.run('user','list',load));
  await Promise.resolve();assert.equal(calls,1);
  gate.resolve({chats:['latest']});
  for(const result of await Promise.all(pending)) assert.deepEqual(result,{chats:['latest']});
  await reads.run('user','list',load);assert.equal(calls,2);
});
test('users and guest/settings variants never share results',async()=>{
  const reads=createReadCoalescer();
  const results=await Promise.all([
    reads.run('a','list',()=>['a']),reads.run('b','list',()=>['b']),
    reads.run('a','locked',()=>['locked']),reads.run('a','guest',()=>['guest']),
  ]);
  assert.deepEqual(results,[['a'],['b'],['locked'],['guest']]);
});
test('invalidation forces a new read and prevents an old read being cached',async()=>{
  const reads=createReadCoalescer(),old=deferred(),fresh=deferred();let oldCurrent,newCurrent;
  const a=reads.run('user','list',async current=>{oldCurrent=current;return old.promise;});
  await Promise.resolve();reads.invalidate('user');
  const b=reads.run('user','list',async current=>{newCurrent=current;return fresh.promise;});
  await Promise.resolve();assert.equal(oldCurrent(),false);assert.equal(newCurrent(),true);
  old.resolve('old');assert.equal(await a,'old');assert.equal(newCurrent(),true);
  fresh.resolve('fresh');assert.equal(await b,'fresh');
});
test('failed reads are shared only until failure and can be retried',async()=>{
  const reads=createReadCoalescer();let calls=0;
  const load=()=>{calls++;throw new Error('database unavailable');};
  const results=await Promise.allSettled([reads.run('u','list',load),reads.run('u','list',load)]);
  assert.equal(calls,1);assert.ok(results.every(x=>x.status==='rejected'));
  assert.equal(await reads.run('u','list',()=>42),42);
});
