import crypto from 'crypto';
import mongoose from 'mongoose';
import Workspace from '../models/Workspace.js';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Meeting from '../models/Meeting.js';
import WorkspaceInboxThread from '../models/WorkspaceInboxThread.js';
import WorkspaceTask from '../models/WorkspaceTask.js';
import WorkspaceAudit from '../models/WorkspaceAudit.js';
import WorkspaceGuestInvite from '../models/WorkspaceGuestInvite.js';
import { asyncHandler, ApiError } from '../utils/asyncHandler.js';
import { logWorkspaceAction } from '../utils/workspaceAudit.js';
import { emitToUser } from '../socket/index.js';

const validId = (value) => typeof value === 'string' && mongoose.isValidObjectId(value);
const manager = (user) => ['owner', 'admin'].includes(user.workspaceRole);
const team = async (user) => {
  const ws = await Workspace.findById(user.workspace).select('type name');
  if (!ws || ws.type !== 'team' || user.workspaceRole === 'guest') throw new ApiError(403, 'Team workspace access required.');
  return ws;
};
const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const threadQuery = (id, user) => validId(id)
  ? { _id: id, $or: [{ workspace: user.workspace }, { customer: user._id }] }
  : { _id: null };
const notifyThread = async (thread) => {
  const members = await User.find({ workspace: thread.workspace, workspaceRole: { $ne: 'guest' }, accountStatus: 'active' }).select('_id').lean();
  for (const member of members) emitToUser(member._id, 'workspace-inbox-updated', { threadId: thread._id });
  emitToUser(thread.customer, 'workspace-inbox-updated', { threadId: thread._id });
};
const notifyTask = async (task) => {
  const members = await User.find({ workspace: task.workspace, workspaceRole: { $ne: 'guest' }, accountStatus: 'active' }).select('_id').lean();
  for (const member of members) emitToUser(member._id, 'workspace-task-updated', { taskId: task._id });
};

// A customer explicitly starts a conversation with a team; private DMs are never copied into this inbox.
export const startInboxThread = asyncHandler(async (req, res) => {
  if (!validId(req.params.workspaceId)) throw new ApiError(400, 'Invalid workspace.');
  const ws = await Workspace.findById(req.params.workspaceId).select('type');
  if (!ws || ws.type !== 'team') throw new ApiError(404, 'Team not found.');
  if (String(ws._id) === String(req.user.workspace)) throw new ApiError(400, 'Use the team inbox to respond.');
  const text = cleanText(req.body.text, 5000);
  if (!text) throw new ApiError(400, 'Message is required.');
  let thread = await WorkspaceInboxThread.findOne({ workspace: ws._id, customer: req.user._id });
  if (!thread) {
    try { thread = await WorkspaceInboxThread.create({ workspace: ws._id, customer: req.user._id, messages: [{ author: req.user._id, text }] }); }
    catch (e) {
      if (e?.code !== 11000) throw e;
      thread = await WorkspaceInboxThread.findOne({ workspace: ws._id, customer: req.user._id });
      if (thread.messages.length >= 1000) throw new ApiError(409, 'This thread is full.');
      thread.messages.push({ author: req.user._id, text });
      thread.status = 'open';
      await thread.save();
    }
  } else {
    if (thread.messages.length >= 1000) throw new ApiError(409, 'This thread is full. Please contact the team for a new conversation.');
    thread.messages.push({ author: req.user._id, text });
    thread.status = 'open';
    await thread.save();
  }
  await notifyThread(thread);
  res.status(201).json({ success: true, thread });
});

export const myCustomerThreads = asyncHandler(async (req, res) => {
  const threads = await WorkspaceInboxThread.find({ customer: req.user._id }).select('workspace status assignedTo updatedAt').populate('workspace', 'name').sort({ updatedAt: -1 }).limit(100).lean();
  res.json({ success: true, threads });
});

export const listInbox = asyncHandler(async (req, res) => {
  await team(req.user);
  const status = ['open', 'pending', 'closed'].includes(req.query.status) ? req.query.status : undefined;
  const threads = await WorkspaceInboxThread.find({ workspace: req.user.workspace, ...(status ? { status } : {}) })
    .populate('customer', 'name avatar username').populate('assignedTo', 'name avatar')
    .sort({ updatedAt: -1 }).limit(100).lean();
  res.json({ success: true, threads });
});

export const getInboxThread = asyncHandler(async (req, res) => {
  const thread = await WorkspaceInboxThread.findOne(threadQuery(req.params.id, req.user))
    .populate('workspace', 'name')
    .populate('customer', 'name avatar username').populate('assignedTo', 'name avatar')
    .populate('messages.author', 'name avatar').populate('notes.author', 'name avatar');
  if (!thread) throw new ApiError(404, 'Thread not found.');
  const isCustomer = String(thread.customer._id) === String(req.user._id);
  if (!isCustomer) await team(req.user);
  const data = thread.toObject();
  if (isCustomer) delete data.notes;
  res.json({ success: true, thread: data });
});

