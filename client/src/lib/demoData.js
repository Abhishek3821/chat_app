/* Rich mock data so the entire UI is explorable with no backend running.
   Active when VITE_DEMO_MODE=true (the default). */

const av = (seed) => `https://api.dicebear.com/9.x/glass/svg?seed=${seed}`;
const now = Date.now();
const mins = (m) => new Date(now - m * 60 * 1000).toISOString();
const hrs = (h) => new Date(now - h * 60 * 60 * 1000).toISOString();
const days = (d) => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();
const inHrs = (h) => new Date(now + h * 60 * 60 * 1000).toISOString();
const inDays = (d) => new Date(now + d * 24 * 60 * 60 * 1000).toISOString();

export const ME = {
  _id: 'me',
  name: 'Abhishek Singh',
  username: 'abhishek',
  email: 'abhisheksingh@capyngen.com',
  avatar: av('abhishek'),
  bio: 'Building ChatConnect ✨',
  isOnline: true,
  role: 'admin',
};

export const USERS = [
  { _id: 'u1', name: 'Aria Vance', username: 'aria', email: 'aria@chatconnect.app', avatar: av('aria'), bio: 'Product designer • coffee first ☕', isOnline: true },
  { _id: 'u2', name: 'Leo Marsh', username: 'leo', email: 'leo@chatconnect.app', avatar: av('leo'), bio: 'Building things on the web', isOnline: true },
  { _id: 'u3', name: 'Maya Chen', username: 'maya', email: 'maya@chatconnect.app', avatar: av('maya'), bio: 'Photographer & traveller 📷', isOnline: false, lastSeen: hrs(2) },
  { _id: 'u4', name: 'Noah Reed', username: 'noah', email: 'noah@chatconnect.app', avatar: av('noah'), bio: 'Runner. Reader. Realist.', isOnline: false, lastSeen: hrs(5) },
  { _id: 'u5', name: 'Sofia Diaz', username: 'sofia', email: 'sofia@chatconnect.app', avatar: av('sofia'), bio: 'Music is life 🎧', isOnline: true },
  { _id: 'u6', name: 'Kai Tanaka', username: 'kai', email: 'kai@chatconnect.app', avatar: av('kai'), bio: 'iOS dev 🦄', isOnline: false, lastSeen: days(1) },
  { _id: 'u7', name: 'Elena Popova', username: 'elena', email: 'elena@chatconnect.app', avatar: av('elena'), bio: 'Ballet & backend', isOnline: true },
];

const U = Object.fromEntries(USERS.map((u) => [u._id, u]));

export const CHATS = [
  {
    _id: 'c1',
    isGroup: false,
    peer: U.u1,
    pinned: true,
    muted: false,
    unreadCount: 2,
    lastMessage: { content: "Let's ship it this week 🚀", createdAt: mins(3), sender: 'u1' },
  },
  {
    _id: 'c2',
    isGroup: true,
    name: 'Design Guild',
    avatar: 'https://api.dicebear.com/9.x/shapes/svg?seed=DesignGuild',
    description: 'Where pixels meet purpose.',
    members: ['me', 'u1', 'u2', 'u3', 'u5'],
    pinned: true,
    unreadCount: 5,
    lastMessage: { content: 'Sofia: So happy to be here 💜', createdAt: mins(12), sender: 'u5' },
  },
  {
    _id: 'c3',
    isGroup: false,
    peer: U.u3,
    unreadCount: 0,
    lastMessage: { content: 'Amazing, thank you! 📷', createdAt: hrs(1), sender: 'me' },
  },
  {
    _id: 'c4',
    isGroup: false,
    peer: U.u5,
    unreadCount: 0,
    lastMessage: { content: 'Voice message', createdAt: hrs(3), sender: 'u5', type: 'voice' },
  },
  {
    _id: 'c5',
    isGroup: false,
    peer: U.u2,
    unreadCount: 0,
    lastMessage: { content: 'Sounds great, talk soon!', createdAt: days(1), sender: 'u2' },
  },
  {
    _id: 'c6',
    isGroup: true,
    name: 'Weekend Trip 🏔️',
    avatar: 'https://api.dicebear.com/9.x/shapes/svg?seed=Trip',
    members: ['me', 'u4', 'u6', 'u7'],
    archived: true,
    unreadCount: 0,
    lastMessage: { content: 'Noah: booked the cabin!', createdAt: days(3), sender: 'u4' },
  },
];

