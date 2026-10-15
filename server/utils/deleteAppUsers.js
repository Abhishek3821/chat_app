import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
import Status from '../models/Status.js';
import Notification from '../models/Notification.js';
import Call from '../models/Call.js';
import Meeting from '../models/Meeting.js';
import Report from '../models/Report.js';
import ContactRequest from '../models/ContactRequest.js';
import Session from '../models/Session.js';
import PushSubscription from '../models/PushSubscription.js';
import ScheduledMessage from '../models/ScheduledMessage.js';
import BroadcastList from '../models/BroadcastList.js';
import Community from '../models/Community.js';
import ApiKey from '../models/ApiKey.js';
import IncomingWebhook from '../models/IncomingWebhook.js';
import Workspace from '../models/Workspace.js';
import QuickReply from '../models/QuickReply.js';
import Label from '../models/Label.js';
import Product from '../models/Product.js';
import WorkspaceTask from '../models/WorkspaceTask.js';
import WorkspaceInboxThread from '../models/WorkspaceInboxThread.js';
import WorkspaceGuestInvite from '../models/WorkspaceGuestInvite.js';
import WorkspaceAudit from '../models/WorkspaceAudit.js';
import { getIO } from '../socket/index.js';
import { invalidateChatListCache } from './chatCache.js';

/** Bulk tenant cleanup. Keep users and chats until dependent cleanup succeeds,
 * so a failed request can discover the same IDs and safely retry. Shared
 * workspaces and records with other members are preserved. */