export const replyInbox = asyncHandler(async (req, res) => {
  const thread = await WorkspaceInboxThread.findOne(threadQuery(req.params.id, req.user));
  if (!thread) throw new ApiError(404, 'Thread not found.');
  const customer = String(thread.customer) === String(req.user._id);
  if (!customer) await team(req.user);
  const text = cleanText(req.body.text, 5000);
  if (!text) throw new ApiError(400, 'Message is required.');
  if (thread.messages.length >= 1000) throw new ApiError(409, 'This thread is full.');
  thread.messages.push({ author: req.user._id, text });
  if (customer) thread.status = 'open';
  await thread.save();
  if (!customer) await logWorkspaceAction(req.user, 'inbox.reply', thread._id);
  await notifyThread(thread);
  res.json({ success: true });
});

export const updateInbox = asyncHandler(async (req, res) => {
  await team(req.user);
  const thread = await WorkspaceInboxThread.findOne({ _id: validId(req.params.id) ? req.params.id : null, workspace: req.user.workspace });
  if (!thread) throw new ApiError(404, 'Thread not found.');
  if (req.body.status !== undefined) {
    if (!['open', 'pending', 'closed'].includes(req.body.status)) throw new ApiError(400, 'Invalid status.');
    thread.status = req.body.status;
  }
  if (req.body.assignedTo !== undefined) {
    if (req.body.assignedTo && (!validId(req.body.assignedTo) || !await User.exists({ _id: req.body.assignedTo, workspace: req.user.workspace, workspaceRole: { $ne: 'guest' }, accountStatus: 'active' }))) throw new ApiError(400, 'Choose an active team member.');
    thread.assignedTo = req.body.assignedTo || null;
  }
  await thread.save();
  await logWorkspaceAction(req.user, 'inbox.update', thread._id, `Status: ${thread.status}`);
  await notifyThread(thread);
  res.json({ success: true, thread });
});

export const addInboxNote = asyncHandler(async (req, res) => {
  await team(req.user);
  const thread = await WorkspaceInboxThread.findOne({ _id: validId(req.params.id) ? req.params.id : null, workspace: req.user.workspace });
  if (!thread) throw new ApiError(404, 'Thread not found.');
  const text = cleanText(req.body.text, 5000);
  if (!text) throw new ApiError(400, 'Note is required.');
  if (thread.notes.length >= 200) throw new ApiError(409, 'This thread has too many notes.');
  thread.notes.push({ author: req.user._id, text });
  await thread.save();
  await logWorkspaceAction(req.user, 'inbox.note', thread._id);
  await notifyThread(thread);
  res.status(201).json({ success: true });
});

export const listTasks = asyncHandler(async (req, res) => {
  await team(req.user);
  const tasks = await WorkspaceTask.find({ workspace: req.user.workspace }).populate('assignee createdBy', 'name avatar').sort({ status: 1, dueAt: 1, createdAt: -1 }).limit(300);
  res.json({ success: true, tasks });
});

export const createTask = asyncHandler(async (req, res) => {
  await team(req.user);
  const title = cleanText(req.body.title, 180);
  if (!title) throw new ApiError(400, 'Task title is required.');
  const assignee = req.body.assignee || null;
  if (assignee && (!validId(assignee) || !await User.exists({ _id: assignee, workspace: req.user.workspace, workspaceRole: { $ne: 'guest' }, accountStatus: 'active' }))) throw new ApiError(400, 'Choose an active team member.');
  const dueAt = req.body.dueAt ? new Date(req.body.dueAt) : null;
  if (dueAt && (!Number.isFinite(dueAt.getTime()) || dueAt < new Date())) throw new ApiError(400, 'Choose a future due date.');
  let source = { kind: 'manual', id: null };
  if (req.body.source?.kind === 'message') {
    const messageId = req.body.source.id;
    if (!validId(messageId)) throw new ApiError(400, 'Invalid source message.');
    const message = await Message.findById(messageId).select('chat');
    if (!message || !await Chat.exists({ _id: message.chat, workspace: req.user.workspace, 'participants.user': req.user._id })) throw new ApiError(403, 'Source message is not in an accessible team chat.');
    source = { kind: 'message', id: messageId };
  } else if (req.body.source?.kind === 'meeting') {
    const meetingId = req.body.source.id;
    if (!validId(meetingId)) throw new ApiError(400, 'Invalid meeting.');
    const meeting = await Meeting.findById(meetingId).select('host participants');
    const host = meeting && await User.findById(meeting.host).select('workspace');
    const attends = meeting && (String(meeting.host) === String(req.user._id) || meeting.participants.some((p) => String(p.user) === String(req.user._id)));
    if (!meeting || String(host?.workspace) !== String(req.user.workspace) || !attends) throw new ApiError(403, 'Meeting is not accessible to this team.');
    source = { kind: 'meeting', id: meetingId };
  }
  const task = await WorkspaceTask.create({ workspace: req.user.workspace, title, description: cleanText(req.body.description, 3000), assignee, createdBy: req.user._id, dueAt, source });
  await logWorkspaceAction(req.user, 'task.create', task._id, task.title);
  await notifyTask(task);
  res.status(201).json({ success: true, task });
});