export const MESSAGES = {
  c1: [
    { _id: 'm1', sender: U.u1, content: 'Hey! Did you get a chance to look at the new mockups?', type: 'text', createdAt: mins(30), status: 'read' },
    { _id: 'm2', sender: ME, content: 'Just opened them — the glass cards look 🔥', type: 'text', createdAt: mins(26), status: 'read' },
    { _id: 'm3', sender: U.u1, content: 'Right? The gradient accents really pop in dark mode.', type: 'text', createdAt: mins(20), status: 'read', reactions: [{ emoji: '❤️', user: 'me' }] },
    { _id: 'm4', sender: ME, content: 'Totally. I love how the message bubbles feel.', type: 'text', createdAt: mins(14), status: 'read' },
    { _id: 'm5', sender: U.u1, content: "Let's ship it this week 🚀", type: 'text', createdAt: mins(3), status: 'delivered', replyTo: { sender: ME, content: 'I love how the message bubbles feel.' } },
  ],
  c2: [
    { _id: 'g1', sender: U.u1, content: 'Welcome to the Design Guild everyone! 🎨', type: 'text', createdAt: hrs(4), status: 'read' },
    { _id: 'g2', sender: U.u2, content: 'Excited to collaborate on ChatConnect.', type: 'text', createdAt: hrs(3), status: 'read' },
    { _id: 'g3', sender: U.u5, content: 'So happy to be here 💜', type: 'text', createdAt: mins(12), status: 'read', reactions: [{ emoji: '🎉', user: 'u1' }, { emoji: '💜', user: 'u2' }] },
  ],
  c3: [
    { _id: 'p1', sender: U.u3, content: 'Sending over the photos from the shoot 📷', type: 'text', createdAt: hrs(2), status: 'read' },
    { _id: 'p2', sender: ME, content: 'Amazing, thank you!', type: 'text', createdAt: hrs(1), status: 'read' },
  ],
};

export const CALLS = [
  { _id: 'call1', type: 'video', peer: U.u1, direction: 'outgoing', status: 'completed', duration: 725, createdAt: hrs(2) },
  { _id: 'call2', type: 'audio', peer: U.u3, direction: 'incoming', status: 'missed', duration: 0, createdAt: hrs(6) },
  { _id: 'call3', type: 'audio', peer: U.u5, direction: 'outgoing', status: 'completed', duration: 240, createdAt: days(1) },
  { _id: 'call4', type: 'video', peer: U.u2, direction: 'incoming', status: 'completed', duration: 1820, createdAt: days(1) },
  { _id: 'call5', type: 'audio', peer: U.u4, direction: 'incoming', status: 'rejected', duration: 0, createdAt: days(2) },
];

export const MEETINGS = [
  { _id: 'mt1', title: 'Design Review — ChatConnect v2', description: 'Walk through the new glassmorphism system and dark mode.', type: 'video', startAt: inHrs(3), durationMinutes: 45, host: ME, participants: [U.u1, U.u2, U.u3], recurrence: 'none' },
  { _id: 'mt2', title: 'Weekly Standup', description: 'Team sync', type: 'video', startAt: inDays(1), durationMinutes: 30, host: U.u2, participants: [ME, U.u1, U.u5, U.u7], recurrence: 'weekly' },
  { _id: 'mt3', title: '1:1 with Maya', description: 'Portfolio & roadmap', type: 'audio', startAt: inDays(2), durationMinutes: 30, host: ME, participants: [U.u3], recurrence: 'none' },
  { _id: 'mt4', title: 'Marketing Brainstorm', description: 'Launch campaign ideas', type: 'video', startAt: inDays(4), durationMinutes: 60, host: U.u5, participants: [ME, U.u1, U.u4], recurrence: 'none' },
];

