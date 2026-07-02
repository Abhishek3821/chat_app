/**
 * Seeds the database with demo users, a group and some messages so you can
 * log in and explore immediately.  Run with:  npm run seed  (from /server)
 *
 * Demo login:  aria@chatconnect.app  /  password123   (all demo users share it)
 * Admin login: admin@chatconnect.app /  password123
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import ContactRequest from '../models/ContactRequest.js';
import Status from '../models/Status.js';

const PASSWORD = 'password123';

const demoUsers = [
  { name: 'Aria Vance', username: 'aria', email: 'aria@chatconnect.app', bio: 'Product designer • coffee first ☕' },
  { name: 'Leo Marsh', username: 'leo', email: 'leo@chatconnect.app', bio: 'Building things on the web' },
  { name: 'Maya Chen', username: 'maya', email: 'maya@chatconnect.app', bio: 'Photographer & traveller 📷' },
  { name: 'Noah Reed', username: 'noah', email: 'noah@chatconnect.app', bio: 'Runner. Reader. Realist.' },
  { name: 'Sofia Diaz', username: 'sofia', email: 'sofia@chatconnect.app', bio: 'Music is life 🎧' },
  { name: 'Admin', username: 'admin', email: 'admin@chatconnect.app', bio: 'ChatConnect operations', role: 'admin' },
];

async function run() {
  await connectDB();
  if (mongoose.connection.readyState !== 1) {
    console.error('❌ Could not connect to MongoDB. Set MONGO_URI in server/.env first.');
    process.exit(1);
  }

  console.log('🧹 Clearing existing demo data…');
  await Promise.all([
    User.deleteMany({}),
    Chat.deleteMany({}),
    Message.deleteMany({}),
    ContactRequest.deleteMany({}),
    Status.deleteMany({}),
  ]);

  console.log('👤 Creating users…');
  const users = [];
  for (const u of demoUsers) {
    // create() runs the pre-save hook so passwords are hashed.
    const user = await User.create({
      ...u,
      password: PASSWORD,
      isVerified: true,
      avatar: `https://api.dicebear.com/9.x/glass/svg?seed=${u.username}`,
    });
    users.push(user);
  }

  const [aria, leo, maya, noah, sofia] = users;

  // Mutual contacts (both sides must have each other so chatting is allowed).
  async function connect(a, b) {
    await User.findByIdAndUpdate(a._id, { $addToSet: { contacts: b._id } });
    await User.findByIdAndUpdate(b._id, { $addToSet: { contacts: a._id } });
  }
  await connect(aria, leo);
  await connect(aria, maya);
  await connect(leo, maya);
  aria.favorites = [maya._id, leo._id];
  await aria.save();

  // Pending contact requests → so the "accept a friend request" flow is demoable
  // when you log in as Aria.
  await ContactRequest.create({ from: noah._id, to: aria._id, message: 'Hey Aria, saw your designs — let’s connect!' });
  await ContactRequest.create({ from: sofia._id, to: aria._id, message: '' });

  // A couple of status updates (expire in 24h via the TTL index).
  await Status.create({ user: aria._id, type: 'text', content: 'Shipping something beautiful today ✨', background: 'linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4)' });
  await Status.create({ user: leo._id, type: 'text', content: 'Coffee & code ☕', background: 'linear-gradient(135deg,#f59e0b,#ec4899)' });

  console.log('💬 Creating direct chats + messages…');
  async function directChat(a, b, msgs) {
    const chat = await Chat.create({ isGroup: false, participants: [{ user: a._id }, { user: b._id }] });
    let last;
    for (const [sender, text] of msgs) {
      last = await Message.create({
        chat: chat._id,
        sender: sender._id,
        content: text,
        readBy: [{ user: sender._id, at: new Date() }],
      });
    }
    chat.lastMessage = last?._id;
    await chat.save();
    return chat;
  }

  await directChat(aria, leo, [
    [leo, 'Hey Aria! Did you get a chance to look at the new mockups?'],
    [aria, 'Just opened them — the glass cards look 🔥'],
    [leo, 'Right? The gradient accents really pop in dark mode.'],
    [aria, "Let's ship it this week 🚀"],
  ]);
  await directChat(aria, maya, [
    [maya, 'Sending over the photos from the shoot 📷'],
    [aria, 'Amazing, thank you! The lighting is perfect.'],
  ]);
  await directChat(aria, noah, [[noah, 'Call me when you are free 📞']]);

  console.log('👥 Creating a group…');
  const group = await Chat.create({
    isGroup: true,
    name: 'Design Guild',
    description: 'Where pixels meet purpose.',
    avatar: 'https://api.dicebear.com/9.x/shapes/svg?seed=DesignGuild',
    createdBy: aria._id,
    participants: [
      { user: aria._id, role: 'owner' },
      { user: leo._id, role: 'admin' },
      { user: maya._id, role: 'member' },
      { user: sofia._id, role: 'member' },
    ],
  });
  const g1 = await Message.create({ chat: group._id, sender: aria._id, content: 'Welcome to the Design Guild everyone! 🎨' });
  await Message.create({ chat: group._id, sender: sofia._id, content: 'So happy to be here 💜' });
  group.lastMessage = g1._id;
  await group.save();

  console.log('\n✅ Seed complete!');
  console.log('   Users (password for all):', PASSWORD);
  demoUsers.forEach((u) => console.log(`   • ${u.email}${u.role === 'admin' ? '  (admin)' : ''}`));
  await mongoose.connection.close();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
