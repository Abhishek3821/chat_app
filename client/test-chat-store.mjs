import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { create } from 'zustand';

// Exercise the complete production store with controlled HTTP responses. No DOM
// or browser claims: these tests check state transitions and network failures.
const source=fs.readFileSync(new URL('./src/store/useChat.js',import.meta.url),'utf8')
  .replace(/^import .*;\r?\n/gm,'').replace('export const useChat','const useChat');
function fixture(overrides={}) {
  const notices=[];
  const api={get:async()=>({data:{messages:[],chats:[]}}),post:async()=>({data:{}}),patch:async()=>({data:{}}),delete:async()=>({data:{}}),...overrides};
  const toast={error:message=>notices.push(message),success:()=>{}};
  const store=new Function('create','toast','api','DEMO_MODE','CHATS','MESSAGES','useAuth',source+'\nreturn useChat;')(
    create,toast,api,false,[],{}, {getState:()=>({user:{_id:'me',name:'Tester'}})});
  store.setState({chats:[{_id:'chat',unreadCount:0}],activeChatId:'chat'});
  return {store,notices};
}
test('rapid sends keep unique identities and deduplicate the socket echo',async()=>{
  const pending=[];
  const {store}=fixture({post:()=>new Promise(resolve=>pending.push(resolve))});
  const a=store.getState().sendMessage({chatId:'chat',content:'first'});
  const b=store.getState().sendMessage({chatId:'chat',content:'second'});
  const rows=store.getState().messagesByChat.chat;
  assert.equal(new Set(rows.map(m=>m._id)).size,2);
  store.getState().appendMessage('chat',{_id:'saved1',content:'first',sender:{_id:'me'}});
  pending[0]({data:{message:{_id:'saved1',content:'first',sender:{_id:'me'}}}});
  pending[1]({data:{message:{_id:'saved2',content:'second',sender:{_id:'me'}}}});
  await Promise.all([a,b]);
  assert.deepEqual(store.getState().messagesByChat.chat.map(m=>m._id),['saved1','saved2']);
  assert.equal(store.getState().chats[0].unreadCount,0);
});
test('failed send remains visible as failed',async()=>{
  const {store}=fixture({post:async()=>{throw new Error('offline');}});
  await store.getState().sendMessage({chatId:'chat',content:'keep this text'});
  assert.equal(store.getState().messagesByChat.chat[0].status,'failed');
  assert.equal(store.getState().messagesByChat.chat[0].content,'keep this text');
});
test('rejected edit restores the original content',async()=>{
  const {store}=fixture({patch:async()=>{throw new Error('offline');}});
  store.setState({messagesByChat:{chat:[{_id:'m',content:'original'}]}});
  await store.getState().editMessage('chat','m','replacement');
  assert.equal(store.getState().messagesByChat.chat[0].content,'original');
});
test('rejected deletion restores the message and explains the error',async()=>{
  const {store,notices}=fixture({delete:async()=>{throw new Error('offline');}});
  store.setState({messagesByChat:{chat:[{_id:'m',content:'keep me'}]}});
  await store.getState().deleteMessage('chat','m','me');
  assert.equal(store.getState().messagesByChat.chat[0]?.content,'keep me');
  assert.equal(notices.length,1);
});
test('returning from search restores scroll-back availability',async()=>{
  const {store}=fixture({get:async()=>({data:{messages:[{_id:'latest'}]}})});
  store.setState({windowedChats:{chat:true},noMoreOlder:{chat:true}});
  await store.getState().resetMessageWindow('chat');
  assert.equal(store.getState().windowedChats.chat,false);
  assert.equal(store.getState().noMoreOlder.chat,false);
});
test('reconnect returns to newest history and re-enables scroll-back',async()=>{
  const {store}=fixture({get:async path=>({data:path==='/chats'?{chats:[{_id:'chat'}]}:{messages:[{_id:'latest'}]}})});
  store.setState({windowedChats:{chat:true},noMoreOlder:{chat:true}});
  await store.getState().resync();
  assert.equal(store.getState().messagesByChat.chat[0]._id,'latest');
  assert.equal(store.getState().windowedChats.chat,false);
  assert.equal(store.getState().noMoreOlder.chat,false);
});
test('failed deletion keeps concurrent incoming messages',async()=>{
  let fail;
  const {store}=fixture({delete:()=>new Promise((resolve,reject)=>{fail=reject;})});
  store.setState({messagesByChat:{chat:[{_id:'m',content:'original'}]}});
  const pending=store.getState().deleteMessage('chat','m','everyone');
  store.getState().appendMessage('chat',{_id:'incoming',content:'new',sender:{_id:'peer'}});
  fail(new Error('offline'));await pending;
  assert.deepEqual(store.getState().messagesByChat.chat.map(m=>m.content),['original','new']);
  assert.equal(store.getState().messagesByChat.chat[0].isDeleted,undefined);
});
test('scroll-back supplies both timestamp and ID and merges without duplicates',async()=>{
  let sent;
  const stamp='2026-10-19T00:00:00.000Z';
  const {store}=fixture({get:async(path,opts)=>{sent=opts.params;return {data:{messages:[{_id:'old',createdAt:stamp},{_id:'existing',createdAt:stamp}]}};}});
  store.setState({messagesByChat:{chat:[{_id:'existing',createdAt:stamp}]}});
  assert.equal(await store.getState().loadOlderMessages('chat'),1);
  assert.equal(sent.beforeId,'existing');
  assert.deepEqual(store.getState().messagesByChat.chat.map(m=>m._id),['old','existing']);
});
test('safe storage tolerates browser denial and supports normal drafts',async()=>{
  const storageSource=fs.readFileSync(new URL('./src/lib/storage.js',import.meta.url),'utf8').replace(/export const/g,'const');
  const factory=new Function('window',storageSource+'\nreturn safeLocalStorage;');
  const denied=factory({get localStorage(){throw new Error('SecurityError');}});
  assert.equal(denied.getItem('draft'),null);
  assert.doesNotThrow(()=>{denied.setItem('draft','hello');denied.removeItem('draft');});
  const map=new Map();
  const allowed=factory({localStorage:{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}});
  allowed.setItem('draft','hello');assert.equal(allowed.getItem('draft'),'hello');
  allowed.removeItem('draft');assert.equal(allowed.getItem('draft'),null);
});
