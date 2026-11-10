// Local-only query-count and index-plan acceptance check. No live profiler or
// production credentials are used. Supply a local MONGO_URI to run it.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import { getChats } from '../controllers/chatController.js';
import { invalidateChatListCache } from '../utils/chatCache.js';

const uri=new URL(process.env.MONGO_URI||'');
if (!['127.0.0.1','localhost'].includes(uri.hostname)||process.env.REDIS_URL) throw new Error('Use local MongoDB and no Redis for this fixture.');
uri.pathname='/chatconnect_t_chat_load';
const id=()=>new mongoose.Types.ObjectId();
const queries=[];
const invoke=user=>new Promise((resolve,reject)=>{getChats({user},{json:resolve},reject);});
try {
  await mongoose.connect(uri.href);
  assert.equal(mongoose.connection.name,'chatconnect_t_chat_load');
  await mongoose.connection.dropDatabase();
  await Promise.all([User.init(),Chat.init(),Message.init()]);
  const me=id(),peer=id();
  await User.collection.insertMany([
    {_id:me,name:'Load A',username:'load_a',email:'a@example.invalid'},
    {_id:peer,name:'Load B',username:'load_b',email:'b@example.invalid'},
  ]);
  const chat=await Chat.create({participants:[{user:me},{user:peer}]});
  const rows=await Message.insertMany(Array.from({length:1000},(_,i)=>({chat:chat._id,sender:peer,content:'fixture '+i,starredBy:[me]})));
  await Chat.updateOne({_id:chat._id},{$set:{lastMessage:rows.at(-1)._id}});
  const user=await User.findById(me);
  mongoose.set('debug',(collection,method)=>queries.push(collection+'.'+method));
  const serial=[];
  for(let i=0;i<10;i++) serial.push(await invoke(user));
  const baseline=queries.length;
  queries.length=0;
  const burst=await Promise.all(Array.from({length:10},()=>invoke(user)));
  const optimized=queries.length;
  assert.equal(baseline,optimized*10);
  for(const response of burst) assert.deepEqual(response,serial[0]);
  assert.equal(burst[0].chats[0].unreadCount,1000);
  console.log(JSON.stringify({scenario:'10 identical chat list reads',sequentialDatabaseCommands:baseline,concurrentDatabaseCommands:optimized,responsesEqual:true}));
  // A post-mutation read must not reuse previously completed results.
  await Message.updateMany({chat:chat._id},{$push:{readBy:{user:me,at:new Date()}}});
  await invalidateChatListCache(me);
  assert.equal((await invoke(user)).chats[0].unreadCount,0);
  const pinned={...user.toObject(),pinnedChats:[chat._id]};
  const [normal,personal]=await Promise.all([invoke(user),invoke(pinned)]);
  assert.equal(normal.chats[0].pinned,false);assert.equal(personal.chats[0].pinned,true);
  mongoose.set('debug',false);
  const history=await Message.find({chat:chat._id}).sort({createdAt:-1,_id:-1}).limit(40).explain('executionStats');
  const stars=await Message.find({starredBy:me}).sort({createdAt:-1,_id:-1}).limit(40).explain('executionStats');
  for(const [name,plan] of [['history',history],['starred',stars]]) {
    assert.equal(plan.executionStats.nReturned,40);
    assert.ok(plan.executionStats.totalDocsExamined<=40);
    assert.doesNotMatch(JSON.stringify(plan.queryPlanner.winningPlan),/"stage":"(?:COLLSCAN|SORT)"/);
    console.log(JSON.stringify({query:name,returned:plan.executionStats.nReturned,documentsExamined:plan.executionStats.totalDocsExamined,keysExamined:plan.executionStats.totalKeysExamined}));
  }
  const indexes=await Message.collection.indexes();
  assert.ok(!indexes.some(x=>['chat_1','chat_1_createdAt_-1','starredBy_1_createdAt_-1'].includes(x.name)));
  console.log('PASS response parity, fresh unread counts, personal flag isolation and index coverage');
} finally {mongoose.set('debug',false);await mongoose.disconnect();}