export const updateTask = asyncHandler(async (req, res) => {
  await team(req.user);
  const task = await WorkspaceTask.findOne({ _id: validId(req.params.id) ? req.params.id : null, workspace: req.user.workspace });
  if (!task) throw new ApiError(404, 'Task not found.');
  if (req.body.status !== undefined) {
    if (!['open', 'done'].includes(req.body.status)) throw new ApiError(400, 'Invalid status.');
    task.status = req.body.status;
  }
  if (req.body.title !== undefined) {
    task.title = cleanText(req.body.title, 180);
    if (!task.title) throw new ApiError(400, 'Task title is required.');
  }
  if (req.body.description !== undefined) task.description = cleanText(req.body.description, 3000);
  if (req.body.assignee !== undefined) {
    const id = req.body.assignee || null;
    if (id && (!validId(id) || !await User.exists({ _id: id, workspace: req.user.workspace, workspaceRole: { $ne: 'guest' }, accountStatus: 'active' }))) throw new ApiError(400, 'Choose an active team member.');
    task.assignee = id;
  }
  if (req.body.dueAt !== undefined) {
    const date = req.body.dueAt ? new Date(req.body.dueAt) : null;
    if (date && (!Number.isFinite(date.getTime()) || date < new Date())) throw new ApiError(400, 'Choose a future due date.');
    task.dueAt = date;
    task.reminderSentAt = null;
  }
  await task.save();
  await logWorkspaceAction(req.user, 'task.update', task._id, task.title);
  await notifyTask(task);
  res.json({ success: true, task });
});

export const listActivity = asyncHandler(async (req, res) => {
  await team(req.user);
  if (!manager(req.user)) throw new ApiError(403, 'Only workspace owners/admins can view activity.');
  const events = await WorkspaceAudit.find({ workspace: req.user.workspace }).populate('actor', 'name avatar').sort({ createdAt: -1 }).limit(200);
  res.json({ success: true, events });
});

export const listGuests = asyncHandler(async (req, res) => {
  await team(req.user);
  if (!manager(req.user)) throw new ApiError(403, 'Only workspace owners/admins can manage guests.');
  const [guests, invites] = await Promise.all([
    User.find({ workspace: req.user.workspace, workspaceRole: 'guest' }).select('name email accountStatus guestExpiresAt guestAllowedChats').lean(),
    WorkspaceGuestInvite.find({ workspace: req.user.workspace }).select('chats expiresAt claimedBy createdAt').lean(),
  ]);
  res.json({ success: true, guests, invites });
});

export const createGuestInvite = asyncHandler(async (req, res) => {
  await team(req.user);
  if (!manager(req.user)) throw new ApiError(403, 'Only workspace owners/admins can invite guests.');
  const ids = Array.isArray(req.body.chatIds) ? [...new Set(req.body.chatIds)] : [];
  if (!ids.length || ids.length > 20 || ids.some((id) => !validId(id))) throw new ApiError(400, 'Select 1 to 20 team groups.');
  const groups = await Chat.find({ _id: { $in: ids }, workspace: req.user.workspace, isGroup: true }).select('_id');
  if (groups.length !== ids.length) throw new ApiError(400, 'Every selected group must belong to this workspace.');
  const days = req.body.days === null || req.body.days === '' ? null : Number(req.body.days ?? 7);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 90)) throw new ApiError(400, 'Expiry must be 1 to 90 days or never.');
  const token = crypto.randomBytes(24).toString('hex');
  const invite = await WorkspaceGuestInvite.create({ workspace: req.user.workspace, tokenHash: crypto.createHash('sha256').update(token).digest('hex'), chats: ids, expiresAt: new Date(Date.now() + 7 * 86400000), accessDays: days, createdBy: req.user._id });
  await logWorkspaceAction(req.user, 'guest.invite', invite._id, `${ids.length} groups, ${days === null ? 'no access expiry' : `${days} days`}`);
  res.status(201).json({ success: true, invite: { _id: invite._id, chats: invite.chats, expiresAt: invite.expiresAt, accessDays: invite.accessDays }, url: `${(process.env.CLIENT_URL || '').replace(/\/+$/, '')}/signup?guest=${token}` });
});

export const revokeGuest = asyncHandler(async (req, res) => {
  await team(req.user);
  if (!manager(req.user)) throw new ApiError(403, 'Only workspace owners/admins can revoke guests.');
  const guest = await User.findOne({ _id: validId(req.params.id) ? req.params.id : null, workspace: req.user.workspace, workspaceRole: 'guest' });
  if (!guest) throw new ApiError(404, 'Guest not found.');
  await Chat.updateMany({ _id: { $in: guest.guestAllowedChats }, workspace: req.user.workspace }, { $pull: { participants: { user: guest._id } } });
  guest.accountStatus = 'suspended';
  guest.guestExpiresAt = new Date();
  guest.tokenVersion += 1;
  await guest.save({ validateBeforeSave: false });
  await logWorkspaceAction(req.user, 'guest.revoke', guest._id, guest.name);
  res.json({ success: true });
});
