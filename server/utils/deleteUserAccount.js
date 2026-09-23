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

/**
 * Permanently erase an account and every record owned by it, while removing its
 * references from shared records that remain for other users.
 */
export async function deleteUserAccount(userId) {
  const uid = userId;
  const deletedChatIds = [];

  // A direct chat belongs only to its two participants. Group chats remain for
  // their other members, with ownership reassigned when necessary.
  const chats = await Chat.find({ 'participants.user': uid }).select('participants isGroup');
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
    Meeting.deleteMany({ host: uid }),
    Report.deleteMany({ reporter: uid }),
    Session.deleteMany({ user: uid }),
    PushSubscription.deleteMany({ user: uid }),
    ScheduledMessage.deleteMany({ sender: uid }),
    BroadcastList.deleteMany({ owner: uid }),
    ApiKey.deleteMany({ owner: uid }),
    IncomingWebhook.deleteMany({ createdBy: uid }),

    // Remove personal references from all remaining accounts and shared data.
    User.updateMany(
      { $or: [{ contacts: uid }, { favorites: uid }, { blockedUsers: uid }] },
      { $pull: { contacts: uid, favorites: uid, blockedUsers: uid } }
    ),
    User.updateMany(
      {},
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
          { 'reactions.user': uid }, { 'readBy.user': uid }, { 'poll.options.votes': uid },
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
          'poll.options.$[].votes': uid,
        },
      }
    ),
    Message.updateMany({ forwardedFrom: uid }, { $unset: { forwardedFrom: '' } }),
    Meeting.updateMany(
      {},
      {
        $pull: {
          participants: { user: uid },
          attendees: { user: uid },
          'polls.$[].votes': { user: uid },
          'questions.$[].upvotes': uid,
          transcript: { user: uid },
        },
      }
    ),
    Status.updateMany({}, { $pull: { viewers: { user: uid }, replies: { user: uid }, 'privacy.allow': uid, 'privacy.except': uid } }),
    BroadcastList.updateMany({}, { $pull: { recipients: uid } }),
    Community.updateMany({ 'members.user': uid }, { $pull: { members: { user: uid } } }),
    Community.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Workspace.updateMany({ owner: uid }, { $unset: { owner: '' } }),
    QuickReply.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Label.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Product.updateMany({ createdBy: uid }, { $unset: { createdBy: '' } }),
    Report.updateMany({ targetUser: uid }, { $unset: { targetUser: '' } }),
  ]);

  await User.findByIdAndDelete(uid);
}