export const STATUS_FEED = [
  {
    user: ME,
    isMe: true,
    items: [{ _id: 's0', type: 'text', content: 'Shipping something beautiful today ✨', background: 'linear-gradient(135deg,#6366f1,#8b5cf6,#06b6d4)', createdAt: hrs(1), viewers: [U.u1, U.u2] }],
  },
  {
    user: U.u1,
    seenAll: false,
    items: [
      { _id: 's1', type: 'text', content: 'Coffee & code ☕', background: 'linear-gradient(135deg,#f59e0b,#ec4899)', createdAt: hrs(2) },
      { _id: 's2', type: 'text', content: 'New design dropping soon 👀', background: 'linear-gradient(135deg,#8b5cf6,#06b6d4)', createdAt: hrs(1) },
    ],
  },
  { user: U.u3, seenAll: false, items: [{ _id: 's3', type: 'text', content: 'Golden hour 🌅', background: 'linear-gradient(135deg,#f97316,#ef4444)', createdAt: hrs(5) }] },
  { user: U.u5, seenAll: true, items: [{ _id: 's4', type: 'text', content: 'On repeat 🎧', background: 'linear-gradient(135deg,#10b981,#06b6d4)', createdAt: hrs(8) }] },
];

export const NOTIFICATIONS = [
  { _id: 'n1', type: 'message', from: U.u1, title: 'Aria Vance', body: "Let's ship it this week 🚀", createdAt: mins(3), isRead: false },
  { _id: 'n2', type: 'group_message', from: U.u5, title: 'Design Guild', body: 'Sofia: So happy to be here 💜', createdAt: mins(12), isRead: false },
  { _id: 'n3', type: 'missed_call', from: U.u3, title: 'Missed call', body: 'Maya Chen tried to call you', createdAt: hrs(6), isRead: true },
  { _id: 'n4', type: 'meeting_reminder', title: 'Meeting soon', body: 'Design Review starts in 3 hours', createdAt: hrs(1), isRead: true },
];

export const CONTACT_REQUESTS = [
  { _id: 'r1', from: U.u6, message: 'Hey, met you at the conf!', createdAt: hrs(4) },
  { _id: 'r2', from: U.u7, message: '', createdAt: days(1) },
];

export const ADMIN_STATS = {
  totalUsers: 12840,
  activeUsers: 3218,
  totalGroups: 1560,
  totalMessages: 984210,
  totalCalls: 41200,
  openReports: 7,
  userGrowth: [
    { _id: 'Mon', count: 120 },
    { _id: 'Tue', count: 210 },
    { _id: 'Wed', count: 180 },
    { _id: 'Thu', count: 320 },
    { _id: 'Fri', count: 290 },
    { _id: 'Sat', count: 410 },
    { _id: 'Sun', count: 380 },
  ],
  messageVolume: [
    { _id: 'Mon', count: 12400 },
    { _id: 'Tue', count: 15200 },
    { _id: 'Wed', count: 14100 },
    { _id: 'Thu', count: 19800 },
    { _id: 'Fri', count: 21500 },
    { _id: 'Sat', count: 17600 },
    { _id: 'Sun', count: 16900 },
  ],
};

export const ADMIN_USERS = [
  { _id: 'au1', name: 'Aria Vance', username: 'aria', email: 'aria@chatconnect.app', avatar: av('aria'), accountStatus: 'active', createdAt: days(120) },
  { _id: 'au2', name: 'Leo Marsh', username: 'leo', email: 'leo@chatconnect.app', avatar: av('leo'), accountStatus: 'active', createdAt: days(90) },
  { _id: 'au3', name: 'Spammy McSpam', username: 'spammy', email: 'spam@x.com', avatar: av('spam'), accountStatus: 'suspended', createdAt: days(12) },
  { _id: 'au4', name: 'Maya Chen', username: 'maya', email: 'maya@chatconnect.app', avatar: av('maya'), accountStatus: 'active', createdAt: days(60) },
  { _id: 'au5', name: 'Bad Actor', username: 'bad', email: 'bad@x.com', avatar: av('bad'), accountStatus: 'banned', createdAt: days(5) },
];

export const ADMIN_REPORTS = [
  { _id: 'rep1', reporter: U.u1, targetUser: ADMIN_USERS[2], targetType: 'user', reason: 'Spam', status: 'open', createdAt: hrs(3) },
  { _id: 'rep2', reporter: U.u3, targetUser: ADMIN_USERS[4], targetType: 'user', reason: 'Harassment', status: 'reviewing', createdAt: days(1) },
  { _id: 'rep3', reporter: U.u5, targetUser: ADMIN_USERS[2], targetType: 'message', reason: 'Inappropriate content', status: 'open', createdAt: days(2) },
];

export { U as USER_MAP };
