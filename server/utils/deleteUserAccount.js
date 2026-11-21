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
import DeviceToken from '../models/DeviceToken.js';
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
import ChatRead from '../models/ChatRead.js';
import { disconnectUser } from '../socket/index.js';
import { invalidateChatListCache } from './chatCache.js';

/**
 * Permanently erase an account and every record owned by it, while removing its
 * references from shared records that remain for other users.
 */
export async function deleteUserAccount(userId) {
  const uid = userId;
  const deletedChatIds = [];

  // Cut live sockets first: socket auth is handshake-only, so an open socket
  // would otherwise keep relaying read receipts / call signals for a deleted user.
  disconnectUser(uid);

  // A direct chat belongs only to its two participants. Group chats remain for
  // their other members, with ownership reassigned when necessary.
  const chats = await Chat.find({ 'participants.user': uid }).select('participants isGroup');
  // Everyone who shared a chat with this user has a cached chat list to refresh.
  const affectedUsers = new Set(chats.flatMap((c) => c.participants.map((p) => String(p.user))));
  // Every message about to disappear (their own, plus whole direct chats) — other
  // records point at these (pins, chat previews, replies) and must let go.
  const directChatIds = chats
    .filter((c) => !c.isGroup || c.participants.every((p) => String(p.user) === String(uid)))
    .map((c) => c._id);
  const doomedMessageIds = await Message.distinct('_id', { $or: [{ sender: uid }, { chat: { $in: directChatIds } }] });
  // Meetings they host go, and so do those meetings' breakout rooms.
  const hostedMeetingIds = await Meeting.distinct('_id', { host: uid });
  // Communities they belong to may be left with nobody in them.
  const communityIds = await Community.distinct('_id', { 'members.user': uid });

  for (const chat of chats) {
    const remaining = chat.participants.filter((p) => String(p.user) !== String(uid));
    if (!chat.isGroup || remaining.length === 0) {
      deletedChatIds.push(chat._id);
      await Promise.all([
        Message.deleteMany({ chat: chat._id }),
        ScheduledMessage.deleteMany({ chat: chat._id }),
        IncomingWebhook.deleteMany({ chat: chat._id }),
        Chat.deleteOne({ _id: chat._id }),
      ]);
    } else {
      chat.participants = remaining;
      if (!chat.participants.some((p) => p.role === 'owner')) chat.participants[0].role = 'owner';
      await chat.save();
    }
  }

  await Promise.all([
    Message.deleteMany({ sender: uid }),
    Status.deleteMany({ user: uid }),
    ContactRequest.deleteMany({ $or: [{ from: uid }, { to: uid }] }),
    Notification.deleteMany({ $or: [{ user: uid }, { from: uid }] }),
    Call.deleteMany({ $or: [{ initiator: uid }, { caller: uid }, { receiver: uid }, { 'participants.user': uid }] }),
    Meeting.deleteMany({ $or: [{ host: uid }, { parentMeeting: { $in: hostedMeetingIds } }] }),
    Report.deleteMany({ reporter: uid }),
    Session.deleteMany({ user: uid }),
    PushSubscription.deleteMany({ user: uid }),
    DeviceToken.deleteMany({ user: uid }),
    ScheduledMessage.deleteMany({ sender: uid }),
    BroadcastList.deleteMany({ owner: uid }),
    ApiKey.deleteMany({ owner: uid }),
    IncomingWebhook.deleteMany({ createdBy: uid }),

    // Workspace records (mirrors utils/deleteAppUsers.js).
    WorkspaceTask.deleteMany({ createdBy: uid }),
    WorkspaceTask.updateMany({ assignee: uid }, { $set: { assignee: null } }),
    WorkspaceInboxThread.deleteMany({ customer: uid }),
    WorkspaceInboxThread.updateMany(
      { $or: [{ 'messages.author': uid }, { 'notes.author': uid }] },
      { $pull: { messages: { author: uid }, notes: { author: uid } } }
    ),
    WorkspaceInboxThread.updateMany({ assignedTo: uid }, { $set: { assignedTo: null } }),
    WorkspaceGuestInvite.deleteMany({ $or: [{ createdBy: uid }, { claimedBy: uid }] }),
    WorkspaceGuestInvite.updateMany({ chats: { $in: deletedChatIds } }, { $pull: { chats: { $in: deletedChatIds } } }),
    WorkspaceAudit.deleteMany({ actor: uid }),
    ChatRead.deleteMany({ $or: [{ user: uid }, { chat: { $in: deletedChatIds } }] }),

    // Shared chats must not keep pointing at messages that no longer exist.
    Chat.updateMany({ 'pins.message': { $in: doomedMessageIds } }, { $pull: { pins: { message: { $in: doomedMessageIds } } } }),
    Message.updateMany({ replyTo: { $in: doomedMessageIds } }, { $unset: { replyTo: '' } }),

    // Remove personal references from all remaining accounts and shared data.
    User.updateMany(
      { $or: [{ contacts: uid }, { favorites: uid }, { blockedUsers: uid }] },
      { $pull: { contacts: uid, favorites: uid, blockedUsers: uid } }
    ),
    User.updateMany(
      {
        $or: [
          { pinnedChats: { $in: deletedChatIds } },
          { archivedChats: { $in: deletedChatIds } },
          { mutedChats: { $in: deletedChatIds } },
          { lockedChats: { $in: deletedChatIds } },
          { 'chatThemes.chat': { $in: deletedChatIds } },
        ],
      },
      {
        $pull: {
          pinnedChats: { $in: deletedChatIds },
          archivedChats: { $in: deletedChatIds },
          mutedChats: { $in: deletedChatIds },
          lockedChats: { $in: deletedChatIds },
          chatThemes: { chat: { $in: deletedChatIds } },
        },
      }
    ),
    Message.updateMany(
      {
        $or: [
          { viewedBy: uid }, { mentions: uid }, { deliveredTo: uid }, { starredBy: uid }, { deletedFor: uid },
          { 'reactions.user': uid }, { 'readBy.user': uid },
        ],
      },
      {
        $pull: {
          viewedBy: uid,
          mentions: uid,
          deliveredTo: uid,
          starredBy: uid,
          deletedFor: uid,
          reactions: { user: uid },
          readBy: { user: uid },
        },
      }
    ),
    // Ordinary messages have no poll. Only traverse options on polls containing
    // this user's votes, otherwise MongoDB rejects the missing array path.
    Message.updateMany({ 'poll.options.votes': uid }, { $pull: { 'poll.options.$[].votes': uid } }),
    Message.updateMany({ forwardedFrom: uid }, { $unset: { forwardedFrom: '' } }),
    Meeting.updateMany(
      { $or: [{ 'participants.user': uid }, { 'attendees.user': uid }] },
      {
        $pull: {
          participants: { user: uid },
          attendees: { user: uid },
        },
      }
    ),
    // Older meetings may not have polls/questions arrays. Filter each nested
    // cleanup separately so those records can still be deleted successfully.
    Meeting.updateMany({ 'polls.votes.user': uid }, { $pull: { 'polls.$[].votes': { user: uid } } }),
    Meeting.updateMany({ 'questions.upvotes': uid }, { $pull: { 'questions.$[].upvotes': uid } }),
    Status.updateMany({ $or: [{ 'viewers.user': uid }, { 'replies.user': uid }, { 'privacy.allow': uid }, { 'privacy.except': uid }] }, { $pull: { viewers: { user: uid }, replies: { user: uid }, 'privacy.allow': uid, 'privacy.except': uid } }),
    BroadcastList.updateMany({ recipients: uid }, { $pull: { recipients: uid } }),
    Community.updateMany({ 'members.user': uid }, { $pull: { members: { user: uid } } }),
    Community.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Workspace.updateMany({ owner: uid }, { $unset: { owner: '' } }),
    QuickReply.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Label.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Product.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Report.updateMany({ targetUser: uid }, { $unset: { targetUser: '' } }),
  ]);

  // Group previews that showed one of their messages fall back to the newest
  // message that's left (or none), instead of a dangling id.
  const stalePreviews = await Chat.find({ lastMessage: { $in: doomedMessageIds } }).select('_id');
  for (const chat of stalePreviews) {
    // eslint-disable-next-line no-await-in-loop
    const newest = await Message.findOne({ chat: chat._id }).sort({ createdAt: -1 }).select('_id');
    // eslint-disable-next-line no-await-in-loop
    await Chat.updateOne({ _id: chat._id }, newest ? { $set: { lastMessage: newest._id } } : { $unset: { lastMessage: '' } });
  }

  // Communities nobody belongs to any more: remove them and their (now empty)
  // announcement group.
  const orphaned = await Community.find({ _id: { $in: communityIds }, members: { $size: 0 } }).select('_id announcementGroup');
  if (orphaned.length) {
    const announcement = orphaned.map((c) => c.announcementGroup).filter(Boolean);
    await Chat.deleteMany({ _id: { $in: announcement }, participants: { $size: 0 } });
    await Community.deleteMany({ _id: { $in: orphaned.map((c) => c._id) } });
  }

  await User.findByIdAndDelete(uid);
  affectedUsers.delete(String(uid));
  await invalidateChatListCache([...affectedUsers]);
}