export async function deleteAppUsers(appId) {
  const users = await User.find({ app: appId }).select('_id').lean();
  const ids = users.map((u) => u._id);
  if (!ids.length) return 0;
  const uid = { $in: ids };
  const idSet = new Set(ids.map(String));

  // Block both HTTP requests and reconnects before tearing down data. This
  // includes suspended/banned users and does not rely on the usage counter.
  await User.updateMany({ app: appId }, { $set: { accountStatus: 'suspended' }, $inc: { tokenVersion: 1 } });
  await Session.deleteMany({ user: uid });
  getIO()?.in(ids.map((id) => `user:${id}`)).disconnectSockets(true);

  const chats = await Chat.find({ $or: [{ 'participants.user': uid }, { createdBy: uid }] }).select('participants isGroup').lean();
  const deletedChats = chats.filter((c) => !c.isGroup || c.participants.every((p) => idSet.has(String(p.user))));
  const chatIds = deletedChats.map((c) => c._id);
  const chatMatch = { $in: chatIds };
  const deletedChatSet = new Set(chatIds.map(String));
  const sharedChats = chats.filter((c) => !deletedChatSet.has(String(c._id)));
  for (const chat of sharedChats) {
    await Chat.updateOne({ _id: chat._id }, { $pull: { participants: { user: uid }, pins: { pinnedBy: uid } } });
    // Only promote if there is still no owner; do not replace concurrent edits.
    const remaining = await Chat.findById(chat._id).select('participants').lean();
    if (remaining?.participants.length && !remaining.participants.some((p) => p.role === 'owner')) {
      await Chat.updateOne(
        { _id: chat._id, 'participants.role': { $ne: 'owner' } },
        { $set: { 'participants.$[member].role': 'owner' } },
        { arrayFilters: [{ 'member.user': remaining.participants[0].user }] }
      );
    }
  }

  const meetings = await Meeting.find({ host: uid }).select('_id').lean();
  const meetingIds = { $in: meetings.map((m) => m._id) };
  const communities = await Community.find({ $or: [{ 'members.user': uid }, { createdBy: uid }] }).select('members').lean();
  const communityIds = { $in: communities.filter((c) => c.members.every((m) => idSet.has(String(m.user)))).map((c) => c._id) };
  const messages = await Message.find({ $or: [{ sender: uid }, { chat: chatMatch }] }).select('_id').lean();
  const messageIds = { $in: messages.map((m) => m._id) };

  // Await every operation even on failure. A retry must not overlap unfinished
  // writes from the previous attempt. No transaction requirement: local MongoDB
  // standalone installations support this path as well as replica sets.
  const results = await Promise.allSettled([
    Status.deleteMany({ user: uid }),
    ContactRequest.deleteMany({ $or: [{ from: uid }, { to: uid }] }),
    Notification.deleteMany({ $or: [{ user: uid }, { from: uid }] }),
    Call.deleteMany({ $or: [{ initiator: uid }, { caller: uid }, { receiver: uid }, { 'participants.user': uid }] }),
    Report.deleteMany({ $or: [{ reporter: uid }, { targetUser: uid }, { targetChat: chatMatch }, { targetMessage: messageIds }] }),
    PushSubscription.deleteMany({ user: uid }),
    ScheduledMessage.deleteMany({ $or: [{ sender: uid }, { chat: chatMatch }] }),
    BroadcastList.deleteMany({ owner: uid }),
    ApiKey.deleteMany({ owner: uid }),
    IncomingWebhook.deleteMany({ $or: [{ createdBy: uid }, { chat: chatMatch }] }),
    WorkspaceTask.deleteMany({ createdBy: uid }),
    WorkspaceTask.updateMany({ assignee: uid }, { $set: { assignee: null } }),
    WorkspaceInboxThread.deleteMany({ customer: uid }),
    WorkspaceInboxThread.updateMany({ $or: [{ 'messages.author': uid }, { 'notes.author': uid }] }, { $pull: { messages: { author: uid }, notes: { author: uid } } }),
    WorkspaceInboxThread.updateMany({ assignedTo: uid }, { $set: { assignedTo: null } }),
    WorkspaceGuestInvite.deleteMany({ $or: [{ createdBy: uid }, { claimedBy: uid }] }),
    WorkspaceGuestInvite.updateMany({ chats: chatMatch }, { $pull: { chats: chatMatch } }),
    WorkspaceAudit.deleteMany({ actor: uid }),
    User.updateMany({ $or: [
      { contacts: uid }, { favorites: uid }, { blockedUsers: uid },
      { pinnedChats: chatMatch }, { archivedChats: chatMatch }, { mutedChats: chatMatch },
      { lockedChats: chatMatch }, { 'chatThemes.chat': chatMatch },
    ] }, { $pull: {
      contacts: uid, favorites: uid, blockedUsers: uid,
      pinnedChats: chatMatch, archivedChats: chatMatch, mutedChats: chatMatch,
      lockedChats: chatMatch, chatThemes: { chat: chatMatch },
    } }),
    Chat.updateMany({ createdBy: uid, _id: { $nin: chatIds } }, { $unset: { createdBy: '' } }),
    Chat.updateMany({ 'pins.message': messageIds }, { $pull: { pins: { message: messageIds } } }),
    Chat.updateMany({ lastMessage: messageIds }, { $unset: { lastMessage: '' } }),
    Message.updateMany({ $or: [
      { viewedBy: uid }, { mentions: uid }, { deliveredTo: uid }, { starredBy: uid },
      { deletedFor: uid }, { 'reactions.user': uid }, { 'readBy.user': uid },
    ] }, { $pull: {
      viewedBy: uid, mentions: uid, deliveredTo: uid, starredBy: uid, deletedFor: uid,
      reactions: { user: uid }, readBy: { user: uid },
    } }),
    Message.updateMany({ 'poll.options.votes': uid }, { $pull: { 'poll.options.$[].votes': uid } }),
    Message.updateMany({ forwardedFrom: uid }, { $unset: { forwardedFrom: '' } }),
    Message.updateMany({ replyTo: messageIds }, { $unset: { replyTo: '' } }),
    Meeting.updateMany({ $or: [
      { 'participants.user': uid }, { 'attendees.user': uid }, { 'reactionHistory.user': uid },
      { 'polls.createdBy': uid }, { 'questions.askedBy': uid },
    ] }, { $pull: {
      participants: { user: uid }, attendees: { user: uid }, reactionHistory: { user: uid },
      polls: { createdBy: uid }, questions: { askedBy: uid },
    } }),
    // Separate updates avoid overlapping MongoDB paths (polls vs polls.$[].votes).
    Meeting.updateMany({ 'polls.votes.user': uid }, { $pull: { 'polls.$[].votes': { user: uid } } }),
    Meeting.updateMany({ 'questions.upvotes': uid }, { $pull: { 'questions.$[].upvotes': uid } }),
    Status.updateMany({ $or: [{ 'viewers.user': uid }, { 'replies.user': uid }, { 'privacy.allow': uid }, { 'privacy.except': uid }] }, { $pull: { viewers: { user: uid }, replies: { user: uid }, 'privacy.allow': uid, 'privacy.except': uid } }),
    BroadcastList.updateMany({ recipients: uid }, { $pull: { recipients: uid } }),
    Community.updateMany({ _id: { $nin: communityIds.$in }, $or: [{ 'members.user': uid }, { groups: chatMatch }] }, { $pull: { members: { user: uid }, groups: chatMatch } }),
    Community.updateMany({ _id: { $nin: communityIds.$in }, announcementGroup: chatMatch }, { $unset: { announcementGroup: '' } }),
    Community.updateMany({ _id: { $nin: communityIds.$in }, createdBy: uid }, { $unset: { createdBy: '' } }),
    Workspace.updateMany({ owner: uid }, { $unset: { owner: '' } }),
    QuickReply.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Label.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Product.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
  ]);
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) throw failed.reason;

  await Message.deleteMany({ _id: messageIds });
  await Meeting.deleteMany({ $or: [{ _id: meetingIds }, { parentMeeting: meetingIds }] });
  await Community.deleteMany({ _id: communityIds });
  await Chat.deleteMany({ _id: chatMatch });
  await invalidateChatListCache([...ids, ...sharedChats.flatMap((c) => c.participants.map((p) => p.user))]);
  const removed = await User.deleteMany({ app: appId, _id: uid });
  return removed.deletedCount;
}
