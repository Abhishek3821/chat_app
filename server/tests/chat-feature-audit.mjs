// Focused acceptance checks for chat actions and access boundaries.
// Run with an isolated MONGO_URI. Never uses the configured application DB.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Message from '../models/Message.js';
import { unlink } from 'node:fs/promises';
const serverDir = fileURLToPath(new URL('../', import.meta.url));
const uri = new URL(process.env.MONGO_URI || '');
if (!['127.0.0.1', 'localhost'].includes(uri.hostname)) throw new Error('Audit requires a local MongoDB fixture.');
uri.pathname = '/chatconnect_t_chat_acceptance';
const port = 5148, api = `http://127.0.0.1:${port}/api`;
const checks = [];
const check = (name, pass, detail='') => {checks.push({name,pass:!!pass});console.log(`${pass?'PASS':'FAIL'} ${name}${pass?'':': '+detail}`);};
const delay = ms => new Promise(r=>setTimeout(r,ms));
let proc;
async function http(method, route, user, body) {
  const response = await fetch(api+route,{method,headers:{'Content-Type':'application/json',...(user?{Authorization:`Bearer ${user.token}`}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,data:await response.json()};
}
async function user(tag) {
  const value = Date.now()+Math.floor(Math.random()*100000);
  const r = await http('POST','/auth/signup',null,{name:'Audit '+tag,email:`audit-${tag}-${value}@example.invalid`,phone:'+1555'+String(value).slice(-7),password:'Audit-Password-123!',confirmPassword:'Audit-Password-123!'});
  if(r.status!==201) throw new Error('Fixture signup: '+r.data.message);
  return {id:r.data.user._id,token:r.data.accessToken||r.data.token};
}
async function befriend(a,b) {
  await http('POST',`/contacts/request/${b.id}`,a);
  const list=await http('GET','/contacts/requests',b);
  const req=list.data.incoming.find(x=>String(x.from._id)===a.id);
  await http('PATCH',`/contacts/request/${req._id}`,b,{action:'accept'});
}
const send=(a,chatId,extra)=>http('POST','/messages',a,{chatId,content:'chat acceptance',...extra});
try {
  await mongoose.connect(uri.href);
  // This URI is derived above from a local-only, dedicated fixture name.
  if(mongoose.connection.name!=='chatconnect_t_chat_acceptance') throw new Error('Wrong fixture database.');
  await mongoose.connection.dropDatabase();
  proc=spawn(process.execPath,['server.js'],{cwd:serverDir,env:{...process.env,MONGO_URI:uri.href,PORT:String(port),ENABLE_EMAIL_VERIFICATION:'false'},stdio:'ignore',windowsHide:true});
  let ready=false;
  for(let i=0;i<100;i++) {try {if((await fetch(api+'/health')).ok){ready=true;break;}}catch{} await delay(250);}
  if(!ready) throw new Error('Audit server did not start.');
  const a=await user('a'), b=await user('b'), c=await user('c');
  await befriend(a,b); await befriend(a,c);
  const ab=(await http('POST',`/chats/direct/${b.id}`,a)).data.chat._id;
  const ac=(await http('POST',`/chats/direct/${c.id}`,a)).data.chat._id;
  const original=await send(a,ab,{content:'Hello 👋\nहेलो — multiline'});
  check('Unicode, emoji and multiline text survive sending',original.status===201&&original.data.message.content==='Hello 👋\nहेलो — multiline');
  const quote=await send(b,ab,{replyTo:original.data.message._id});
  check('Reply includes the correct original message',quote.status===201&&quote.data.message.replyTo?.content===original.data.message.content);
  const privateMessage=await send(a,ac,{content:'private AC content'});
  const foreign=await send(b,ab,{replyTo:privateMessage.data.message._id});
  check('Reply cannot expose a message from another chat',foreign.status===400||foreign.status===404,`HTTP ${foreign.status}`);
  const schedule=await http('POST','/messages/schedule',b,{chatId:ab,content:'scheduled quote',replyTo:privateMessage.data.message._id,sendAt:new Date(Date.now()+600000).toISOString()});
  check('Scheduled reply also rejects another chat message',schedule.status===400||schedule.status===404,`HTTP ${schedule.status}`);
  const malformed=await send(a,ab,{replyTo:'not-a-message-id'});
  check('Malformed reply ID returns a validation error',malformed.status===400,`HTTP ${malformed.status}`);
  check('Nonparticipant cannot read chat history',(await http('GET',`/messages/${ac}`,b)).status===403);
  check('Nonparticipant cannot send into a private chat',(await send(b,ac,{})).status===403);
  check('Cannot edit another sender message',(await http('PATCH',`/messages/${original.data.message._id}`,b,{content:'override'})).status===403);
  check('Cannot retract another sender message',(await http('DELETE',`/messages/${original.data.message._id}?scope=everyone`,b)).status===403);
  for(const type of ['image','video','videoNote','audio','voice','document']) {
    let attachments=[{url:'https://example.invalid/audit-'+type,name:'sample',mime:type==='document'?'application/pdf':type.startsWith('video')?'video/webm':type==='image'?'image/png':'audio/webm'}];
    if(type==='videoNote') {
      const form=new FormData();form.append('files',new Blob(['audit-video-note'],{type:'video/webm'}),'chat-acceptance-note.webm');
      const uploaded=await fetch(api+'/upload?type=videoNote',{method:'POST',headers:{Authorization:`Bearer ${a.token}`},body:form});
      attachments=(await uploaded.json()).attachments;
    }
    const media=await send(a,ab,{content:'',type,attachments});
    check(type+' message metadata persists',media.status===201&&media.data.message.type===type);
    if(type==='videoNote' && attachments?.[0]?.url.startsWith('/uploads/chat_acceptance_note-')) {
      await unlink(new URL('../uploads/'+attachments[0].url.split('/').pop(),import.meta.url));
    }
  }
  const once=await send(a,ab,{content:'',type:'image',viewOnce:true,attachments:[{url:'https://example.invalid/once.png'}]});
  await http('POST',`/messages/${once.data.message._id}/viewed`,b);
  const consumed=await Message.findById(once.data.message._id).lean();
  check('View-once media is removed after recipient opens it',consumed.viewedBy.some(x=>String(x)===b.id)&&consumed.attachments.length===0);
  const star=await http('POST',`/messages/${original.data.message._id}/star`,a);
  check('Starred message can be removed again',star.data.starred===true&&(await http('POST',`/messages/${original.data.message._id}/star`,a)).data.starred===false);
  await http('DELETE',`/messages/${original.data.message._id}`,a);
  const context=await http('GET',`/messages/${ab}/context/${original.data.message._id}`,a);
  check('Jump-to-message cannot restore a message deleted for me',context.status===404,`HTTP ${context.status}`);
  const hiddenQuote=await send(a,ab,{replyTo:original.data.message._id});
  check('Cannot reply to a message deleted for me',hiddenQuote.status===400||hiddenQuote.status===404,`HTTP ${hiddenQuote.status}`);
  check('Block user request succeeds',(await http('POST',`/users/me/block/${b.id}`,a)).status===200);
  const blockedText=await send(b,ab,{});
  check('Blocking prevents text through an existing direct chat',blockedText.status===403,`HTTP ${blockedText.status}`);
  const blockedPoll=await http('POST','/messages/poll',b,{chatId:ab,question:'Blocked poll?',options:['Yes','No']});
  check('Blocking also prevents poll messages',blockedPoll.status===403,`HTTP ${blockedPoll.status}`);
  await http('POST',`/users/me/block/${b.id}`,a); // toggle unblock
  // A burst/bulk import can legitimately give multiple messages the same millisecond.
  const tiedAt=new Date(Date.now()-3600000);
  const tied=await Message.insertMany(Array.from({length:45},(_,i)=>({chat:ac,sender:a.id,content:'burst '+i,createdAt:tiedAt,updatedAt:tiedAt})));
  const page=await http('GET',`/messages/${ac}?limit=40`,a);
  const oldest=page.data.messages[0];
  const older=await http('GET',`/messages/${ac}?limit=40&before=${encodeURIComponent(oldest.createdAt)}&beforeId=${oldest._id}`,a);
  const loaded=new Set([...page.data.messages,...older.data.messages].map(m=>m._id));
  check('Scroll-back retains messages sharing the cursor timestamp',tied.every(m=>loaded.has(String(m._id))),`${tied.filter(m=>loaded.has(String(m._id))).length}/45 found`);
  const middle=await http('GET',`/messages/${ac}/context/${tied[22]._id}?radius=3`,a);
  check('Search jump includes neighbors with the same timestamp',middle.status===200&&middle.data.messages.length===7,`${middle.data.messages?.length} messages`);
  await Message.updateMany({_id:{$in:tied.map(m=>m._id)}},{$set:{starredBy:[a.id]}});
  const stars=await http('GET','/messages/starred?limit=40',a);
  const starCursor=stars.data.messages.at(-1);
  const moreStars=await http('GET',`/messages/starred?limit=40&before=${encodeURIComponent(starCursor.createdAt)}&beforeId=${starCursor._id}`,a);
  check('Starred pagination retains every message in a timestamp tie',new Set([...stars.data.messages,...moreStars.data.messages].map(m=>m._id)).size===45);
  const hits=await http('GET',`/messages/${ac}/search?q=burst&limit=40`,a);
  const hitCursor=hits.data.messages.at(-1);
  const moreHits=await http('GET',`/messages/${ac}/search?q=burst&limit=40&before=${encodeURIComponent(hitCursor.createdAt)}&beforeId=${hitCursor._id}`,a);
  check('Search pagination retains every message in a timestamp tie',new Set([...hits.data.messages,...moreHits.data.messages].map(m=>m._id)).size===45);
  check('Invalid history cursor is rejected',(await http('GET',`/messages/${ac}?before=invalid-date`,a)).status===400);
  const timer=await http('PATCH',`/chats/${ac}/disappearing`,a,{seconds:86400});
  const ephemeral=await send(a,ac,{content:'disappearing message'});
  check('Disappearing timer stamps the outgoing message expiry',timer.status===200&&new Date(ephemeral.data.message.expiresAt)>new Date());
  await http('DELETE',`/chats/${ac}/clear`,a);
  check('Clear chat hides history only for the requesting user',(await http('GET',`/messages/${ac}`,a)).data.messages.length===0&&(await http('GET',`/messages/${ac}`,c)).data.messages.length>0);
  console.log(`${checks.filter(x=>x.pass).length}/${checks.length} checks passed`);
  process.exitCode=checks.every(x=>x.pass)?0:1;
} catch(error) { console.error(error); process.exitCode=1; }
finally {proc?.kill(); await mongoose.disconnect();}
