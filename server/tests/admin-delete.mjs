// Run: node --test server/tests/admin-delete.mjs
// Uses a new, isolated database on the configured MongoDB server.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import dns from 'node:dns';
import test from 'node:test';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Meeting from '../models/Meeting.js';
import Session from '../models/Session.js';
import adminRoutes from '../routes/adminRoutes.js';
import { createSession } from '../utils/session.js';
import { signAccessToken } from '../utils/token.js';

dotenv.config({ path: new URL('../.env', import.meta.url) });
process.env.JWT_SECRET = 'isolated-admin-delete-regression-secret';

test('admin deletion cleans references without requiring optional nested arrays', async (t) => {
  assert.ok(process.env.MONGO_URI, 'MONGO_URI is required');
  if (process.env.MONGO_URI.includes('+srv')) dns.setServers(['8.8.8.8', '1.1.1.1']);
  const dbName = `chatconnect_t_delete_${randomUUID().slice(0, 8)}`;
  await mongoose.connect(process.env.MONGO_URI, { dbName, serverSelectionTimeoutMS: 15000 });
  t.after(async () => {
    assert.equal(mongoose.connection.name, dbName);
    try { await mongoose.connection.dropDatabase(); }
    finally { await mongoose.disconnect(); }
  });

  const makeUser = (username, role = 'user') => User.create({
    username, name: username, email: `${username}@test.local`, password: 'DeleteTestPass42!', role,
  });
  const admin = await makeUser('delete_admin', 'admin');
  const target = await makeUser('delete_target');
  const peer = await makeUser('delete_peer');
  const { session } = await createSession(admin);
  const token = signAccessToken(admin, session._id);
  const { session: peerSession } = await createSession(peer);
  const peerToken = signAccessToken(peer, peerSession._id);
  await createSession(target);

  const group = await Chat.create({ isGroup: true, name: 'Shared group', participants: [
    { user: target._id, role: 'owner' }, { user: peer._id },
  ] });
  const direct = await Chat.create({ participants: [{ user: target._id }, { user: peer._id }] });
  const ordinary = await Message.create({ chat: group._id, sender: peer._id, content: 'Keep this', mentions: [target._id] });
  const ownMessage = await Message.create({ chat: group._id, sender: target._id, content: 'Remove this' });
  const directMessage = await Message.create({ chat: direct._id, sender: peer._id, content: 'Direct' });
  const poll = await Message.create({ chat: group._id, sender: peer._id, type: 'poll', poll: {
    question: 'Choose', options: [{ text: 'A', votes: [target._id, peer._id] }],
  } });
  const basicMeeting = await Meeting.create({ title: 'Basic', roomCode: 'test-basic-room', host: peer._id, startAt: new Date(), participants: [{ user: target._id }] });
  // Older records can lack arrays that are now populated by schema defaults.
  await Meeting.collection.updateOne({ _id: basicMeeting._id }, { $unset: { polls: '', questions: '' } });
  const fullMeeting = await Meeting.create({ title: 'Full', roomCode: 'test-full-room', host: peer._id, startAt: new Date(),
    attendees: [{ user: target._id }, { user: peer._id }],
    polls: [{ question: 'Choose', options: ['A'], votes: [{ user: target._id, choices: [0] }, { user: peer._id, choices: [0] }] }],
    questions: [{ text: 'Why?', upvotes: [target._id, peer._id] }],
  });
  await User.updateOne({ _id: peer._id }, { $set: { contacts: [target._id], pinnedChats: [direct._id] } });

  const app = express();
  app.use('/api/admin', adminRoutes);
  app.use((err, req, res, next) => res.status(err.statusCode || 500).json({ message: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())));
  const request = (id, auth = token) => fetch(`http://127.0.0.1:${server.address().port}/api/admin/users/${id}`, {
    method: 'DELETE', headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  });
  assert.equal((await request(target._id, '')).status, 401);
  assert.equal((await request(target._id, peerToken)).status, 403);
  assert.equal((await request(admin._id)).status, 400);
  assert.ok(await User.exists({ _id: target._id }));

  const response = await request(target._id);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.success, true);
  assert.equal(await User.findById(target._id), null);
  assert.equal(await Session.countDocuments({ user: target._id }), 0);
  assert.equal(await Chat.findById(direct._id), null);
  assert.equal(await Message.findById(directMessage._id), null);
  assert.equal(await Message.findById(ownMessage._id), null);
  const remainingGroup = await Chat.findById(group._id);
  assert.deepEqual(remainingGroup.participants.map((p) => String(p.user)), [String(peer._id)]);
  assert.equal(remainingGroup.participants[0].role, 'owner');
  assert.deepEqual((await Message.findById(ordinary._id)).mentions, []);
  assert.deepEqual((await Message.findById(poll._id)).poll.options[0].votes.map(String), [String(peer._id)]);
  assert.deepEqual((await Meeting.findById(basicMeeting._id)).participants, []);
  const remainingMeeting = await Meeting.findById(fullMeeting._id);
  assert.deepEqual(remainingMeeting.attendees.map((a) => String(a.user)), [String(peer._id)]);
  assert.deepEqual(remainingMeeting.polls[0].votes.map((v) => String(v.user)), [String(peer._id)]);
  assert.deepEqual(remainingMeeting.questions[0].upvotes.map(String), [String(peer._id)]);
  const remainingPeer = await User.findById(peer._id);
  assert.deepEqual(remainingPeer.contacts, []);
  assert.deepEqual(remainingPeer.pinnedChats, []);
  assert.equal((await request(target._id)).status, 404);
  assert.equal((await request(new mongoose.Types.ObjectId())).status, 404);
});
